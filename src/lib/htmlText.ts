/**
 * Mengubah halaman web menjadi teks bacaan dan membaca metadata artikel (tag Highwire/Dublin Core/OpenGraph).
 * Murni string; tanpa DOM. Hasil metadata hanya USULAN: pengguna wajib memeriksanya sebelum disimpan.
 */

export interface PageMeta {
  title: string;
  authors: string[];
  year: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  publisher: string;
  type: "jurnal" | "web";
}

const ENT: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", copy: "©", deg: "°",
  plusmn: "±", times: "×", micro: "µ", middot: "·", bull: "•", eacute: "é", egrave: "è", agrave: "à",
  ouml: "ö", uuml: "ü", auml: "ä", ntilde: "ñ", ccedil: "ç", alpha: "α", beta: "β", gamma: "γ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

const stripControl = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");

function pickLargest(html: string, tag: string): string | undefined {
  const found = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))].map((m) => m[1]);
  return found.sort((a, b) => b.length - a.length)[0];
}

/** Teks utama halaman: buang skrip, menu, footer; utamakan <article>/<main>; baris menu pendek berurutan dibuang. */
export function htmlToText(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ");
  h = h.replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|aside|form|button|select)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const art = pickLargest(h, "article");
  const main = pickLargest(h, "main");
  let region = art && art.length > 800 ? art : main && main.length > 800 ? main : h;
  region = region
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|dd|dt|figcaption)\s*>/gi, "\n\n")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  region = stripControl(decodeEntities(region))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const out: string[] = [];
  let shortRun: string[] = [];
  const flush = () => {
    if (shortRun.length < 4) out.push(...shortRun); // run pendek >= 4 baris = menu/daftar tautan
    shortRun = [];
  };
  for (const line of region.split("\n")) {
    const t = line.trim();
    if (t === "") {
      flush();
      out.push("");
    } else if (t.length < 20) shortRun.push(t);
    else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function readMetas(html: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const m of html.slice(0, 250_000).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const c = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const val = c ? decodeEntities((c[1] ?? c[2] ?? "").trim()).replace(/\s+/g, " ") : "";
    if (!name || !val) continue;
    const list = map.get(name) ?? [];
    list.push(val);
    map.set(name, list);
  }
  return map;
}

const DOI_RE = /10\.\d{4,9}\/[^\s"<>]+/;

export function extractMeta(html: string): PageMeta {
  const m = readMetas(html);
  const first = (...keys: string[]) => {
    for (const k of keys) {
      const v = m.get(k)?.[0];
      if (v) return v;
    }
    return "";
  };
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = first("citation_title", "dc.title", "og:title", "twitter:title") || (titleTag ? decodeEntities(titleTag).replace(/\s+/g, " ").trim() : "");

  const authorsRaw = m.get("citation_author") ?? m.get("dc.creator") ?? m.get("author") ?? [];
  const authors = [...new Set(authorsRaw.map((a) => a.trim()).filter(Boolean))].slice(0, 20);

  const dateRaw = first("citation_publication_date", "citation_date", "citation_online_date", "dc.date", "prism.publicationdate", "article:published_time");
  const year = /\b(19|20)\d{2}\b/.exec(dateRaw)?.[0] ?? "";

  const doiRaw = first("citation_doi", "prism.doi", "dc.identifier", "doi");
  const doi = (DOI_RE.exec(doiRaw)?.[0] ?? "").replace(/[.,;]+$/, "");

  const fp = first("citation_firstpage");
  const lp = first("citation_lastpage");
  const pages = fp && lp ? `${fp}-${lp}` : fp;

  const journal = first("citation_journal_title", "prism.publicationname");
  return {
    title,
    authors,
    year,
    journal,
    volume: first("citation_volume", "prism.volume"),
    issue: first("citation_issue", "prism.number"),
    pages,
    doi,
    publisher: first("citation_publisher", "dc.publisher", "og:site_name"),
    type: journal || doi ? "jurnal" : "web",
  };
}

/** Pilih charset dari header Content-Type atau tag meta di awal dokumen. */
export function sniffCharset(contentType: string, head: string): string {
  const h = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  return (h || meta || "utf-8").toLowerCase();
}
