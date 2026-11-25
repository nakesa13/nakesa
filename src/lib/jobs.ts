import { createHash } from "node:crypto";

/**
 * T38: pencatat pekerjaan generate (idempoten) untuk /api/generate.
 *
 * Tujuan: mencoba ulang pekerjaan yang sama TIDAK memotong kuota dua kali dan tidak memanggil AI dua kali.
 *  - Klien mengirim `jobId` acak (dibuat sekali per penulisan satu bagian, dipakai ulang saat mencoba ulang).
 *  - Kunci pekerjaan = IP + jobId + sidik jari isi permintaan. Isi permintaan yang berbeda = pekerjaan lain,
 *    jadi jobId yang sama tidak bisa dipakai untuk mengambil hasil milik permintaan lain.
 *  - Kuota dipotong SEKALI saat pekerjaan pertama diterima. Percobaan ulang (setelah timeout/galat penyedia) gratis,
 *    tetapi dibatasi MAX_ATTEMPTS; sesudah itu dihitung sebagai pekerjaan baru.
 *  - Hasil sukses disimpan singkat: permintaan ulang yang sama (mis. koneksi klien putus saat server sudah selesai)
 *    mendapat hasil yang sama tanpa AI dan tanpa kuota. Permintaan kembar yang sedang berjalan menunggu pekerjaan yang sama.
 *
 * CATATAN T25: catatan ini ada di memori satu instance (sama seperti pembatas laju di guard.ts). Di serverless
 * multi-instance perlu penyimpanan bersama dengan operasi atomik; itu cakupan T25, bukan T38.
 */

/** Bentuk jobId yang diterima server. */
export const JOB_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Jumlah percobaan (pertama + ulang) yang berbagi satu pemotongan kuota. */
export const MAX_ATTEMPTS = 3;

const CHARGE_TTL_MS = 60 * 60_000; // selama jendela kuota (1 jam)
const RESULT_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 1_000;

export interface JobOutcome {
  status: number;
  body: Record<string, unknown>;
}

interface Entry {
  attempts: number;
  expires: number;
  inflight?: Promise<JobOutcome>;
  /** Hanya hasil sukses (200) yang disimpan. Galat tidak disimpan agar percobaan ulang benar-benar mencoba. */
  result?: JobOutcome;
}

const jobs = new Map<string, Entry>();

export function jobKey(ip: string, jobId: string, payload: unknown): string {
  return createHash("sha256").update(ip).update("\0").update(jobId).update("\0").update(JSON.stringify(payload)).digest("hex");
}

export type JobPlan =
  /** Sudah pernah sukses: kembalikan hasil yang sama, tanpa AI dan tanpa kuota. */
  | { kind: "replay"; outcome: JobOutcome }
  /** Pekerjaan yang sama sedang berjalan: tunggu hasilnya, tanpa AI baru dan tanpa kuota. */
  | { kind: "join"; promise: Promise<JobOutcome> }
  /** Jalankan. `needsCharge` = kuota harus dipotong dulu (pekerjaan baru, kedaluwarsa, atau percobaan habis). */
  | { kind: "run"; needsCharge: boolean };

function prune(now: number) {
  if (jobs.size < MAX_ENTRIES) return;
  for (const [k, e] of jobs) if (e.expires <= now && !e.inflight) jobs.delete(k);
  // Masih penuh: buang yang paling lama (urutan sisip Map) yang tidak sedang berjalan.
  for (const [k, e] of jobs) {
    if (jobs.size < MAX_ENTRIES) break;
    if (!e.inflight) jobs.delete(k);
  }
}

export function planJob(key: string, now = Date.now()): JobPlan {
  const e = jobs.get(key);
  if (!e || (e.expires <= now && !e.inflight)) return { kind: "run", needsCharge: true };
  if (e.result) return { kind: "replay", outcome: e.result };
  if (e.inflight) return { kind: "join", promise: e.inflight };
  return { kind: "run", needsCharge: e.attempts >= MAX_ATTEMPTS };
}

/**
 * Menjalankan `work` untuk `key`. Harus dipanggil sinkron setelah planJob (tanpa await di antaranya)
 * supaya dua permintaan kembar tidak sama-sama menjadi "run".
 * `fresh` = pekerjaan baru (kuota baru dipotong): percobaan dihitung dari awal.
 */
export function runJob(key: string, work: () => Promise<JobOutcome>, fresh: boolean, now = Date.now()): Promise<JobOutcome> {
  prune(now);
  let e = jobs.get(key);
  if (fresh || !e) e = { attempts: 0, expires: now + CHARGE_TTL_MS };
  const entry = e;
  entry.attempts++;
  const p = work().then(
    (o) => {
      entry.inflight = undefined;
      if (o.status === 200) {
        entry.result = o;
        entry.expires = Date.now() + RESULT_TTL_MS;
      }
      return o;
    },
    (err) => {
      entry.inflight = undefined;
      throw err;
    }
  );
  entry.inflight = p;
  jobs.set(key, entry);
  return p;
}
