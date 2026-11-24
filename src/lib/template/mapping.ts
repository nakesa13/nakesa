import { COVER_FIELDS, type CoverField, type Mapping, type TocMode } from "./types";

const MAX_IDX = 100_000;
const idx = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MAX_IDX ? v : null);
const FIELD_IDS = new Set<string>(COVER_FIELDS.map((f) => f.id));
const TOC_MODES = new Set<string>(["keep", "replace", "add", "none"]);

/**
 * T11: pilihan pemetaan yang akan diabaikan atau menghasilkan dokumen yang tidak diharapkan. Dipakai untuk memberi tahu pengguna
 * SEBELUM dokumen dibuat (buildDocxFromTemplate membuang pilihan seperti ini secara diam-diam atau menolak bila awal isi tidak sah).
 * `total` = jumlah blok di template (Analysis.total).
 */
export function mappingIssues(m: Mapping, total: number): string[] {
  const out: string[] = [];
  if (m.bodyStart >= total) out.push("Awal isi berada di luar dokumen. Pilih ulang paragraf pertama isi.");
  if (m.bibHeading !== null && m.bibHeading <= m.bodyStart) {
    out.push("Judul Daftar Pustaka harus berada setelah awal isi. Pilihan ini diabaikan dan daftar pustaka ditambahkan di akhir.");
  }
  if (m.bibEnd !== null && (m.bibHeading === null || m.bibEnd <= m.bibHeading)) {
    out.push("Bagian setelah daftar pustaka harus berada sesudah judul Daftar Pustaka. Pilihan ini diabaikan.");
  }
  if (m.tocMode === "replace" && (m.tocHeading === null || m.tocHeading >= m.bodyStart)) {
    out.push('Mode "ganti daftar isi" butuh judul DAFTAR ISI yang berada sebelum awal isi. Tanpa itu daftar isi lama tidak diganti.');
  }
  const inBody = Object.keys(m.coverFields).filter((k) => Number(k) >= m.bodyStart);
  if (inBody.length) out.push(`Data sampul pada paragraf #${inBody.join(", #")} berada di dalam area isi dan diabaikan.`);
  return out;
}

/** Validasi pemetaan dari klien; kembalikan null bila bentuknya tidak sah. */
export function parseMapping(v: unknown): Mapping | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  const bodyStart = idx(m.bodyStart);
  if (bodyStart === null) return null;
  const opt = (x: unknown): number | null | undefined => (x === null || x === undefined ? null : (idx(x) ?? undefined));
  const bibHeading = opt(m.bibHeading);
  const bibEnd = opt(m.bibEnd);
  const bodyEnd = opt(m.bodyEnd);
  const tocHeading = opt(m.tocHeading);
  if (bibHeading === undefined || bibEnd === undefined || bodyEnd === undefined || tocHeading === undefined) return null;
  if (typeof m.tocMode !== "string" || !TOC_MODES.has(m.tocMode)) return null;

  const coverFields: Record<string, CoverField> = {};
  if (m.coverFields && typeof m.coverFields === "object") {
    const e = Object.entries(m.coverFields as Record<string, unknown>);
    if (e.length > 30) return null;
    for (const [k, f] of e) {
      if (idx(Number(k)) === null || typeof f !== "string" || !FIELD_IDS.has(f)) return null;
      coverFields[k] = f as CoverField;
    }
  }
  const s = (m.samples ?? {}) as Record<string, unknown>;
  const samples = { h1: opt(s.h1), h2: opt(s.h2), h3: opt(s.h3), body: opt(s.body) };
  if (Object.values(samples).some((x) => x === undefined)) return null;
  return {
    bodyStart,
    bodyEnd,
    bibHeading,
    bibEnd,
    coverFields,
    samples: samples as Mapping["samples"],
    tocMode: m.tocMode as TocMode,
    tocHeading,
  };
}
