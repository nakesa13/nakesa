import type { Provenance, Source } from "./types";
import { normalizeDoi } from "./crossref";
import { extractMarkerIds } from "./citations";

/**
 * T13: inti reference manager. Murni (tanpa node:*), dipakai di klien (SourceManager, Wizard) dan server (ai.ts).
 *  - status sumber bertingkat, diturunkan dari fakta (bukan dari satu bendera `verified`), turun bila data berubah;
 *  - deteksi sumber ganda;
 *  - analisis rujukan: penanda tanpa sumber, sumber yang tidak pernah dirujuk;
 *  - nomor sumber yang tidak dipakai ulang.
 * Status ini petunjuk bagi mahasiswa, bukan bukti keaslian sumber dan bukan nilai mutu: verifikasi sebenarnya hanya
 * "metadata cocok dengan Crossref" dan "judul cocok dengan awal isi".
 */

/** Panjang minimum isi agar sumber boleh dikutip AI (sama dengan aturan di ai.ts dan Wizard). */
export const MIN_SOURCE_CONTENT = 200;

// ---------- sidik jari perubahan ----------

/** cyrb53: hash 53-bit cepat. Hanya untuk mendeteksi perubahan, bukan untuk keamanan. */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const hex = (...parts: string[]): string => cyrb53(parts.join("\u0001")).toString(16).padStart(14, "0");
const squash = (s?: string): string => (s ?? "").replace(/\s+/g, " ").trim();

type Checkable = Pick<Source, "title" | "authors" | "year" | "doi" | "content">;

/** Sidik jari metadata yang diverifikasi: judul, penulis, tahun, DOI. Spasi berlebih dan huruf besar/kecil DOI tidak dihitung. */
export function metaFingerprint(s: Checkable): string {
  const authors = (s.authors ?? []).map((a) => `${squash(a.family)},${squash(a.given)}`).join(";");
  return hex(squash(s.title), authors, squash(s.year), normalizeDoi(s.doi ?? "").toLowerCase());
}

/** Sidik jari isi sumber. Perubahan spasi saja tidak dihitung. */
export function contentFingerprint(s: Pick<Source, "content">): string {
  return hex(squash(s.content));
}

/** Catat keadaan metadata dan isi saat ini sebagai "yang diverifikasi/diperiksa". Tanpa provenance tidak ada yang dicatat. */
export function stampChecks<T extends Checkable & { provenance?: Provenance }>(s: T): T {
  if (!s.provenance) return s;
  return { ...s, provenance: { ...s.provenance, metaFp: metaFingerprint(s), contentFp: contentFingerprint(s) } };
}

// ---------- DOI ----------

const doiKey = (d?: string): string => normalizeDoi(d ?? "").toLowerCase();

/** DOI sama setelah awalan URL, "doi:", spasi, dan huruf besar/kecil dinormalkan. DOI kosong tidak pernah sama. */
export function sameDoi(a?: string, b?: string): boolean {
  const x = doiKey(a);
  return x !== "" && x === doiKey(b);
}

// ---------- status bertingkat ----------

export type SourceLevel = "perlu-tinjau" | "manual" | "metadata" | "isi" | "terverifikasi";

export interface SourceStatus {
  level: SourceLevel;
  /** -1 perlu-tinjau, 0 manual, 1 metadata, 2 isi, 3 terverifikasi. Untuk mengurutkan, bukan skor mutu. */
  rank: number;
  label: string;
  /** Boleh dikutip AI: isi cukup panjang dan tidak berstatus perlu-tinjau. */
  citable: boolean;
  reasons: string[];
}

const LEVELS: Record<SourceLevel, { rank: number; label: string }> = {
  "perlu-tinjau": { rank: -1, label: "Perlu ditinjau" },
  manual: { rank: 0, label: "Isian manual, tanpa isi" },
  metadata: { rank: 1, label: "Metadata terverifikasi, tanpa isi" },
  isi: { rank: 2, label: "Isi tersedia, belum terverifikasi" },
  terverifikasi: { rank: 3, label: "Terverifikasi, isi tersedia" },
};

export function sourceStatus(s: Source): SourceStatus {
  const p = s.provenance;
  const reasons: string[] = [];
  const usable = (s.content ?? "").trim().length >= MIN_SOURCE_CONTENT;

  // Stempel verifikasi/pemeriksaan yang tidak lagi cocok dengan data sekarang = data diubah sesudahnya.
  const metaChanged = !!p?.metaFp && p.metaFp !== metaFingerprint(s);
  const contentChanged = !!p?.contentFp && p.contentFp !== contentFingerprint(s);

  // "verified" dari penyimpanan/klien tidak dipercaya begitu saja: harus berasal dari Crossref dan punya DOI.
  const crossrefBacked = s.origin === "crossref" && !!s.doi;
  if (s.verified && !crossrefBacked) reasons.push("Ditandai terverifikasi tetapi tidak berasal dari DOI/Crossref: dianggap isian manual.");
  if (s.verified && crossrefBacked && metaChanged) reasons.push("Metadata diubah setelah diverifikasi: verifikasi Crossref tidak berlaku lagi.");
  const verified = s.verified && crossrefBacked && !metaChanged;

  // Pemeriksaan kecocokan DOI dengan isi hanya berlaku untuk isi yang diperiksa dan DOI yang diperiksa.
  if (contentChanged && p?.doiCheck) reasons.push("Isi diubah setelah pemeriksaan kecocokan DOI: pemeriksaan itu tidak berlaku lagi.");
  const check = contentChanged ? undefined : p?.doiCheck;
  const doiWasChecked = !!s.doi && (!p?.doiInText || sameDoi(s.doi, p.doiInText));
  const mismatch = check === "tidak-cocok" && doiWasChecked;
  if (mismatch) reasons.push("DOI tidak cocok dengan isi: judul dari Crossref tidak muncul di bagian awal isi. Periksa apakah DOI ini memang milik artikel yang dilampirkan.");
  if (check === "tidak-dapat-dinilai" && doiWasChecked) reasons.push("Kecocokan DOI dengan isi belum bisa dipastikan.");
  if (p?.doiInText && s.doi && !sameDoi(s.doi, p.doiInText)) reasons.push("DOI sumber berbeda dari DOI yang tertulis di isi: periksa kembali.");
  if (!usable) reasons.push("Tanpa isi (minimal 200 karakter): tidak dikutip AI.");

  let level: SourceLevel;
  if (mismatch) level = "perlu-tinjau";
  else if (verified && usable && (check === "cocok" || (p?.method === "doi" && !contentChanged))) level = "terverifikasi";
  else if (verified && !usable) level = "metadata";
  else if (usable) level = "isi";
  else level = "manual";

  return { level, ...LEVELS[level], citable: usable && level !== "perlu-tinjau", reasons };
}

export const isCitable = (s: Source): boolean => sourceStatus(s).citable;

// ---------- perubahan oleh pengguna ----------

type Editable = Checkable & Pick<Source, "origin" | "verified"> & { provenance?: Provenance };

/**
 * Hasil penyuntingan sumber oleh pengguna: bila metadata yang pernah diverifikasi diubah, status turun menjadi
 * isian manual; bila isi diubah, hasil pemeriksaan kecocokan DOI dibuang. Stempel lama yang sudah tidak berlaku dibuang.
 */
export function reconcileEdit<T extends Editable>(prev: T | undefined, next: T): T {
  if (!prev) return next;
  const metaChanged = metaFingerprint(prev) !== metaFingerprint(next);
  const contentChanged = contentFingerprint(prev) !== contentFingerprint(next);
  if (!metaChanged && !contentChanged) return next;
  let out = next;
  if (metaChanged && prev.verified) out = { ...out, verified: false, origin: "manual" };
  if (out.provenance) {
    const prov = { ...out.provenance };
    if (metaChanged) delete prov.metaFp;
    if (contentChanged) {
      delete prov.contentFp;
      delete prov.doiCheck;
    }
    out = { ...out, provenance: prov };
  }
  return out;
}

// ---------- sumber ganda ----------

type Dup = Pick<Source, "doi" | "title" | "year" | "authors">;

const norm = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const titleKey = (s: Dup): string => `${norm(s.title)}|${s.year.trim()}|${norm(s.authors[0]?.family ?? "")}`;

/** Ganda menurut DOI (pasti) atau menurut judul + tahun + penulis pertama (kemungkinan). */
export function duplicateBy(a: Dup, b: Dup): "doi" | "judul" | null {
  if (sameDoi(a.doi, b.doi)) return "doi";
  if (norm(a.title) !== "" && titleKey(a) === titleKey(b)) return "judul";
  return null;
}

export function findDuplicateOf(list: (Dup & { id: string })[], draft: Dup): { id: string; by: "doi" | "judul" } | null {
  let byTitle: { id: string; by: "judul" } | null = null;
  for (const s of list) {
    const by = duplicateBy(s, draft);
    if (by === "doi") return { id: s.id, by };
    if (by && !byTitle) byTitle = { id: s.id, by };
  }
  return byTitle;
}

export interface DuplicateGroup {
  ids: string[];
  by: "doi" | "judul";
}

export function findDuplicates(list: (Dup & { id: string })[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const bucket = (key: (s: Dup) => string, by: DuplicateGroup["by"]) => {
    const m = new Map<string, string[]>();
    for (const s of list) {
      const k = key(s);
      if (!k) continue;
      m.set(k, [...(m.get(k) ?? []), s.id]);
    }
    for (const ids of m.values()) if (ids.length > 1) groups.push({ ids, by });
  };
  bucket((s) => doiKey(s.doi), "doi");
  const doiGroups = groups.map((g) => new Set(g.ids));
  bucket((s) => (norm(s.title) ? titleKey(s) : ""), "judul");
  // Kelompok judul yang seluruhnya sudah tercakup satu kelompok DOI tidak dilaporkan dua kali.
  return groups.filter((g) => g.by === "doi" || !doiGroups.some((d) => g.ids.every((id) => d.has(id))));
}

// ---------- rujukan yatim ----------

export interface RefAnalysis {
  /** Id sumber yang dirujuk di teks dan ada di daftar, urut kemunculan pertama. */
  cited: string[];
  /** Penanda di teks yang tidak punya sumber (sumber dihapus atau penanda karangan). */
  dangling: string[];
  /** Sumber di daftar yang tidak pernah dirujuk di teks (tidak masuk daftar pustaka). */
  uncited: string[];
  /** Sumber yang dirujuk padahal tidak boleh dikutip AI (tanpa isi atau perlu ditinjau). */
  citedNotCitable: string[];
}

export function analyzeReferences(texts: string[], sources: Source[]): RefAnalysis {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const cited: string[] = [];
  const dangling: string[] = [];
  for (const t of texts) {
    for (const id of extractMarkerIds(t)) {
      if (byId.has(id)) {
        if (!cited.includes(id)) cited.push(id);
      } else if (!dangling.includes(id)) dangling.push(id);
    }
  }
  return {
    cited,
    dangling,
    uncited: sources.filter((s) => !cited.includes(s.id)).map((s) => s.id),
    citedNotCitable: cited.filter((id) => !isCitable(byId.get(id)!)),
  };
}

// ---------- nomor sumber ----------

/**
 * Nomor berikutnya (S<n>). Nomor yang masih tertulis sebagai penanda di teks (`reserved`) ikut dihitung, supaya
 * menghapus sumber lalu menambah yang baru tidak membuat penanda lama menunjuk diam-diam ke sumber yang berbeda.
 */
export function nextSourceId(list: { id: string }[], reserved: Iterable<string> = []): string {
  let max = 0;
  for (const id of [...list.map((s) => s.id), ...reserved]) max = Math.max(max, Number(id.replace(/\D/g, "")) || 0);
  return `S${max + 1}`;
}
