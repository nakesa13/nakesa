import type { DoiCheck, Input } from "./types";
import { doiContentCheck } from "./provenance";

/**
 * T10: Reading Journal. Murni (tanpa node:*), aman dipakai di klien dan server.
 * Prinsip:
 * - Ringkasan hanya dari teks artikel. Yang tidak tertulis di teks = "Tidak dilaporkan dalam artikel." (bukan ditebak).
 * - Statistik, nilai p, dan nama penulis yang tidak ada di teks ditandai (bukan dihapus diam-diam).
 * - Teks yang kemungkinan tidak lengkap (hanya abstrak, PDF terbaca sebagian, bagian penting tidak ditemukan) ditandai, bukan dianggap lengkap.
 * - DOI yang sah belum tentu artikelnya cocok dengan teks; ketidakcocokan mencabut status "terverifikasi".
 */

export const TIDAK_DILAPORKAN = "Tidak dilaporkan dalam artikel.";
export const TIDAK_DAPAT_DINILAI = "Tidak dapat dinilai dari teks yang tersedia.";

// ---------- cakupan teks ----------

/** Asal teks yang diringkas. Disimpan di isian j_scope; nilai tak dikenal dianggap "manual" (asal tidak diketahui). */
export type JournalScope = "abstrak" | "file" | "file-sebagian" | "manual";
const SCOPES: JournalScope[] = ["abstrak", "file", "file-sebagian", "manual"];

export function parseScope(v: string | undefined | null): JournalScope {
  return SCOPES.includes(v as JournalScope) ? (v as JournalScope) : "manual";
}

/** Catatan cakupan untuk tabel identitas di dokumen. Kosong bila teks bukan abstrak/sebagian (tidak ada yang perlu dicatat). */
export function scopeNote(v: string | undefined | null): string {
  const s = parseScope(v);
  if (s === "abstrak") return "Hanya abstrak (bukan artikel lengkap)";
  if (s === "file-sebagian") return "Sebagian: PDF hanya terbaca sebagian";
  return "";
}

/** Teks lebih pendek dari ini dianggap kemungkinan tidak lengkap (artikel penuh biasanya jauh lebih panjang). */
export const SHORT_TEXT = 2500;

const PARTS: { label: string; words: string }[] = [
  { label: "pendahuluan/latar belakang", words: "pendahuluan|latar belakang|introduction|background" },
  { label: "metode", words: "metode|metodologi|methods?|methodology|materials? and methods|desain penelitian|bahan dan metode" },
  { label: "hasil", words: "hasil|results?|findings" },
  { label: "kesimpulan", words: "kesimpulan|simpulan|conclusions?" },
];

/** Bagian dianggap ada bila ada baris judul pendek yang diawali kata kunci, atau kata kunci HURUF BESAR di mana saja. */
function hasPart(text: string, words: string): boolean {
  const heading = new RegExp(`^[^\\S\\n]*(?:\\d+(?:\\.\\d+)*[.)]?\\s+|[IVX]+[.)]\\s+|[A-Z][.)]\\s+)?(?:${words})\\b[^\\n]{0,60}$`, "im");
  if (heading.test(text)) return true;
  return new RegExp(`\\b(?:${words.toUpperCase()})\\b`).test(text);
}

export interface JournalAssessment {
  level: "cukup" | "sebagian";
  /** Bagian penting yang tidak ditemukan di teks. */
  missing: string[];
  /** Penjelasan untuk pengguna dan untuk prompt AI. */
  notes: string[];
}

/**
 * Menilai apakah teks tampak lengkap. Ini petunjuk, bukan bukti: "cukup" tidak menjamin teks utuh, dan
 * "sebagian" tidak menghalangi pembuatan ringkasan; bagian yang tidak ada di teks ditulis "Tidak dilaporkan".
 */
export function assessJournalText(text: string, scope?: string | null): JournalAssessment {
  const t = text.trim();
  const sc = parseScope(scope);
  const missing = PARTS.filter((p) => !hasPart(t, p.words)).map((p) => p.label);
  const notes: string[] = [];
  if (sc === "abstrak") notes.push("Teks hanya abstrak dari Crossref, bukan artikel lengkap.");
  if (sc === "file-sebagian") notes.push("PDF hanya terbaca sebagian (sebagian halaman kemungkinan berupa gambar/scan).");
  if (t.length < SHORT_TEXT) notes.push(`Teks pendek (${t.length} karakter).`);
  if (missing.length) notes.push(`Bagian yang tidak ditemukan di teks: ${missing.join(", ")}.`);
  const partial = sc === "abstrak" || sc === "file-sebagian" || t.length < SHORT_TEXT || missing.length >= 2;
  return { level: partial ? "sebagian" : "cukup", missing, notes };
}

// ---------- DOI vs isi ----------

/**
 * Kecocokan metadata Crossref dengan teks yang dilampirkan. Hanya dinilai bila metadata memang berasal dari Crossref
 * dan ada teks selain abstrak (abstrak dari Crossref pasti cocok dengan dirinya sendiri, jadi tidak berarti apa-apa).
 */
export function journalDoiCheck(input: Input): DoiCheck {
  const title = (input.j_title ?? "").trim();
  const text = (input.j_text ?? "").trim();
  if (input.j_origin !== "crossref" || !(input.j_doi ?? "").trim() || !title || !text || parseScope(input.j_scope) === "abstrak") {
    return "tidak-dapat-dinilai";
  }
  return doiContentCheck(title, text);
}

// ---------- statistik dan nama penulis ----------

const norm = (s: string): string => s.replace(/\s/g, "").replace(/,/g, ".");
const NUM_ALL = /\d+(?:[.,]\d+)?/g;
const TOK = "\\d+(?:[.,]\\d+)?";
// Angka yang pasti statistik: persentase, nilai p dan n, OR/RR/HR/IK/CI/SD, rerata/median. Berlaku juga untuk satu digit
// (findUnsupportedAny di case.ts melewati angka satu digit, sehingga "5%" lolos di sana).
const STAT_RE = new RegExp(
  `(?:\\b[pPnN]\\s*[=<>≤≥]\\s*|\\b(?:aOR|OR|RR|HR|IK|CI|SD|SB)\\s*[=:]?\\s*|\\b(?:rerata|rata-rata|mean|median)\\s*(?:adalah|sebesar|=|:)?\\s*)(${TOK})|(${TOK})\\s*%`,
  "gu"
);

/** Angka statistik di keluaran yang tidak ada di teks jurnal. Mengembalikan angka sebagaimana ditulis di keluaran. */
export function findUnsupportedStats(output: string, corpus: string): string[] {
  const known = new Set<string>();
  for (const m of corpus.matchAll(NUM_ALL)) known.add(norm(m[0]));
  const bad = new Set<string>();
  for (const m of output.matchAll(STAT_RE)) {
    const tok = (m[1] ?? m[2] ?? "").trim();
    if (tok && !known.has(norm(tok))) bad.add(tok);
  }
  return [...bad];
}

const NAME = "\\p{Lu}[\\p{L}'’-]{2,}";
const ETAL_RE = new RegExp(`\\b(${NAME})\\s+(?:et\\s+al\\.?|dkk\\.?)`, "gu");
const PAREN_RE = new RegExp(`\\(\\s*(${NAME})(?:\\s+(?:et\\s+al\\.?|dkk\\.?|&|dan)(?:\\s+${NAME})?)?\\s*,\\s*(?:19|20)\\d{2}[a-z]?\\s*\\)`, "gu");

/**
 * Nama penulis yang disebut dengan pola "Nama et al./dkk." atau "(Nama, 2020)" tetapi tidak ada di teks/metadata.
 * Pemeriksaan ini terbatas pada dua pola itu; nama yang ditulis tanpa pola tersebut tidak terdeteksi.
 */
export function findUnsupportedAuthors(output: string, corpus: string): string[] {
  const hay = corpus.toLowerCase();
  const out = new Map<string, string>();
  for (const re of [ETAL_RE, PAREN_RE]) {
    for (const m of output.matchAll(re)) {
      const n = m[1];
      const k = n.toLowerCase();
      if (!hay.includes(k) && !out.has(k)) out.set(k, n);
    }
  }
  return [...out.values()];
}

// ---------- prompt ----------

/** Baris prompt khusus Reading Journal: dari teks saja, "tidak dilaporkan", ringkasan terpisah dari telaah kritis. */
export function journalPromptLines(appraisal: boolean, input: Input, sourceText: string): string[] {
  const lines = [
    `ATURAN KHUSUS READING JOURNAL (menggantikan aturan 4): Isi bagian ini HANYA dari teks di dalam <isi_sumber>; jangan memakai pengetahuan di luar teks itu. Bila informasi yang diminta tidak tertulis di teks, tulis persis "${TIDAK_DILAPORKAN}" dan jangan menebak. Jangan menulis angka, persentase, nilai p, interval kepercayaan, ukuran efek, ukuran sampel, atau nama penulis yang tidak tertulis di teks.`,
    appraisal
      ? `JENIS BAGIAN: TELAAH KRITIS (penilaian, terpisah dari ringkasan). Dasarkan setiap poin pada hal yang tertulis di teks dan nyatakan sebagai penilaian terhadap artikel, bukan sebagai isi artikel. Hal yang tidak dapat dinilai dari teks, tulis: "${TIDAK_DAPAT_DINILAI}"`
      : "JENIS BAGIAN: RINGKASAN. Laporkan apa yang dinyatakan penulis artikel. Jangan menilai, memuji, atau mengkritik.",
  ];
  const a = assessJournalText(sourceText, input.j_scope);
  if (a.level === "sebagian") {
    lines.push(`CAKUPAN TEKS: ${a.notes.join(" ")} Untuk hal yang tidak tertulis di teks yang tersedia, tulis persis "${TIDAK_DILAPORKAN}" dan jangan melengkapinya dari pengetahuan sendiri.`);
  }
  return lines;
}
