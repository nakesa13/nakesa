import type { Input } from "./types";
import { MEASURE_KINDS, SERIAL_KEY, formatAt, hasAncData, parseSerial } from "./anc";

/**
 * T15: Data Validator ANC. Pemeriksaan DETERMINISTIK atas isian ANC mahasiswa: format dan keberadaan tanggal, satuan,
 * urutan waktu, HPHT/TP/usia kehamilan, dan notasi GPA. Murni (tanpa AI, tanpa jaringan, tanpa efek samping) dan
 * tidak mengubah isian.
 *
 * Batas yang disengaja:
 *  - TIDAK ada ambang atau rentang klinis (tekanan darah, nadi, suhu, DJJ, TFU, Hb, LiLA, batas usia kehamilan, dst.).
 *    Itu menunggu bank pedoman berstatus approved (T16); daftarnya ada di PENDING_RULES dan TIDAK dijalankan.
 *    Nilai klinis yang ekstrem sengaja menghasilkan temuan yang sama persis dengan nilai biasa (dikunci test).
 *  - Hanya menandai ketidakkonsistenan data (tanggal tidak ada, TP sebelum HPHT, satuan bertentangan, G < P + A + 1).
 *    Tidak menyatakan data "benar", tidak mendiagnosis, tidak mengoreksi, dan bukan pengganti pembimbing/bidan.
 *  - Tiap aturan punya id tetap, sumber (kind + ref), dan level di REGISTRY. Tidak ada aturan tanpa sumber.
 *  - Aturan hitung (TP/usia kehamilan) memakai konvensi kalender yang dicatat sumbernya, dengan hasil yang dibolehkan
 *    dilaporkan apa adanya: TP dari USG atau siklus tidak teratur wajar berbeda, jadi temuannya hanya "saran".
 */

export type ValidationLevel = "perlu" | "saran" | "belum-bisa";
export type RuleCategory = "tanggal" | "kronologi" | "hpht-tp" | "gpa" | "satuan" | "serial";

export interface RuleSource {
  /** format = bentuk isian aplikasi; kalender = fakta kalender; definisi = definisi istilah; konvensi = konvensi hitung. */
  kind: "format" | "kalender" | "definisi" | "konvensi";
  ref: string;
}

export interface ValidatorRule {
  id: string;
  category: RuleCategory;
  title: string;
  levels: ValidationLevel[];
  source: RuleSource;
}

export interface ValidationFinding {
  ruleId: string;
  level: ValidationLevel;
  /** Id isian (mis. "anc_hpht"); null bila tidak terikat satu kolom. */
  field: string | null;
  label: string;
  /** Untuk temuan pada pengukuran serial. */
  item?: { id: string; at: string; kind: string };
  reason: string;
  suggestion: string;
  source: RuleSource;
}

export interface PendingRule {
  id: string;
  title: string;
  blockedBy: string;
}

export interface ValidationReport {
  applicable: boolean;
  reason?: string;
  findings: ValidationFinding[];
  counts: Record<ValidationLevel, number>;
  /** Aturan yang datanya cukup sehingga benar-benar dijalankan pada masukan ini. */
  evaluated: string[];
  /** Aturan terdaftar yang TIDAK dijalankan karena datanya kosong: "tidak ada temuan" bukan berarti "dicek dan benar". */
  notEvaluated: string[];
  /** Pemeriksaan klinis yang belum ada: menunggu pedoman approved. */
  pending: PendingRule[];
  note: string;
}

export const VALIDATOR_NOTE =
  "Pemeriksaan data otomatis dengan aturan tetap (tanggal, satuan, urutan waktu, HPHT/TP, GPA). Ini bukan penilaian klinis dan tidak menyatakan data benar atau salah; nilai pemeriksaan tidak dinilai normal atau tidak normal. Tinjau temuan bersama pembimbing.";

/** Toleransi pembulatan penulisan usia kehamilan terhadap hitungan dari HPHT (hari). Bukan ambang klinis. */
export const UK_TOLERANCE_DAYS = 7;

// ---------- sumber aturan ----------

const SRC_FORM: RuleSource = { kind: "format", ref: "Bentuk isian formulir ANC aplikasi (contoh pengisian di tiap kolom)" };
const SRC_KALENDER: RuleSource = { kind: "kalender", ref: "Kalender Gregorian: jumlah hari per bulan dan tahun kabisat" };
const SRC_TAHUN: RuleSource = { kind: "format", ref: "Rentang tahun yang diterima aplikasi (1990 sampai 2100), sama dengan pengukuran serial (T09)" };
const SRC_URUTAN: RuleSource = { kind: "definisi", ref: "Urutan waktu: kehamilan dimulai pada HPHT; tanggal pengkajian atau pemeriksaan tidak mendahului HPHT dan tidak jatuh di masa depan" };
const SRC_TP: RuleSource = {
  kind: "konvensi",
  ref: "Perhitungan TP: HPHT + 280 hari (40 minggu) atau aturan Naegele (+7 hari, -3 bulan, +1 tahun; dua urutan operasi dan penjepitan akhir bulan). Konvensi hitung kalender dari buku ajar obstetri, bukan ambang klinis; belum terhubung ke bank pedoman (T16).",
};
const SRC_UK: RuleSource = { kind: "konvensi", ref: `Usia kehamilan = jumlah hari sejak HPHT dibagi 7 (1 minggu = 7 hari). Toleransi pembulatan penulisan ${UK_TOLERANCE_DAYS} hari. Konvensi hitung, bukan ambang klinis.` };
const SRC_UK_DEF: RuleSource = { kind: "definisi", ref: "Usia kehamilan ditulis minggu+hari; 1 minggu = 7 hari, sehingga hari berkisar 0 sampai 6" };
const SRC_GPA: RuleSource = { kind: "definisi", ref: "Notasi GPA: gravida mencakup kehamilan saat ini, sehingga G tidak kurang dari P + A + 1" };
const SRC_TD: RuleSource = { kind: "definisi", ref: "Definisi tekanan darah: ditulis sistolik/diastolik dalam mmHg, sistolik lebih besar dari diastolik" };
const SRC_SATUAN: RuleSource = { kind: "format", ref: "Satuan yang dipakai aplikasi di tabel dan dokumen (MEASURE_KINDS pada T09)" };
const SRC_SERIAL: RuleSource = { kind: "format", ref: "Format pengukuran serial bertimestamp (T09)" };

export const REGISTRY: ValidatorRule[] = [
  { id: "tanggal.format", category: "tanggal", title: "Tanggal tidak terbaca", levels: ["perlu"], source: SRC_FORM },
  { id: "tanggal.tidak-ada", category: "tanggal", title: "Tanggal tidak ada di kalender", levels: ["perlu"], source: SRC_KALENDER },
  { id: "tanggal.tahun", category: "tanggal", title: "Tahun di luar rentang", levels: ["perlu"], source: SRC_TAHUN },
  { id: "tanggal.ambigu", category: "tanggal", title: "Tanggal numerik bisa dibaca dua cara", levels: ["saran"], source: SRC_FORM },
  { id: "kronologi.tp-sebelum-hpht", category: "kronologi", title: "TP tidak setelah HPHT", levels: ["perlu"], source: SRC_URUTAN },
  { id: "kronologi.hpht-masa-depan", category: "kronologi", title: "HPHT di masa depan", levels: ["perlu"], source: SRC_URUTAN },
  { id: "kronologi.pengkajian-sebelum-hpht", category: "kronologi", title: "Tanggal pengkajian sebelum HPHT", levels: ["perlu"], source: SRC_URUTAN },
  { id: "kronologi.pengkajian-masa-depan", category: "kronologi", title: "Tanggal pengkajian di masa depan", levels: ["perlu"], source: SRC_URUTAN },
  { id: "kronologi.pengukuran-masa-depan", category: "kronologi", title: "Pengukuran bertanggal di masa depan", levels: ["perlu"], source: SRC_URUTAN },
  { id: "kronologi.pengukuran-sebelum-hpht", category: "kronologi", title: "Pengukuran bertanggal sebelum HPHT", levels: ["perlu", "saran"], source: SRC_URUTAN },
  { id: "hpht-tp.beda-hitungan", category: "hpht-tp", title: "TP berbeda dari hitungan standar HPHT", levels: ["saran"], source: SRC_TP },
  { id: "uk.format", category: "hpht-tp", title: "Usia kehamilan tidak terbaca", levels: ["saran"], source: SRC_FORM },
  { id: "uk.tanpa-satuan", category: "hpht-tp", title: "Usia kehamilan tanpa satuan", levels: ["saran"], source: SRC_FORM },
  { id: "uk.bulan", category: "hpht-tp", title: "Usia kehamilan ditulis dalam bulan", levels: ["saran"], source: SRC_FORM },
  { id: "uk.hari-tidak-sah", category: "hpht-tp", title: "Hari pada usia kehamilan 7 atau lebih", levels: ["perlu"], source: SRC_UK_DEF },
  { id: "uk.beda-hpht", category: "hpht-tp", title: "Usia kehamilan berbeda dari hitungan HPHT", levels: ["saran"], source: SRC_UK },
  { id: "uk.belum-bisa-dicek", category: "hpht-tp", title: "Usia kehamilan belum bisa dicocokkan dengan HPHT", levels: ["belum-bisa"], source: SRC_UK },
  { id: "kunjungan.format", category: "hpht-tp", title: "Nomor kunjungan ANC bukan bilangan bulat positif", levels: ["saran"], source: SRC_FORM },
  { id: "gpa.format", category: "gpa", title: "Gravida/Para/Abortus bukan bilangan bulat", levels: ["saran"], source: SRC_FORM },
  { id: "gpa.tidak-konsisten", category: "gpa", title: "Gravida kurang dari Para + Abortus + 1", levels: ["perlu"], source: SRC_GPA },
  { id: "gpa.beda-sumber", category: "gpa", title: "G/P/A di formulir berbeda dari yang tertulis di riwayat kebidanan", levels: ["saran"], source: SRC_FORM },
  { id: "satuan.tidak-sesuai", category: "satuan", title: "Satuan bertentangan dengan satuan aplikasi", levels: ["perlu"], source: SRC_SATUAN },
  { id: "format.td", category: "satuan", title: "Tekanan darah bukan bentuk sistolik/diastolik", levels: ["perlu"], source: SRC_TD },
  { id: "format.td-terbalik", category: "satuan", title: "Sistolik tidak lebih besar dari diastolik", levels: ["perlu"], source: SRC_TD },
  { id: "nilai.tidak-positif", category: "satuan", title: "Hasil pengukuran nol atau negatif", levels: ["perlu"], source: SRC_FORM },
  { id: "nilai.tanpa-angka", category: "satuan", title: "Hasil pengukuran tanpa angka", levels: ["saran"], source: SRC_FORM },
  { id: "serial.rusak", category: "serial", title: "Pengukuran serial rusak atau ada entri tidak sah", levels: ["perlu"], source: SRC_SERIAL },
  { id: "serial.ganda", category: "serial", title: "Pengukuran serial tercatat dua kali persis sama", levels: ["saran"], source: SRC_SERIAL },
];

const RULE_BY_ID = new Map(REGISTRY.map((r) => [r.id, r]));

/** Pemeriksaan klinis yang SENGAJA belum ada. Tidak dijalankan sampai pedomannya berstatus approved (T16). */
const BLOCK = "Menunggu pedoman berstatus approved di bank pedoman (T16)";
export const PENDING_RULES: PendingRule[] = [
  { id: "klinis.td-rentang", title: "Rentang tekanan darah (rendah/tinggi/hipertensi)", blockedBy: BLOCK },
  { id: "klinis.nadi-rr-suhu", title: "Rentang nadi, pernapasan, dan suhu", blockedBy: BLOCK },
  { id: "klinis.djj-rentang", title: "Rentang denyut jantung janin", blockedBy: BLOCK },
  { id: "klinis.tfu-vs-uk", title: "Kesesuaian TFU dengan usia kehamilan", blockedBy: BLOCK },
  { id: "klinis.hb-lila", title: "Ambang Hb dan LiLA (diperiksa terpisah oleh telaah klinis)", blockedBy: BLOCK },
  { id: "klinis.kenaikan-bb", title: "Kenaikan berat badan selama kehamilan", blockedBy: BLOCK },
  { id: "klinis.batas-uk", title: "Batas usia kehamilan (prematur, aterm, lewat bulan)", blockedBy: BLOCK },
  { id: "klinis.kunjungan-minimal", title: "Jumlah dan waktu kunjungan ANC yang seharusnya", blockedBy: BLOCK },
];

// ---------- tanggal ----------

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const DAY_MS = 86_400_000;

export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const dayNumber = (x: Ymd): number => Math.round(Date.UTC(x.y, x.m - 1, x.d) / DAY_MS);
const fromDayNumber = (n: number): Ymd => {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};
export const addDays = (x: Ymd, n: number): Ymd => fromDayNumber(dayNumber(x) + n);
/** Tambah bulan; bila hari tidak ada di bulan tujuan, dijepit ke hari terakhir bulan itu. */
export function addMonths(x: Ymd, n: number): Ymd {
  const total = x.y * 12 + (x.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (((total % 12) + 12) % 12) + 1;
  return { y, m, d: Math.min(x.d, daysInMonth(y, m)) };
}
export const formatYmd = (x: Ymd): string => `${x.d} ${MONTHS[x.m - 1]} ${x.y}`;
const sameYmd = (a: Ymd, b: Ymd): boolean => a.y === b.y && a.m === b.m && a.d === b.d;

const MONTH_WORDS: Record<string, number> = {
  januari: 1, jan: 1, january: 1,
  februari: 2, pebruari: 2, feb: 2, february: 2,
  maret: 3, mar: 3, march: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, jun: 6, june: 6,
  juli: 7, jul: 7, july: 7,
  agustus: 8, agu: 8, agt: 8, ags: 8, aug: 8, august: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10, october: 10,
  november: 11, nopember: 11, nov: 11,
  desember: 12, des: 12, dec: 12, december: 12,
};
const MW = Object.keys(MONTH_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const RE_ISO = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g;
const RE_NUM = /(?<!\d)(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})(?!\d)/g;
const RE_WORD = new RegExp(`(?<![\\p{L}\\d])(\\d{1,2})[\\s-]+(${MW})\\.?[\\s,-]*(\\d{4})(?!\\d)`, "giu");

export const YEAR_MIN = 1990;
export const YEAR_MAX = 2100;

export type DateFail = "format" | "banyak" | "tidak-ada" | "tahun";
export type ParsedDate = { ok: true; date: Ymd; ambiguous: boolean } | { ok: false; reason: DateFail };

/**
 * Baca satu tanggal dari teks bebas. Bentuk yang dikenal: 2026-03-12, 12/03/2026 (hari lebih dulu, kebiasaan Indonesia),
 * dan "12 Maret 2026" (nama bulan Indonesia atau Inggris, boleh disingkat). Teks lain di sekitarnya diabaikan.
 * Lebih dari satu tanggal berbeda = ambigu, tidak ditebak.
 */
export function parseDate(raw: string): ParsedDate {
  const cands: (Ymd & { ambiguous: boolean })[] = [];
  for (const m of raw.matchAll(RE_ISO)) cands.push({ y: +m[1], m: +m[2], d: +m[3], ambiguous: false });
  for (const m of raw.matchAll(RE_NUM)) {
    const d = +m[1];
    const mo = +m[2];
    cands.push({ y: +m[3], m: mo, d, ambiguous: d <= 12 && mo <= 12 && d !== mo });
  }
  for (const m of raw.matchAll(RE_WORD)) cands.push({ y: +m[3], m: MONTH_WORDS[m[2].toLowerCase()], d: +m[1], ambiguous: false });
  if (!cands.length) return { ok: false, reason: "format" };
  const distinct = new Set(cands.map((c) => `${c.y}-${c.m}-${c.d}`));
  if (distinct.size > 1) return { ok: false, reason: "banyak" };
  const c = cands[0];
  if (c.m < 1 || c.m > 12 || c.d < 1 || c.d > daysInMonth(c.y, c.m)) return { ok: false, reason: "tidak-ada" };
  if (c.y < YEAR_MIN || c.y > YEAR_MAX) return { ok: false, reason: "tahun" };
  return { ok: true, date: { y: c.y, m: c.m, d: c.d }, ambiguous: c.ambiguous };
}

/** Calon TP yang sah dari HPHT: +280 hari, Naegele (+7 hari lalu +9 bulan), dan Naegele (+9 bulan lalu +7 hari). */
export function tpCandidates(hpht: Ymd): { label: string; date: Ymd }[] {
  return [
    { label: "HPHT + 280 hari", date: addDays(hpht, 280) },
    { label: "aturan Naegele (+7 hari lalu -3 bulan +1 tahun)", date: addMonths(addDays(hpht, 7), 9) },
    { label: "aturan Naegele (-3 bulan +1 tahun lalu +7 hari)", date: addDays(addMonths(hpht, 9), 7) },
  ];
}

/** Tanggal hari ini menurut waktu setempat, "YYYY-MM-DD". Dipisah supaya pemeriksa tetap murni (hari ini dioper dari luar). */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// ---------- usia kehamilan ----------

export type ParsedUk =
  | { kind: "minggu"; weeks: number; days: number }
  | { kind: "bulan" }
  | { kind: "angka" }
  | { kind: "tidak-terbaca" };

export function parseUk(raw: string): ParsedUk {
  const s = raw.trim();
  const plus = /^(\d{1,2})\s*\+\s*(\d{1,2})$/.exec(s);
  if (plus) return { kind: "minggu", weeks: +plus[1], days: +plus[2] };
  const w = /(?<!\d)(\d{1,2})\s*(?:\+\s*(\d{1,2}))?\s*(?:minggu|mgg|mg)(?![\p{L}])(?:\s*[+,]?\s*(\d{1,2})\s*(?:hari|hr)(?![\p{L}]))?/iu.exec(s);
  if (w) return { kind: "minggu", weeks: +w[1], days: w[2] !== undefined ? +w[2] : w[3] !== undefined ? +w[3] : 0 };
  if (/(?<!\d)\d{1,2}(?:[.,]\d)?\s*bulan(?![\p{L}])/iu.test(s)) return { kind: "bulan" };
  if (/^\d{1,2}$/.test(s)) return { kind: "angka" };
  return { kind: "tidak-terbaca" };
}

// ---------- satuan dan nilai ----------

type ValueKind = "td" | "nadi" | "rr" | "suhu" | "bb" | "tb" | "djj" | "tfu" | "hb" | "lila";

const PER_TIME_BAD = /^(?:(?:x|kali|denyut)?\/(?:detik|dtk|sec|s|jam|hari)|hz)(?![a-z])/;
const LEN_BAD = /^(?:mm|m|meter|inch|inci|in|ft|kaki)(?![a-z])/;

/** Hanya satuan yang JELAS bertentangan yang ditandai; satuan tak dikenal dibiarkan (hindari salah tanda). */
const UNIT_SPEC: Record<ValueKind, { name: string; unit: string; example: string; bad: RegExp }> = {
  td: { name: "Tekanan darah", unit: "mmHg", example: "110/70 mmHg", bad: /^(?:cmhg|kpa|mmh2o)/ },
  nadi: { name: "Nadi", unit: "x/menit", example: "80 x/menit", bad: PER_TIME_BAD },
  rr: { name: "Pernapasan", unit: "x/menit", example: "20 x/menit", bad: PER_TIME_BAD },
  djj: { name: "DJJ", unit: "x/menit", example: "140 x/menit", bad: PER_TIME_BAD },
  suhu: { name: "Suhu", unit: "°C", example: "36,5 °C", bad: /^(?:°?f(?![a-z])|fahrenheit|°?k(?![a-z])|kelvin)/ },
  bb: { name: "Berat badan", unit: "kg", example: "60 kg", bad: /^(?:g|gr|gram|mg|lb|lbs|pound)(?![a-z])/ },
  tb: { name: "Tinggi badan", unit: "cm", example: "155 cm", bad: LEN_BAD },
  tfu: { name: "TFU", unit: "cm", example: "28 cm", bad: LEN_BAD },
  lila: { name: "LiLA", unit: "cm", example: "24 cm", bad: LEN_BAD },
  hb: { name: "Hb", unit: "g/dL", example: "10,2 g/dL", bad: /^(?:mg\/dl|g\/l|gr\/l|mmol\/l|mg%)/ },
};

const TD_RE = /(?<!\d)(\d{1,3})\s*\/\s*(\d{1,3})(?!\d)/;
const NUM_RE = /(\d+(?:[.,]\d+)?)/;
const num = (s: string): number => Number(s.replace(",", "."));
const compact = (s: string): string => s.replace(/\s+/g, "").toLowerCase().replace(/[º˚]/g, "°");

interface ValueIssue {
  ruleId: string;
  reason: string;
  suggestion: string;
}

function badUnit(kind: ValueKind, rest: string): ValueIssue | null {
  const spec = UNIT_SPEC[kind];
  const c = compact(rest);
  if (!spec.bad.test(c)) return null;
  const token = /^[^\d,;()]{1,14}/.exec(c)?.[0] ?? c.slice(0, 14);
  return {
    ruleId: "satuan.tidak-sesuai",
    reason: `${spec.name}: satuan tertulis "${token}", sedangkan aplikasi memakai ${spec.unit}.`,
    suggestion: `Konversikan ke ${spec.unit} lalu tulis ulang, mis. "${spec.example}". Aplikasi tidak mengubah angka untuk Anda.`,
  };
}

/** Periksa satu hasil pengukuran: bentuk, tanda, dan satuan. TIDAK menilai besar nilainya. */
export function checkValue(kind: ValueKind, raw: string): ValueIssue[] {
  const out: ValueIssue[] = [];
  if (kind === "td") {
    const m = TD_RE.exec(raw);
    if (!m) {
      out.push({
        ruleId: "format.td",
        reason: "Tekanan darah tidak tertulis dalam bentuk sistolik/diastolik (dua angka dipisah garis miring).",
        suggestion: 'Tulis seperti "110/70 mmHg". Bila hanya satu angka yang diperiksa, tulis keterangannya di kolom catatan.',
      });
      return out;
    }
    const sys = +m[1];
    const dia = +m[2];
    if (sys === 0 || dia === 0) {
      out.push({ ruleId: "nilai.tidak-positif", reason: `Tekanan darah tertulis ${m[0]}: angka nol tidak mungkin menjadi hasil pengukuran.`, suggestion: "Periksa kembali angka yang diketik." });
    } else if (sys <= dia) {
      out.push({
        ruleId: "format.td-terbalik",
        reason: `Tekanan darah ${m[0]}: sistolik (${sys}) tidak lebih besar dari diastolik (${dia}).`,
        suggestion: "Periksa urutan angkanya; sistolik ditulis lebih dulu, mis. 110/70.",
      });
    }
    const unit = badUnit("td", raw.slice((m.index ?? 0) + m[0].length));
    if (unit) out.push(unit);
    return out;
  }
  const m = NUM_RE.exec(raw);
  if (!m) {
    out.push({ ruleId: "nilai.tanpa-angka", reason: `${UNIT_SPEC[kind].name}: hasil tidak memuat angka ("${raw.trim().slice(0, 40)}").`, suggestion: `Tulis angkanya beserta satuan, mis. "${UNIT_SPEC[kind].example}".` });
    return out;
  }
  if (num(m[1]) <= 0) {
    out.push({ ruleId: "nilai.tidak-positif", reason: `${UNIT_SPEC[kind].name}: hasil tertulis ${m[1]}, angka nol tidak mungkin menjadi hasil pengukuran.`, suggestion: "Periksa kembali angka yang diketik." });
  }
  const unit = badUnit(kind, raw.slice((m.index ?? 0) + m[1].length));
  if (unit) out.push(unit);
  return out;
}

// ---------- gravida, para, abortus ----------

const parseCount = (raw: string, letter: string): number | null => {
  const m = new RegExp(`^\\s*(?:${letter}\\s*)?(\\d{1,2})\\s*$`, "i").exec(raw);
  return m ? +m[1] : null;
};
const GPA_TEXT = /(?<![\p{L}\d])G\s*(\d{1,2})\s*P\s*(\d{1,2})\s*A\s*(\d{1,2})(?!\d)/iu;

// ---------- pemeriksa ----------

const VALUE_FIELDS: { id: string; label: string; kind: ValueKind }[] = [
  { id: "td", label: "Tekanan darah", kind: "td" },
  { id: "nadi", label: "Nadi", kind: "nadi" },
  { id: "rr", label: "Pernapasan", kind: "rr" },
  { id: "suhu", label: "Suhu", kind: "suhu" },
  { id: "bb", label: "Berat badan", kind: "bb" },
  { id: "tb", label: "Tinggi badan", kind: "tb" },
  { id: "anc_tfu", label: "Tinggi fundus uteri (TFU)", kind: "tfu" },
  { id: "anc_djj", label: "Denyut jantung janin (DJJ)", kind: "djj" },
];

const DATE_FIELDS = [
  { id: "anc_hpht", label: "HPHT" },
  { id: "anc_tp", label: "Taksiran persalinan (TP)" },
  { id: "tanggal", label: "Tanggal pengkajian" },
];

const LEVEL_ORDER: Record<ValidationLevel, number> = { perlu: 0, saran: 1, "belum-bisa": 2 };
const clip = (s: string, n = 50): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function validateAnc(input: Input, opts: { today?: string } = {}): ValidationReport {
  const empty = (reason: string): ValidationReport => ({
    applicable: false,
    reason,
    findings: [],
    counts: { perlu: 0, saran: 0, "belum-bisa": 0 },
    evaluated: [],
    notEvaluated: REGISTRY.map((r) => r.id),
    pending: PENDING_RULES,
    note: VALIDATOR_NOTE,
  });
  if (!hasAncData(input)) return empty("Pemeriksa ini hanya untuk asuhan kehamilan (ANC) atau bila ada kolom data ANC yang terisi.");

  const findings: ValidationFinding[] = [];
  const ran = new Set<string>();
  const add = (ruleId: string, level: ValidationLevel, field: string | null, label: string, reason: string, suggestion: string, item?: ValidationFinding["item"]) => {
    const rule = RULE_BY_ID.get(ruleId);
    if (!rule) throw new Error(`Aturan tidak terdaftar: ${ruleId}`);
    findings.push({ ruleId, level, field, label, ...(item ? { item } : {}), reason, suggestion, source: rule.source });
  };
  const val = (id: string): string => (input[id] ?? "").trim();

  // ===== tanggal =====
  const dates: Record<string, Ymd | undefined> = {};
  for (const f of DATE_FIELDS) {
    const raw = val(f.id);
    if (!raw) continue;
    for (const id of ["tanggal.format", "tanggal.tidak-ada", "tanggal.tahun", "tanggal.ambigu"]) ran.add(id);
    const p = parseDate(raw);
    if (!p.ok) {
      if (p.reason === "tidak-ada") {
        add("tanggal.tidak-ada", "perlu", f.id, f.label, `Tanggal "${clip(raw)}" tidak ada di kalender (hari atau bulan di luar batas).`, "Periksa hari dan bulannya. Aplikasi membaca tanggal numerik dengan hari lebih dulu (12/03/2026 = 12 Maret 2026).");
      } else if (p.reason === "tahun") {
        add("tanggal.tahun", "perlu", f.id, f.label, `Tahun pada "${clip(raw)}" di luar rentang ${YEAR_MIN} sampai ${YEAR_MAX}.`, "Periksa kembali tahun yang diketik.");
      } else if (p.reason === "banyak") {
        add("tanggal.format", "perlu", f.id, f.label, `Kolom ini memuat lebih dari satu tanggal yang berbeda ("${clip(raw)}"), jadi tidak bisa dipastikan mana yang dimaksud.`, "Isi satu tanggal saja di kolom ini.");
      } else {
        add("tanggal.format", "perlu", f.id, f.label, `Tanggal tidak terbaca ("${clip(raw)}").`, 'Tulis tanggal lengkap dengan hari, bulan, dan tahun, mis. "12 Maret 2026" atau 2026-03-12.');
      }
      continue;
    }
    dates[f.id] = p.date;
    if (p.ambiguous) {
      add("tanggal.ambigu", "saran", f.id, f.label, `"${clip(raw)}" dibaca sebagai ${formatYmd(p.date)} (hari lebih dulu), tetapi bisa juga dibaca bulan lebih dulu.`, 'Tulis nama bulan dengan huruf agar tidak salah dibaca, mis. "12 Maret 2026".');
    }
  }
  const H = dates.anc_hpht;
  const TPd = dates.anc_tp;
  const R = dates.tanggal;
  const todayP = opts.today ? parseDate(opts.today) : null;
  const today = todayP?.ok ? todayP.date : undefined;

  // ===== kronologi dan HPHT/TP =====
  if (H && TPd) {
    ran.add("kronologi.tp-sebelum-hpht");
    if (dayNumber(TPd) <= dayNumber(H)) {
      add("kronologi.tp-sebelum-hpht", "perlu", "anc_tp", "Taksiran persalinan (TP)", `TP (${formatYmd(TPd)}) tidak jatuh setelah HPHT (${formatYmd(H)}).`, "Periksa tanggal HPHT dan TP; TP selalu setelah HPHT.");
    } else {
      ran.add("hpht-tp.beda-hitungan");
      const cands = tpCandidates(H);
      if (!cands.some((c) => sameYmd(c.date, TPd))) {
        const near = cands.reduce((a, b) => (Math.abs(dayNumber(b.date) - dayNumber(TPd)) < Math.abs(dayNumber(a.date) - dayNumber(TPd)) ? b : a));
        const gap = dayNumber(TPd) - dayNumber(near.date);
        add(
          "hpht-tp.beda-hitungan",
          "saran",
          "anc_tp",
          "Taksiran persalinan (TP)",
          `TP ${formatYmd(TPd)} berbeda ${Math.abs(gap)} hari dari hitungan terdekat (${near.label}: ${formatYmd(near.date)}). Hitungan lain: ${cands.filter((c) => c !== near).map((c) => `${formatYmd(c.date)} (${c.label})`).join("; ")}.`,
          "Wajar berbeda bila TP ditetapkan dari USG atau siklus tidak teratur; tulis dasar penetapannya di riwayat kebidanan. Bila TP dihitung dari HPHT, periksa kembali perhitungannya."
        );
      }
    }
  }
  if (H && today) {
    ran.add("kronologi.hpht-masa-depan");
    if (dayNumber(H) > dayNumber(today)) add("kronologi.hpht-masa-depan", "perlu", "anc_hpht", "HPHT", `HPHT (${formatYmd(H)}) jatuh setelah hari ini (${formatYmd(today)}).`, "Periksa kembali tanggal HPHT, terutama tahunnya.");
  }
  if (R && today) {
    ran.add("kronologi.pengkajian-masa-depan");
    if (dayNumber(R) > dayNumber(today)) add("kronologi.pengkajian-masa-depan", "perlu", "tanggal", "Tanggal pengkajian", `Tanggal pengkajian (${formatYmd(R)}) jatuh setelah hari ini (${formatYmd(today)}).`, "Isi tanggal pengkajian yang sebenarnya.");
  }
  if (H && R) {
    ran.add("kronologi.pengkajian-sebelum-hpht");
    if (dayNumber(R) < dayNumber(H)) add("kronologi.pengkajian-sebelum-hpht", "perlu", "tanggal", "Tanggal pengkajian", `Tanggal pengkajian (${formatYmd(R)}) sebelum HPHT (${formatYmd(H)}).`, "Periksa tanggal pengkajian dan HPHT.");
  }

  // ===== usia kehamilan =====
  const ukRaw = val("anc_uk");
  if (ukRaw) {
    // Aturan bentuk penulisan ikut dievaluasi begitu kolom terisi, termasuk bila hasilnya lolos.
    for (const id of ["uk.format", "uk.tanpa-satuan", "uk.bulan", "uk.hari-tidak-sah"]) ran.add(id);
    const uk = parseUk(ukRaw);
    if (uk.kind === "tidak-terbaca") {
      ran.add("uk.format");
      add("uk.format", "saran", "anc_uk", "Usia kehamilan", `Usia kehamilan tidak terbaca ("${clip(ukRaw)}").`, 'Tulis dalam minggu, mis. "28 minggu" atau "28 minggu 3 hari".');
    } else if (uk.kind === "angka") {
      ran.add("uk.tanpa-satuan");
      add("uk.tanpa-satuan", "saran", "anc_uk", "Usia kehamilan", `Usia kehamilan "${ukRaw}" tidak memakai satuan, jadi tidak dicocokkan dengan HPHT.`, 'Tambahkan satuan, mis. "28 minggu".');
    } else if (uk.kind === "bulan") {
      ran.add("uk.bulan");
      add("uk.bulan", "saran", "anc_uk", "Usia kehamilan", "Usia kehamilan ditulis dalam bulan; aplikasi tidak mengubahnya ke minggu dan tidak mencocokkannya dengan HPHT.", 'Tulis dalam minggu, mis. "28 minggu".');
    } else if (uk.days >= 7) {
      ran.add("uk.hari-tidak-sah");
      add("uk.hari-tidak-sah", "perlu", "anc_uk", "Usia kehamilan", `Usia kehamilan "${clip(ukRaw)}" memuat ${uk.days} hari; 7 hari sudah menjadi 1 minggu.`, `Tulis hari antara 0 dan 6, mis. "${uk.weeks + Math.floor(uk.days / 7)} minggu ${uk.days % 7} hari" bila itu yang dimaksud.`);
    } else if (uk.weeks === 0 && uk.days === 0) {
      ran.add("nilai.tidak-positif");
      add("nilai.tidak-positif", "perlu", "anc_uk", "Usia kehamilan", "Usia kehamilan tertulis 0 minggu 0 hari.", "Periksa kembali usia kehamilan yang diketik.");
    } else {
      const written = uk.weeks * 7 + uk.days;
      if (H && R && dayNumber(R) >= dayNumber(H)) {
        ran.add("uk.beda-hpht");
        const calc = dayNumber(R) - dayNumber(H);
        if (Math.abs(written - calc) > UK_TOLERANCE_DAYS) {
          add(
            "uk.beda-hpht",
            "saran",
            "anc_uk",
            "Usia kehamilan",
            `Usia kehamilan tertulis ${uk.weeks} minggu${uk.days ? ` ${uk.days} hari` : ""}, sedangkan HPHT ${formatYmd(H)} sampai tanggal pengkajian ${formatYmd(R)} berjarak ${Math.floor(calc / 7)} minggu ${calc % 7} hari (selisih ${Math.abs(written - calc)} hari, toleransi ${UK_TOLERANCE_DAYS} hari).`,
            "Wajar berbeda bila usia kehamilan ditetapkan dari USG; tulis dasarnya. Bila dari HPHT, periksa HPHT, tanggal pengkajian, dan usia kehamilan."
          );
        }
      } else if (!(H && R)) {
        ran.add("uk.belum-bisa-dicek");
        const missing = [!H && "HPHT", !R && "tanggal pengkajian"].filter(Boolean).join(" dan ");
        add("uk.belum-bisa-dicek", "belum-bisa", "anc_uk", "Usia kehamilan", `Usia kehamilan belum bisa dicocokkan dengan HPHT karena ${missing} belum terisi atau tidak terbaca.`, "Isi (atau perbaiki) kolom itu bila ingin usia kehamilan diperiksa terhadap HPHT.");
      }
    }
  }

  // ===== kunjungan =====
  const kunjungan = val("anc_kunjungan");
  if (kunjungan) {
    ran.add("kunjungan.format");
    const m = /^(?:ke\s*-?\s*)?(\d{1,2})$/i.exec(kunjungan);
    if (!m || +m[1] < 1) add("kunjungan.format", "saran", "anc_kunjungan", "Kunjungan ANC ke", `Nomor kunjungan "${clip(kunjungan)}" bukan bilangan bulat mulai dari 1.`, 'Tulis angka saja, mis. "4".');
  }

  // ===== gravida, para, abortus =====
  const gpaFields = [
    { id: "anc_gravida", label: "Gravida", letter: "G" },
    { id: "anc_para", label: "Para", letter: "P" },
    { id: "anc_abortus", label: "Abortus", letter: "A" },
  ];
  const fromForm: (number | null)[] = [];
  for (const f of gpaFields) {
    const raw = val(f.id);
    if (!raw) {
      fromForm.push(null);
      continue;
    }
    ran.add("gpa.format");
    const n = parseCount(raw, f.letter);
    if (n === null) add("gpa.format", "saran", f.id, f.label, `${f.label} "${clip(raw)}" bukan bilangan bulat.`, 'Tulis angka saja, mis. "2".');
    fromForm.push(n);
  }
  const t = GPA_TEXT.exec(input.riwayat_obstetri ?? "");
  const fromText: (number | null)[] = t ? [+t[1], +t[2], +t[3]] : [null, null, null];
  const conflicts = gpaFields.filter((f, i) => fromForm[i] !== null && fromText[i] !== null && fromForm[i] !== fromText[i]);
  // Dievaluasi bila ada minimal satu kolom yang terisi di kedua sumber (hasilnya boleh lolos).
  if (gpaFields.some((_, i) => fromForm[i] !== null && fromText[i] !== null)) ran.add("gpa.beda-sumber");
  if (conflicts.length) {
    ran.add("gpa.beda-sumber");
    add(
      "gpa.beda-sumber",
      "saran",
      null,
      "Gravida / Para / Abortus",
      `Formulir ANC dan riwayat kebidanan menulis nilai berbeda: ${conflicts.map((f) => `${f.label} ${fromForm[gpaFields.indexOf(f)]} (formulir) vs ${fromText[gpaFields.indexOf(f)]} (riwayat)`).join("; ")}.`,
      "Samakan kedua isian dengan data anamnesis yang sebenarnya."
    );
  }
  const [G, P, A] = [0, 1, 2].map((i) => fromForm[i] ?? fromText[i]);
  if (G !== null && G !== undefined) {
    ran.add("gpa.tidak-konsisten");
    const need = (P ?? 0) + (A ?? 0) + 1;
    if (G < need) {
      add(
        "gpa.tidak-konsisten",
        "perlu",
        "anc_gravida",
        "Gravida / Para / Abortus",
        `Gravida mencakup kehamilan saat ini, jadi G tidak boleh kurang dari P + A + 1. Tertulis G=${G}, P=${P ?? "kosong"}, A=${A ?? "kosong"} (minimal G=${need}).`,
        "Periksa kembali jumlah kehamilan, persalinan, dan keguguran dari anamnesis."
      );
    }
  }

  // ===== satuan dan nilai (kolom tunggal) =====
  for (const f of VALUE_FIELDS) {
    const raw = val(f.id);
    if (!raw) continue;
    for (const id of ["satuan.tidak-sesuai", "format.td", "format.td-terbalik", "nilai.tidak-positif", "nilai.tanpa-angka"]) ran.add(id);
    for (const issue of checkValue(f.kind, raw)) add(issue.ruleId, RULE_BY_ID.get(issue.ruleId)!.levels[0], f.id, f.label, issue.reason, issue.suggestion);
  }

  // ===== pengukuran serial =====
  const serialRaw = input[SERIAL_KEY];
  if (serialRaw && serialRaw.trim()) {
    ran.add("serial.rusak");
    const ps = parseSerial(serialRaw);
    if (ps.corrupt) {
      add("serial.rusak", "perlu", SERIAL_KEY, "Pengukuran serial", "Isi pengukuran serial rusak dan tidak bisa dibaca, jadi tidak ada pengukuran yang dipakai.", "Tambahkan ulang pengukuran lewat kotak Pengukuran serial.");
    } else if (ps.dropped > 0) {
      add("serial.rusak", "perlu", SERIAL_KEY, "Pengukuran serial", `${ps.dropped} pengukuran tidak sah dan dibuang saat dibaca (waktu, jenis, atau hasil tidak valid).`, "Periksa daftar pengukuran dan tambahkan ulang yang hilang.");
    }
    const kindLabel = (k: string) => MEASURE_KINDS.find((x) => x.id === k)?.label ?? k;
    const seen = new Map<string, string[]>();
    if (ps.items.length) ran.add("serial.ganda");
    for (const it of ps.items) {
      const at = { id: it.id, at: it.at, kind: it.kind };
      const where = `Pengukuran serial: ${kindLabel(it.kind)}, ${formatAt(it.at)}`;
      for (const id of ["satuan.tidak-sesuai", "format.td", "format.td-terbalik", "nilai.tidak-positif", "nilai.tanpa-angka"]) ran.add(id);
      for (const issue of checkValue(it.kind, it.value)) add(issue.ruleId, RULE_BY_ID.get(issue.ruleId)!.levels[0], SERIAL_KEY, where, issue.reason, issue.suggestion, at);

      const d = parseDate(it.at.slice(0, 10));
      if (d.ok) {
        if (today) {
          ran.add("kronologi.pengukuran-masa-depan");
          if (dayNumber(d.date) > dayNumber(today)) add("kronologi.pengukuran-masa-depan", "perlu", SERIAL_KEY, where, `Pengukuran ini bertanggal ${formatYmd(d.date)}, setelah hari ini (${formatYmd(today)}).`, "Periksa tanggal dan jam pengukuran.", at);
        }
        if (H) {
          ran.add("kronologi.pengukuran-sebelum-hpht");
          if (dayNumber(d.date) < dayNumber(H)) {
            const onlyPregnancy = it.kind === "djj" || it.kind === "tfu";
            add(
              "kronologi.pengukuran-sebelum-hpht",
              onlyPregnancy ? "perlu" : "saran",
              SERIAL_KEY,
              where,
              onlyPregnancy ? `${kindLabel(it.kind)} hanya ada selama kehamilan, tetapi pengukuran ini bertanggal ${formatYmd(d.date)}, sebelum HPHT (${formatYmd(H)}).` : `Pengukuran ini bertanggal ${formatYmd(d.date)}, sebelum HPHT (${formatYmd(H)}).`,
              onlyPregnancy ? "Periksa tanggal pengukuran dan HPHT." : "Wajar bila ini data sebelum hamil (mis. berat badan awal); bila bukan, periksa tanggalnya.",
              at
            );
          }
        }
      }
      const key = `${it.kind}|${it.at}|${it.value.toLowerCase().replace(/\s+/g, "").replace(",", ".")}`;
      seen.set(key, [...(seen.get(key) ?? []), it.id]);
    }
    for (const ids of seen.values()) {
      if (ids.length < 2) continue;
      const first = ps.items.find((x) => x.id === ids[0])!;
      add("serial.ganda", "saran", SERIAL_KEY, `Pengukuran serial: ${kindLabel(first.kind)}, ${formatAt(first.at)}`, `Pengukuran yang sama persis (jenis, waktu, dan hasil) tercatat ${ids.length} kali (${ids.join(", ")}).`, "Hapus salah satunya bila memang hanya diukur sekali. Dua hasil berbeda pada waktu yang sama tidak dianggap ganda.", { id: first.id, at: first.at, kind: first.kind });
    }
  }

  findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const counts: Record<ValidationLevel, number> = { perlu: 0, saran: 0, "belum-bisa": 0 };
  for (const f of findings) counts[f.level]++;
  return {
    applicable: true,
    findings,
    counts,
    evaluated: REGISTRY.map((r) => r.id).filter((id) => ran.has(id)),
    notEvaluated: REGISTRY.map((r) => r.id).filter((id) => !ran.has(id)),
    pending: PENDING_RULES,
    note: VALIDATOR_NOTE,
  };
}
