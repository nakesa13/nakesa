/**
 * T38: batas waktu satu pekerjaan generate.
 * Fungsi serverless punya batas durasi (maxDuration di route). Pekerjaan harus berhenti dengan galat yang jelas
 * SEBELUM platform memotongnya, supaya mahasiswa mendapat pesan "coba lagi" dan bukan koneksi putus tanpa keterangan.
 */

export const TIMEOUT_MESSAGE = "Penulisan bagian ini melebihi batas waktu server. Coba lagi; percobaan ulang tidak memotong kuota dua kali.";

/** Dilempar saat batas waktu habis. Selalu bisa dicoba ulang. */
export class DeadlineError extends Error {
  constructor(message = TIMEOUT_MESSAGE) {
    super(message);
    this.name = "DeadlineError";
  }
}

export interface Deadline {
  signal: AbortSignal;
  remainingMs(): number;
  /** Hentikan penghitung waktu (wajib dipanggil setelah pekerjaan selesai agar tidak ada timer menggantung). */
  cancel(): void;
}

export function makeDeadline(ms: number, now: () => number = Date.now): Deadline {
  const ctrl = new AbortController();
  const end = now() + ms;
  const timer = setTimeout(() => ctrl.abort(), ms);
  (timer as { unref?: () => void }).unref?.();
  return {
    signal: ctrl.signal,
    remainingMs: () => Math.max(0, end - now()),
    cancel: () => clearTimeout(timer),
  };
}

/**
 * Menunggu `work`, tetapi menolak dengan DeadlineError begitu batas habis, walau `work` sendiri tidak peduli pada sinyal.
 * Hasil `work` yang datang terlambat dibuang (galatnya ditelan agar tidak jadi unhandled rejection).
 */
export function raceDeadline<T>(work: Promise<T>, d: Deadline): Promise<T> {
  if (d.signal.aborted) {
    work.catch(() => {});
    return Promise.reject(new DeadlineError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DeadlineError());
    d.signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => {
        d.signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        d.signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

/** Tidur `ms`, tetapi berhenti dengan DeadlineError bila sinyal batas waktu menyala lebih dulu. */
export function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DeadlineError());
      return;
    }
    function onAbort() {
      clearTimeout(t);
      reject(new DeadlineError());
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
