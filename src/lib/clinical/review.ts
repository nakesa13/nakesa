import type { Input } from "../types";
import { parseHb, parseLila, parseTrimester, type Trimester } from "./parse";

/**
 * Penelaah klinis (Lapis 1: aturan hitungan di kode). Terpisah dari consistency.ts.
 * Ia hanya MENANDAI hal yang perlu dicek bersama pembimbing. Ia tidak menyatakan diagnosis "benar" atau
 * "valid", dan hanya memuat aturan yang acuannya sudah diverifikasi (lihat BASIS_*).
 */

export type ClinicalLevel = "sesuai" | "periksa" | "belum-bisa";

export interface ClinicalFinding {
  id: string;
  level: ClinicalLevel;
  title: string;
  detail: string;
  /** Acuan aturan, ditampilkan agar mahasiswa dan dosen bisa menelusurinya. */
  basis: string;
}

export interface ClinicalReview {
  applicable: boolean;
  reason?: string;
  findings: ClinicalFinding[];
  /** Apa yang dicek dan yang BELUM dicek, supaya "tidak ada temuan" tidak dibaca sebagai "semua benar". */
  checked: string[];
  notChecked: string[];
}

export const BASIS_HB =
  "Ambang Hb kehamilan per trimester dan kategori keparahan: WHO 2024 (Hb <11 g/dL pada T1/T3, <10,5 pada T2; ringan/sedang/berat <7). Kategori T1/T3 sama dengan Pedoman Antenatal Terpadu Kemenkes 2020 menurut jurnal yang mengutipnya. Klasifikasi lama (mis. Saifuddin 2010) berbeda; periksa acuan kampus dan dokumen aslinya.";
export const BASIS_LILA = "Kemenkes RI: LiLA <23,5 cm pada ibu hamil menunjukkan Kurang Energi Kronis (KEK) / risiko KEK.";

const CHECKED = ["Hb (anemia dalam kehamilan)", "LiLA (KEK)"];
const NOT_CHECKED = ["Tekanan darah dan hipertensi", "DJJ, TFU, dan letak janin", "Usia kehamilan dari HPHT", "Kesesuaian tindakan dan evaluasi dengan pedoman"];

export type AnemiaLevel = "ringan" | "sedang" | "berat";
export interface HbClass {
  anemia: boolean;
  level: AnemiaLevel | null;
}

/** Klasifikasi Hb ibu hamil menurut WHO 2024. */
export function classifyHb(hb: number, t: Trimester): HbClass {
  const cut = t === 2 ? 10.5 : 11;
  if (hb >= cut) return { anemia: false, level: null };
  if (hb < 7) return { anemia: true, level: "berat" };
  const mildFrom = t === 2 ? 9.5 : 10;
  return { anemia: true, level: hb >= mildFrom ? "ringan" : "sedang" };
}

interface AnyClass {
  /** null = bergantung pada trimester yang belum diketahui */
  anemia: boolean | null;
  level: AnemiaLevel | null;
  levelKnown: boolean;
}

/** Bila trimester tidak diketahui, hanya simpulan yang berlaku di SEMUA trimester yang dianggap pasti. */
export function classifyHbAny(hb: number, known: Trimester | null): AnyClass {
  const ts: Trimester[] = known ? [known] : [1, 2, 3];
  const rs = ts.map((t) => classifyHb(hb, t));
  if (new Set(rs.map((r) => `${r.anemia}:${r.level}`)).size === 1) return { anemia: rs[0].anemia, level: rs[0].level, levelKnown: true };
  const anemiaSet = new Set(rs.map((r) => r.anemia));
  return { anemia: anemiaSet.size === 1 ? rs[0].anemia : null, level: null, levelKnown: false };
}

const fmt = (n: number): string => String(n).replace(".", ",");
const ROMAN = ["", "I", "II", "III"];

export function reviewClinical(input: Input, texts: Record<string, string> = {}): ClinicalReview {
  const base = { findings: [] as ClinicalFinding[], checked: CHECKED, notChecked: NOT_CHECKED };
  const jenis = (input.jenis_asuhan ?? "").trim();
  if (!jenis) return { ...base, applicable: false, reason: "Pilih jenis asuhan di Kasus bersama terlebih dahulu." };
  if (!/kehamilan|\banc\b/i.test(jenis)) return { ...base, applicable: false, reason: "Telaah klinis saat ini baru tersedia untuk asuhan kehamilan (ANC)." };

  const findings: ClinicalFinding[] = [];
  const push = (id: string, level: ClinicalLevel, title: string, detail: string, basis: string) => findings.push({ id, level, title, detail, basis });

  const dataText = [input.penunjang, input.pemeriksaan_fisik, input.pemeriksaan_khusus].filter(Boolean).join("\n");
  const triText = [input.riwayat_obstetri, input.riwayat_sekarang, input.keluhan_utama, input.kasus, input.pemeriksaan_khusus].filter(Boolean).join("\n");
  const dx = `${input.kasus ?? ""}\n${texts.interpretasi ?? ""}`;
  const tri = parseTrimester(triText);
  const triTxt = tri.trimester ? `trimester ${ROMAN[tri.trimester]}${tri.weeks ? `, ${tri.weeks} minggu` : ""}` : "trimester belum terbaca";

  // --- anemia ---
  const hbs = parseHb(dataText);
  const mentionsAnemia = /\banemia\b/i.test(dx);
  const claimed = /\banemia\b[^.,;]{0,30}?\b(ringan|sedang|berat)\b/i.exec(input.kasus ?? "")?.[1]?.toLowerCase();
  if (mentionsAnemia) {
    if (hbs.length === 0) {
      push("anemia-hb-kosong", "belum-bisa", "Diagnosis menyebut anemia, tetapi nilai Hb tidak terbaca", 'Tulis hasil Hb di "Pemeriksaan penunjang", mis. "Hb 10,2 g/dL", agar diagnosis bisa dicocokkan dengan data.', BASIS_HB);
    } else if (hbs.length > 1) {
      push("anemia-hb-ganda", "belum-bisa", "Ditemukan lebih dari satu nilai Hb", `Nilai terbaca: ${hbs.map(fmt).join(", ")} g/dL. Telaah tidak memilih salah satu; tulis hanya Hb yang dipakai untuk diagnosis, atau beri keterangan waktunya.`, BASIS_HB);
    } else {
      const hb = hbs[0];
      const r = classifyHbAny(hb, tri.trimester);
      if (r.anemia === null) {
        push("anemia-trimester", "belum-bisa", "Kategori Hb bergantung pada trimester yang belum terbaca", `Hb ${fmt(hb)} g/dL berada di rentang yang ditafsirkan berbeda antar trimester. Tulis usia kehamilan, mis. "usia kehamilan 30 minggu", di Riwayat kebidanan.`, BASIS_HB);
      } else if (r.anemia === false) {
        push("anemia-tidak-sesuai", "periksa", "Hb tidak memenuhi kriteria anemia", `Hb ${fmt(hb)} g/dL tidak termasuk anemia (${triTxt}). Periksa kembali diagnosis atau nilai Hb yang ditulis.`, BASIS_HB);
      } else if (claimed && r.levelKnown && r.level !== claimed) {
        push("anemia-derajat", "periksa", "Derajat anemia berbeda dengan data", `Diagnosis menyebut anemia ${claimed}, sedangkan Hb ${fmt(hb)} g/dL tergolong anemia ${r.level} menurut WHO 2024 (${triTxt}). Samakan, atau jelaskan bila kampus memakai acuan lain.`, BASIS_HB);
      } else if (claimed && !r.levelKnown) {
        push("anemia-derajat-trimester", "belum-bisa", "Derajat anemia belum bisa dicek", `Hb ${fmt(hb)} g/dL termasuk anemia, tetapi tingkat keparahannya bergantung pada trimester yang belum terbaca, sedangkan diagnosis menyebut ${claimed}.`, BASIS_HB);
      } else {
        push("anemia-sesuai", "sesuai", "Hb sesuai dengan diagnosis anemia", `Hb ${fmt(hb)} g/dL memenuhi kriteria anemia${r.levelKnown && r.level ? ` ${r.level}` : ""} (${triTxt}). Data tidak bertentangan dengan diagnosis; ini bukan penilaian bahwa diagnosis lengkapnya benar.`, BASIS_HB);
      }
    }
  } else if (hbs.length === 1) {
    const r = classifyHbAny(hbs[0], tri.trimester);
    if (r.anemia === true) {
      push("anemia-tidak-disebut", "periksa", "Data Hb menunjukkan anemia, tetapi diagnosis tidak menyebutnya", `Hb ${fmt(hbs[0])} g/dL memenuhi kriteria anemia (${triTxt}). Pastikan temuan ini sudah dipertimbangkan di diagnosis atau masalah.`, BASIS_HB);
    }
  }

  // --- KEK ---
  const lilas = parseLila(dataText);
  const mentionsKek = /\bkek\b|kurang\s+energi\s+kronik|kurang\s+energi\s+kronis/i.test(dx);
  if (mentionsKek) {
    if (lilas.length === 0) {
      push("kek-lila-kosong", "belum-bisa", "Diagnosis menyebut KEK, tetapi nilai LiLA tidak terbaca", 'Tulis hasil pengukuran di Pemeriksaan fisik, mis. "LiLA 22 cm".', BASIS_LILA);
    } else if (lilas.length > 1) {
      push("kek-lila-ganda", "belum-bisa", "Ditemukan lebih dari satu nilai LiLA", `Nilai terbaca: ${lilas.map(fmt).join(", ")} cm. Tulis hanya nilai yang dipakai untuk diagnosis.`, BASIS_LILA);
    } else if (lilas[0] < 23.5) {
      push("kek-sesuai", "sesuai", "LiLA sesuai dengan diagnosis KEK", `LiLA ${fmt(lilas[0])} cm di bawah 23,5 cm. Data tidak bertentangan dengan diagnosis.`, BASIS_LILA);
    } else {
      push("kek-tidak-sesuai", "periksa", "LiLA tidak memenuhi batas KEK", `LiLA ${fmt(lilas[0])} cm tidak di bawah 23,5 cm. Periksa kembali diagnosis atau nilai LiLA.`, BASIS_LILA);
    }
  } else if (lilas.length === 1 && lilas[0] < 23.5) {
    push("kek-tidak-disebut", "periksa", "LiLA menunjukkan risiko KEK, tetapi diagnosis tidak menyebutnya", `LiLA ${fmt(lilas[0])} cm di bawah 23,5 cm. Pastikan temuan ini sudah dipertimbangkan.`, BASIS_LILA);
  }

  const order: Record<ClinicalLevel, number> = { periksa: 0, "belum-bisa": 1, sesuai: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { applicable: true, findings, checked: CHECKED, notChecked: NOT_CHECKED };
}
