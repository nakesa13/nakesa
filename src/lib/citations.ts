import type { Author, CiteStyle, Source } from "./types";

/** Penanda rujukan di teks: [S1] atau [S1, S3]. */
export const MARKER_RE = /\[(S\d+(?:\s*[,;]\s*S\d+)*)\]/g;

export interface Seg {
  t: string;
  i?: boolean;
}

export function extractMarkerIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    for (const id of m[1].split(/\s*[,;]\s*/)) ids.push(id);
  }
  return ids;
}

/** Buang id yang tidak ada di daftar sumber; penanda yang jadi kosong dihapus. */
export function sanitizeMarkers(text: string, allowed: Set<string>): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const out = text.replace(/\s?\[(S\d+(?:\s*[,;]\s*S\d+)*)\]/g, (_full, group: string) => {
    const ids = group.split(/\s*[,;]\s*/);
    const keep = ids.filter((id) => {
      if (allowed.has(id)) return true;
      unknown.add(id);
      return false;
    });
    return keep.length ? ` [${keep.join(", ")}]` : "";
  });
  return { text: out, unknown: [...unknown] };
}

// ---------- format nama ----------

function initials(given: string | undefined): string[] {
  if (!given) return [];
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase());
}

function apaName(a: Author): string {
  const ini = initials(a.given);
  return ini.length ? `${a.family}, ${ini.map((x) => x + ".").join(" ")}` : a.family;
}

function vanName(a: Author): string {
  const ini = initials(a.given);
  return ini.length ? `${a.family} ${ini.join("")}` : a.family;
}

function apaAuthors(authors: Author[]): string {
  const n = authors.length;
  if (n === 0) return "";
  if (n === 1) return apaName(authors[0]);
  if (n === 2) return `${apaName(authors[0])}, & ${apaName(authors[1])}`;
  if (n <= 20) return `${authors.slice(0, -1).map(apaName).join(", ")}, & ${apaName(authors[n - 1])}`;
  return `${authors.slice(0, 19).map(apaName).join(", ")}, ... ${apaName(authors[n - 1])}`;
}

function vanAuthors(authors: Author[]): string {
  if (authors.length === 0) return "";
  const shown = authors.slice(0, 6).map(vanName).join(", ");
  return authors.length > 6 ? `${shown}, et al` : shown;
}

function endDot(s: string): string {
  return /[.?!]$/.test(s) ? s : s + ".";
}

function doiUrl(s: Source): string {
  if (s.doi) return `https://doi.org/${s.doi}`;
  return s.url ?? "";
}

// ---------- daftar pustaka ----------

export function formatApa(s: Source): Seg[] {
  const segs: Seg[] = [];
  const au = apaAuthors(s.authors);
  const year = s.year?.trim() || "n.d.";
  segs.push({ t: `${au ? endDot(au) + " " : ""}(${year}). ` });
  if (s.type === "jurnal") {
    segs.push({ t: endDot(s.title) + " " });
    if (s.journal) segs.push({ t: s.journal, i: true });
    if (s.volume) {
      segs.push({ t: ", " });
      segs.push({ t: s.volume, i: true });
    }
    if (s.issue) segs.push({ t: `(${s.issue})` });
    if (s.pages) segs.push({ t: `, ${s.pages}` });
    segs.push({ t: "." });
  } else {
    segs.push({ t: s.title, i: true });
    segs.push({ t: s.edition ? ` (${s.edition}).` : "." });
    if (s.publisher) segs.push({ t: ` ${endDot(s.publisher)}` });
  }
  const link = doiUrl(s);
  if (link) segs.push({ t: ` ${link}` });
  return segs;
}

export function formatVancouver(s: Source): Seg[] {
  const au = vanAuthors(s.authors);
  const year = s.year?.trim() || "tanpa tahun";
  const lead = au ? `${endDot(au)} ` : "";
  if (s.type === "jurnal") {
    let t = `${lead}${endDot(s.title)} ${s.journal ? endDot(s.journal) + " " : ""}${year}`;
    if (s.volume) t += `;${s.volume}`;
    if (s.issue) t += `(${s.issue})`;
    if (s.pages) t += `:${s.pages}`;
    t += ".";
    if (s.doi) t += ` doi:${s.doi}`;
    return [{ t }];
  }
  if (s.type === "buku" || s.type === "pedoman") {
    const ed = s.edition ? `${endDot(s.edition)} ` : "";
    const pub = s.publisher ? `${s.publisher}; ` : "";
    return [{ t: `${lead}${endDot(s.title)} ${ed}${pub}${year}.` }];
  }
  return [{ t: `${lead}${s.title} [Internet]. ${s.publisher ? s.publisher + "; " : ""}${year}.${s.url ? ` Tersedia pada: ${s.url}` : ""}` }];
}

// ---------- sitasi di teks ----------

function apaLabel(s: Source): string {
  const year = s.year?.trim() || "n.d.";
  const a = s.authors;
  let who: string;
  if (a.length === 0) who = s.title.split(/[:.]/)[0];
  else if (a.length === 1) who = a[0].family;
  else if (a.length === 2) who = `${a[0].family} & ${a[1].family}`;
  else who = `${a[0].family} et al.`;
  return `${who}, ${year}`;
}

/** Urutan id sumber sesuai kemunculan pertama di seluruh bagian. */
export function citedOrder(texts: string[], known: Set<string>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const t of texts) {
    for (const id of extractMarkerIds(t)) {
      if (known.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }
  return order;
}

/** Ganti [S1, S2] dengan (Penulis, Tahun) atau [1, 2] sesuai gaya. */
export function renderInText(
  text: string,
  sources: Map<string, Source>,
  style: CiteStyle,
  numbers: Map<string, number>
): string {
  return text.replace(/\s?\[(S\d+(?:\s*[,;]\s*S\d+)*)\]/g, (_full, group: string) => {
    const ids = group.split(/\s*[,;]\s*/).filter((id) => sources.has(id));
    if (!ids.length) return "";
    if (style === "Vancouver") {
      const nums = ids.map((id) => numbers.get(id)).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
      return ` [${nums.join(", ")}]`;
    }
    const labels = ids.map((id) => apaLabel(sources.get(id)!));
    return ` (${labels.join("; ")})`;
  });
}

export interface BibEntry {
  segs: Seg[];
  number?: number;
}

export function buildBibliography(order: string[], sources: Map<string, Source>, style: CiteStyle): BibEntry[] {
  const list = order.map((id) => sources.get(id)).filter((s): s is Source => !!s);
  if (style === "Vancouver") {
    return list.map((s, i) => ({ segs: formatVancouver(s), number: i + 1 }));
  }
  const key = (s: Source) => `${(s.authors[0]?.family ?? s.title).toLowerCase()}|${s.year}`;
  return [...list].sort((a, b) => key(a).localeCompare(key(b), "id")).map((s) => ({ segs: formatApa(s) }));
}

/** Urai teks penulis "Belakang, Awal" per baris menjadi daftar Author. */
export function parseAuthors(raw: string): Author[] {
  return raw
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(",");
      if (i > 0) return { family: l.slice(0, i).trim(), given: l.slice(i + 1).trim() };
      const parts = l.split(/\s+/);
      if (parts.length === 1) return { family: l };
      return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
    });
}

export function authorsToText(authors: Author[]): string {
  return authors.map((a) => (a.given ? `${a.family}, ${a.given}` : a.family)).join("\n");
}

const DOI_IN_TEXT = /\b(10\.\d{4,9}\/[^\s"<>]+?)(?=[\s"<>]|[.,;)]*(?:\s|$))/;

/** DOI pertama yang tertulis di awal teks (halaman depan jurnal), atau null. */
export function findDoi(text: string): string | null {
  const m = DOI_IN_TEXT.exec(text.slice(0, 4000));
  return m ? m[1].replace(/[.,;]+$/, "") : null;
}
