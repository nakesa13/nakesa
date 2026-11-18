import type { DocType, Input } from "./types";
import { IDENTITY_IDS, type Settings } from "./client";

/**
 * Tahap C: satu "Kasus" dipakai bersama oleh LP, LK, dan Reading Journal.
 * - Jenis asuhan dan diagnosis/kasus hanya disimpan SEKALI di sini; LP dan LK membacanya dari sini,
 *   jadi keduanya tidak bisa berbeda.
 * - Reading Journal memakai kasus sebagai usulan topik (boleh diubah) dan kata kunci pencarian jurnal.
 * - Data pasien tetap hanya ada di draf LK.
 */

export const CASE_KEY = "nakesa.case";

export interface SharedCase {
  jenis_asuhan?: string;
  kasus?: string;
}
export const EMPTY_CASE: SharedCase = {};

const SHARED_IDS: readonly string[] = ["jenis_asuhan", "kasus"];

/** Kolom formulir yang nilainya selalu mengikuti kasus bersama (tidak disimpan di draf). */
export function isSharedField(docType: DocType, id: string): boolean {
  return docType !== "RJ" && SHARED_IDS.includes(id);
}

/** Nilai yang SELALU mengikuti kasus bersama. */
export function sharedInput(docType: DocType, c: SharedCase): Input {
  if (docType === "RJ") return {};
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

/** Nilai awal bila draf belum mengisinya (boleh diubah mahasiswa). */
export function suggestedInput(docType: DocType, c: SharedCase): Input {
  const out: Input = {};
  const kasus = (c.kasus ?? "").trim();
  const jenis = (c.jenis_asuhan ?? "").trim();
  if (docType === "RJ" && kasus) out.topik = kasus;
  if (docType === "LP" && kasus && jenis) {
    const subjek = SUBJEK[jenis] ?? jenis.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    out.judul = `Asuhan Kebidanan pada ${subjek} dengan ${kasus}`;
  }
  return out;
}

export type IdentitySettings = Partial<Pick<Settings, (typeof IDENTITY_IDS)[number]>>;

/**
 * Isian efektif satu dokumen. Urutan prioritas (rendah ke tinggi):
 * identitas dari Pengaturan < usulan dari kasus < isian di draf < kasus bersama (jenis asuhan, kasus).
 */
export function buildInput(docType: DocType, draftInput: Input, settings: IdentitySettings, c: SharedCase): Input {
  const base: Input = {};
  for (const k of IDENTITY_IDS) base[k] = settings[k] ?? "";
  return { ...base, ...suggestedInput(docType, c), ...draftInput, ...sharedInput(docType, c) };
}

/** Kata kunci pencarian jurnal dari kasus bersama. */
export function searchKeywords(c: SharedCase): string {
  return [c.kasus, c.jenis_asuhan?.replace(/\s*\([^)]*\)\s*/g, " ")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
}
