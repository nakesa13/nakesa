/**
 * Pembaca angka klinis dari teks bebas isian mahasiswa. Prinsip: bila angka tidak terbaca atau
 * ambigu, hasilnya kosong; pemanggil harus menyatakan "belum bisa dicek", tidak boleh menebak.
 */

export const toNum = (s: string): number => Number(s.replace(",", "."));

const distinct = (xs: number[]): number[] => [...new Set(xs)];

function numbers(text: string, re: RegExp, min: number, max: number): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(re)) {
    const n = toNum(m[1]);
    if (Number.isFinite(n) && n >= min && n <= max) out.push(n);
  }
  return distinct(out);
}

/** Nilai Hb (g/dL) yang tertulis, mis. "Hb 10,2 g/dL". Lebih dari satu nilai berbeda = ambigu (pemanggil yang menangani). */
export function parseHb(text: string): number[] {
  return numbers(text, /\b(?:hb|hemoglobin|haemoglobin)\b[^0-9\n]{0,15}(\d{1,2}(?:[.,]\d{1,2})?)(?!\d)/gi, 3, 20);
}

/** Nilai LiLA (cm), mis. "LiLA 22 cm". */
export function parseLila(text: string): number[] {
  return numbers(text, /\b(?:lila|lingkar\s+lengan\s+atas)\b[^0-9\n]{0,15}(\d{1,2}(?:[.,]\d)?)(?!\d)/gi, 10, 50);
}

export type Trimester = 1 | 2 | 3;

/** Trimester menurut tabel WHO 2024: T1 <=13 minggu, T2 14-27, T3 >=28. */
export const trimesterOfWeeks = (w: number): Trimester => (w <= 13 ? 1 : w <= 27 ? 2 : 3);

const WEEKS_RES: RegExp[] = [
  /\b(?:usia|umur)\s+kehamilan\b[^0-9\n]{0,12}(\d{1,2})(?:\s*[-+/]\s*\d)?\s*(?:minggu|mgg|mg)\b/gi,
  /\b(?:uk|ug)\b[^0-9\n]{0,6}(\d{1,2})(?:\s*[-+/]\s*\d)?\s*(?:minggu|mgg|mg)\b/gi,
  /\bhamil\s+(\d{1,2})(?:\s*[-+/]\s*\d)?\s*(?:minggu|mgg|mg)\b/gi,
];

const ROMAN: Record<string, Trimester> = { i: 1, "1": 1, satu: 1, ii: 2, "2": 2, dua: 2, iii: 3, "3": 3, tiga: 3 };

export interface TrimesterInfo {
  trimester: Trimester | null;
  weeks: number | null;
  /** "minggu" = dari usia kehamilan tertulis; "teks" = dari kata "trimester" yang ditulis; null = tidak terbaca/ambigu. */
  from: "minggu" | "teks" | null;
}

export function parseTrimester(text: string): TrimesterInfo {
  const weeks = distinct(WEEKS_RES.flatMap((re) => numbers(text, re, 4, 42)));
  const byWeeks = distinct(weeks.map(trimesterOfWeeks));
  if (byWeeks.length === 1) return { trimester: byWeeks[0] as Trimester, weeks: weeks.length === 1 ? weeks[0] : null, from: "minggu" };
  if (byWeeks.length > 1) return { trimester: null, weeks: null, from: null };

  const named: Trimester[] = [];
  for (const m of text.matchAll(/\b(?:trimester|tm)\s*(iii|ii|i|1|2|3|satu|dua|tiga)\b/gi)) {
    const t = ROMAN[m[1].toLowerCase()];
    if (t) named.push(t);
  }
  const byText = distinct(named);
  if (byText.length === 1) return { trimester: byText[0] as Trimester, weeks: null, from: "teks" };
  return { trimester: null, weeks: null, from: null };
}
