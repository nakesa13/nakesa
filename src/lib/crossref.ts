import type { Author, Source } from "./types";

export const DOI_RE = /^10\.\d{4,9}\/\S+$/;

export function normalizeDoi(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}

interface CrossrefWork {
  title?: string[];
  author?: { family?: string; given?: string; name?: string }[];
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  type?: string;
  abstract?: string;
  URL?: string;
}

function stripJats(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*Abstract\s*/i, "")
    .trim();
}

/** Ambil metadata resmi dari Crossref. Mengembalikan Source tanpa id (diberi oleh pemanggil). */
export async function lookupDoi(rawDoi: string): Promise<Omit<Source, "id">> {
  const doi = normalizeDoi(rawDoi);
  if (!DOI_RE.test(doi)) throw new Error("Format DOI tidak valid. Contoh: 10.1000/xyz123");

  const path = doi.split("/").map(encodeURIComponent).join("/");
  const mailto = process.env.CROSSREF_MAILTO;
  let res: Response;
  try {
    res = await fetch(`https://api.crossref.org/works/${path}`, {
      headers: { "User-Agent": `NAKESA/0.1${mailto ? ` (mailto:${mailto})` : ""}` },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("Tidak dapat menghubungi Crossref saat ini. Coba lagi, atau isi sumber secara manual.");
  }
  if (res.status === 404) throw new Error("DOI tidak ditemukan di Crossref. Periksa kembali, atau isi manual.");
  if (!res.ok) throw new Error(`Crossref tidak dapat dihubungi (status ${res.status}).`);

  const work = ((await res.json()) as { message?: CrossrefWork }).message;
  if (!work?.title?.[0]) throw new Error("Metadata DOI tidak lengkap. Isi manual.");

  const authors: Author[] = (work.author ?? [])
    .map((a) => (a.family ? { family: a.family, given: a.given } : a.name ? { family: a.name } : null))
    .filter((a): a is Author => !!a);

  const type: Source["type"] = work.type === "journal-article" ? "jurnal" : work.type === "book" || work.type === "monograph" ? "buku" : "web";
  const abstract = work.abstract ? stripJats(work.abstract) : "";

  return {
    type,
    title: work.title[0].replace(/\s+/g, " ").trim(),
    authors,
    year: String(work.issued?.["date-parts"]?.[0]?.[0] ?? ""),
    publisher: work.publisher,
    journal: work["container-title"]?.[0],
    volume: work.volume,
    issue: work.issue,
    pages: work.page,
    doi,
    url: work.URL,
    content: abstract.length >= 200 ? abstract : undefined,
    origin: "crossref",
    verified: true,
  };
}
