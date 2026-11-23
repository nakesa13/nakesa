import type { DocType, Input } from "./types";
import { IDENTITY_IDS, type Settings } from "./client";
import { ANC_FIELD_IDS } from "./anc";

/**
 * Kasus bersama (Tahap C), dengan aturan T07: LP, LK, dan Reading Journal adalah generator mandiri.
 * - Setiap dokumen bisa dimulai tanpa dokumen lain dan tanpa kasus bersama.
 * - Kasus bersama HANYA dipakai oleh dokumen yang dihubungkan pengguna (opt-in per dokumen, dengan konfirmasi).
 * - Dokumen yang terhubung membaca jenis asuhan dan kasus dari sini (LP/LK), atau memakainya sebagai usulan topik (Jurnal).
 * - Data pasien tidak pernah mengalir ke Reading Journal: kasus bersama hanya berisi jenis asuhan dan diagnosis.
 */

export const CASE_KEY = "nakesa.case";

export interface SharedCase {
  jenis_asuhan?: string;
  kasus?: string;
  /** Dokumen yang memilih memakai kasus bersama. Tidak ada entri = dokumen berdiri sendiri. */
  linked?: Partial<Record<DocType, boolean>>;
}
export const EMPTY_CASE: SharedCase = {};

const SHARED_IDS: readonly string[] = ["jenis_asuhan", "kasus"];

/** Id kolom data pasien di LK. Tidak boleh ada di isian Reading Journal. */
export const PATIENT_FIELD_IDS: readonly string[] = [
  "inisial",
  "umur",
  "pendidikan",
  "pekerjaan",
  "tanggal",
  "tempat",
  "keluhan_utama",
  "riwayat_obstetri",
  "riwayat_sekarang",
  "riwayat_kesehatan",
  "pola_kebiasaan",
  "psikososial",
  "keadaan_umum",
  "kesadaran",
  "td",
  "nadi",
  "rr",
  "suhu",
  "bb",
  "tb",
  "pemeriksaan_fisik",
  "pemeriksaan_khusus",
  "penunjang",
  "implementasi",
  "evaluasi",
  // T09: kolom ANC terstruktur dan pengukuran serial juga data pasien.
  ...ANC_FIELD_IDS,
];

/** Buang kolom data pasien dari sebuah isian. */
export function withoutPatientFields(input: Input): Input {
  const out: Input = {};
  for (const [k, v] of Object.entries(input)) if (!PATIENT_FIELD_IDS.includes(k)) out[k] = v;
  return out;
}

/** Apakah dokumen ini memakai kasus bersama (pilihan pengguna). */
export function isLinked(docType: DocType, c: SharedCase): boolean {
  return c.linked?.[docType] === true;
}

/** Kolom formulir yang nilainya mengikuti kasus bersama (tidak disimpan di draf) HANYA bila dokumen terhubung. */
export function isSharedField(docType: DocType, id: string, c: SharedCase): boolean {
  return docType !== "RJ" && isLinked(docType, c) && SHARED_IDS.includes(id);
}

/** Nilai yang SELALU mengikuti kasus bersama, untuk dokumen yang terhubung. */
export function sharedInput(docType: DocType, c: SharedCase): Input {
  if (docType === "RJ" || !isLinked(docType, c)) return {};
  return { jenis_asuhan: c.jenis_asuhan ?? "", kasus: c.kasus ?? "" };
}

const SUBJEK: Record<string, string> = {
  "Kehamilan (ANC)": "Ibu Hamil",
  "Persalinan (INC)": "Ibu Bersalin",
  "Nifas (PNC)": "Ibu Nifas",
  "Bayi Baru Lahir": "Bayi Baru Lahir",
  "Bayi dan Balita": "Bayi dan Balita",
  "Keluarga Berencana (KB)": "Akseptor KB",
  Ginekologi: "Pasien Ginekologi",
};

/** Judul LP dari jenis asuhan dan kasus. Kosong bila kasus belum ada. Dipakai sebagai usulan dan sebagai cadangan saat judul tidak diisi. */
export function lpTitleFor(jenis: string, kasus: string): string {
  const k = kasus.trim();
  const j = jenis.trim();
  if (!k) return "";
  if (!j) return `Asuhan Kebidanan dengan ${k}`;
  const subjek = SUBJEK[j] ?? j.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  return `Asuhan Kebidanan pada ${subjek} dengan ${k}`;
}

/** Nilai awal bila draf belum mengisinya (boleh diubah mahasiswa). Hanya untuk dokumen yang terhubung. */
export function suggestedInput(docType: DocType, c: SharedCase): Input {
  const out: Input = {};
  if (!isLinked(docType, c)) return out;
  const kasus = (c.kasus ?? "").trim();
  const jenis = (c.jenis_asuhan ?? "").trim();
  if (docType === "RJ" && kasus) out.topik = kasus;
  if (docType === "LP" && kasus && jenis) out.judul = lpTitleFor(jenis, kasus);
  return out;
}

export type IdentitySettings = Partial<Pick<Settings, (typeof IDENTITY_IDS)[number]>>;

/**
 * Bagian isian yang berasal dari kasus bersama dan draf (tanpa identitas penyusun).
 * Urutan prioritas (rendah ke tinggi): usulan dari kasus < isian di draf < kasus bersama (jenis asuhan, kasus).
 * Reading Journal tidak pernah memuat kolom data pasien.
 */
export function caseDerivedInput(docType: DocType, draftInput: Input, c: SharedCase): Input {
  const merged = { ...suggestedInput(docType, c), ...draftInput, ...sharedInput(docType, c) };
  return docType === "RJ" ? withoutPatientFields(merged) : merged;
}

/**
 * Isian efektif satu dokumen. Urutan prioritas (rendah ke tinggi):
 * identitas dari Pengaturan < usulan dari kasus < isian di draf < kasus bersama (jenis asuhan, kasus).
 * Usulan dan kasus bersama hanya berlaku bila dokumen terhubung.
 */
export function buildInput(docType: DocType, draftInput: Input, settings: IdentitySettings, c: SharedCase): Input {
  const base: Input = {};
  for (const k of IDENTITY_IDS) base[k] = settings[k] ?? "";
  return { ...base, ...caseDerivedInput(docType, draftInput, c) };
}

/** Kata kunci pencarian jurnal dari kasus bersama. */
export function searchKeywords(c: SharedCase): string {
  return [c.kasus, c.jenis_asuhan?.replace(/\s*\([^)]*\)\s*/g, " ")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

// ---------- hubungkan / lepas (opt-in dengan konfirmasi) ----------

export interface ReuseItem {
  id: string;
  label: string;
  /** Nilai di dokumen ini sekarang (boleh kosong). */
  current: string;
  /** Nilai yang akan dipakai bila dihubungkan. */
  incoming: string;
}

const REUSE_LABEL: Record<string, string> = {
  jenis_asuhan: "Jenis asuhan",
  kasus: "Diagnosis / kasus",
  judul: "Judul",
  topik: "Topik jurnal",
};

/** Apa yang akan berubah di dokumen ini bila dihubungkan ke kasus bersama. */
export function reusePreview(docType: DocType, draftInput: Input, c: SharedCase): ReuseItem[] {
  const after = caseDerivedInput(docType, draftInput, { ...c, linked: { ...c.linked, [docType]: true } });
  const items: ReuseItem[] = [];
  for (const id of Object.keys(REUSE_LABEL)) {
    const incoming = (after[id] ?? "").trim();
    const current = (draftInput[id] ?? "").trim();
    if (incoming && incoming !== current) items.push({ id, label: REUSE_LABEL[id], current, incoming });
  }
  return items;
}

/** Teks konfirmasi sebelum menghubungkan dokumen ke kasus bersama. */
export function linkConfirmMessage(docType: DocType, items: ReuseItem[]): string {
  const head = "Pakai kasus bersama untuk dokumen ini?";
  if (!items.length) return `${head}\n\nTidak ada isian dokumen ini yang berubah sekarang. Perubahan kasus bersama di kemudian hari akan ikut berlaku di sini. Anda bisa melepas tautan kapan saja.`;
  const lines = items.map((i) => (i.current ? `- ${i.label}: "${i.current}" akan diganti "${i.incoming}"` : `- ${i.label}: akan diisi "${i.incoming}"`));
  const tail =
    docType === "RJ"
      ? "Hanya jenis asuhan dan diagnosis yang dipakai; data pasien tidak pernah dibawa ke Reading Journal. Pastikan teks kasus tidak memuat nama atau identitas pasien."
      : "Anda bisa melepas tautan kapan saja; isian yang sedang berlaku tetap tersimpan di dokumen ini.";
  return `${head}\n\n${lines.join("\n")}\n\n${tail}`;
}

/** Hubungkan satu dokumen ke kasus bersama. */
export function linkDoc(docType: DocType, c: SharedCase): SharedCase {
  return { ...c, linked: { ...c.linked, [docType]: true } };
}

/**
 * Lepas satu dokumen dari kasus bersama. Panggil caseDerivedInput LEBIH DULU (dengan kasus yang masih terhubung)
 * dan simpan hasilnya ke draf, supaya dokumen tidak kehilangan isian yang sedang dipakainya.
 */
export function unlinkDoc(docType: DocType, c: SharedCase): SharedCase {
  return { ...c, linked: { ...c.linked, [docType]: false } };
}
