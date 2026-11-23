import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { DOI_RE, normalizeDoi } from "./crossref";
import { ExtractError, MAX_SOURCE_BYTES, MAX_SOURCE_CHARS, MIN_SOURCE_CHARS, decodeEntities, extractSourceText, tidy, type ExtractedSource } from "./extract";
import { sha256Hex } from "./hash";
import { UrlImportError, assertPublicAddress, parsePublicUrl } from "./netguard";
import type { Provenance } from "./types";

/**
 * T04: impor sumber dari URL. Hanya di server.
 *
 * Pertahanan, berurutan: URL divalidasi (http/https, tanpa kredensial, port tertentu, bukan host internal) ->
 * nama host di-resolve dan SEMUA alamatnya harus publik -> koneksi dibuat ke alamat yang sudah diperiksa itu
 * (bukan resolve ulang, jadi DNS rebinding tidak berlaku) -> pengalihan diikuti manual, tiap tujuan diperiksa ulang ->
 * batas waktu total, batas ukuran saat membaca, dan daftar tipe konten.
 * Isi yang diambil adalah data tidak tepercaya: hanya diubah menjadi teks, tidak pernah dijalankan atau dianggap instruksi.
 */

export const MAX_URL_BYTES = MAX_SOURCE_BYTES;
export const URL_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 4;

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const ALLOWED_MIME = new Set(["application/pdf", "text/html", "application/xhtml+xml", "text/plain", "text/markdown"]);

// ---------- transport (dapat diganti di test) ----------

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}

export interface FetchDeps {
  /** Semua alamat IP untuk sebuah nama host. */
  resolve(host: string): Promise<string[]>;
  /** Satu permintaan GET ke `address` (bukan ke nama host), tanpa mengikuti pengalihan. */
  request(target: { url: URL; address: string; signal: AbortSignal }): Promise<RawResponse>;
}

export const defaultDeps: FetchDeps = {
  async resolve(host) {
    const r = await lookup(host, { all: true, verbatim: true });
    return r.map((x) => x.address);
  },
  request({ url, address, signal }) {
    return new Promise<RawResponse>((resolve, reject) => {
      const secure = url.protocol === "https:";
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const base = {
        host: address, // koneksi ke IP yang sudah diperiksa
        port: url.port ? Number(url.port) : secure ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false as const,
        headers: {
          Host: url.host,
          "User-Agent": "NAKESA/0.1 (impor-sumber)",
          Accept: "application/pdf,text/html,text/plain;q=0.8",
          "Accept-Encoding": "identity", // tanpa kompresi: tidak ada risiko bom dekompresi
          Connection: "close",
        },
      };
      const onResponse = (res: http.IncomingMessage) =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, destroy: () => res.destroy() });
      const req = secure
        ? https.request({ ...base, servername: isIP(hostname) ? undefined : hostname }, onResponse)
        : http.request(base, onResponse);
      req.on("error", reject);
      const abort = () => req.destroy();
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
      req.end();
    });
  },
};

// ---------- pengambilan aman ----------

class TimeoutError extends Error {}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new TimeoutError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TimeoutError());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

const headerValue = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

const withoutHash = (u: URL): string => {
  const c = new URL(u.href);
  c.hash = "";
  return c.href;
};

async function pickPublicAddress(url: URL, deps: FetchDeps, signal: AbortSignal): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    assertPublicAddress(host);
    return host;
  }
  let addresses: string[];
  try {
    addresses = await raceAbort(deps.resolve(host), signal);
  } catch (e) {
    if (e instanceof TimeoutError) throw e;
    throw new UrlImportError("Alamat situs tidak ditemukan.", 502);
  }
  if (addresses.length === 0) throw new UrlImportError("Alamat situs tidak ditemukan.", 502);
  // Satu alamat non-publik saja sudah cukup untuk menolak: penyerang bisa mengisi DNS dengan campuran.
  for (const a of addresses) assertPublicAddress(a);
  return addresses[0];
}

async function readLimited(res: RawResponse, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const it = res.body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const r = await raceAbort(it.next(), signal);
      if (r.done) break;
      total += r.value.length;
      if (total > maxBytes) throw new UrlImportError("Ukuran file melebihi batas 10 MB.", 413);
      chunks.push(r.value);
    }
  } catch (e) {
    res.destroy();
    throw e;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export interface FetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface FetchedResource {
  requestedUrl: string;
  finalUrl: string;
  /** Tipe MIME dari header (huruf kecil, tanpa parameter); kosong bila tidak ada. */
  mime: string;
  /** Header Content-Type apa adanya (untuk membaca charset). */
  contentType: string;
  bytes: Uint8Array;
}

export async function fetchPublicUrl(rawUrl: string, opts: FetchOptions = {}, deps: FetchDeps = defaultDeps): Promise<FetchedResource> {
  const maxBytes = opts.maxBytes ?? MAX_URL_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? URL_TIMEOUT_MS);
  try {
    let current = rawUrl;
    let requestedUrl = "";
    let firstProtocol = "";
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let url: URL;
      let address: string;
      try {
        url = parsePublicUrl(current);
        address = await pickPublicAddress(url, deps, ctrl.signal);
      } catch (e) {
        if (hop > 0 && e instanceof UrlImportError && e.status === 400) throw new UrlImportError("Pengalihan mengarah ke alamat yang tidak diizinkan.", 400);
        throw e;
      }
      if (hop === 0) {
        requestedUrl = withoutHash(url);
        firstProtocol = url.protocol;
      } else if (firstProtocol === "https:" && url.protocol === "http:") {
        throw new UrlImportError("Pengalihan dari https ke http tidak diizinkan.", 400);
      }

      const res = await raceAbort(deps.request({ url, address, signal: ctrl.signal }), ctrl.signal);

      if (REDIRECT.has(res.status)) {
        res.destroy();
        const loc = headerValue(res.headers.location).trim();
        if (!loc) throw new UrlImportError("Pengalihan dari situs tidak valid.", 502);
        try {
          current = new URL(loc, url).href;
        } catch {
          throw new UrlImportError("Pengalihan dari situs tidak valid.", 502);
        }
        continue;
      }
      if (res.status !== 200) {
        res.destroy();
        throw new UrlImportError(`Situs membalas dengan status ${res.status || "tidak dikenal"}.`, 502);
      }

      const contentType = headerValue(res.headers["content-type"]);
      const mime = contentType.split(";")[0].trim().toLowerCase();
      const enc = headerValue(res.headers["content-encoding"]).trim().toLowerCase();
      if (enc && enc !== "identity") {
        res.destroy();
        throw new UrlImportError("Respons terkompresi tidak didukung.", 502);
      }
      if (mime && !ALLOWED_MIME.has(mime)) {
        res.destroy();
        throw new UrlImportError("Jenis konten tidak didukung. Gunakan halaman web, PDF, atau teks.", 415);
      }
      const declared = Number(headerValue(res.headers["content-length"]));
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        throw new UrlImportError("Ukuran file melebihi batas 10 MB.", 413);
      }
      const bytes = await readLimited(res, maxBytes, ctrl.signal);
      return { requestedUrl, finalUrl: withoutHash(url), mime, contentType, bytes };
    }
    throw new UrlImportError("Terlalu banyak pengalihan.", 502);
  } catch (e) {
    if (e instanceof UrlImportError) throw e;
    if (ctrl.signal.aborted || e instanceof TimeoutError) throw new UrlImportError("Situs terlalu lama merespons (batas 15 detik).", 504);
    throw new UrlImportError("Tidak dapat mengambil halaman dari URL tersebut.", 502);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- HTML -> teks (pemindai linear, tanpa regex yang bisa membengkak) ----------

const BLOCK_TAGS = new Set([
  "p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "section", "article",
  "blockquote", "pre", "hr", "header", "footer", "main", "aside", "figure", "figcaption", "dd", "dt", "dl", "caption",
]);
const CELL_TAGS = new Set(["td", "th"]);
/** Isi elemen ini dibuang: bukan teks bacaan (kode, gaya, templat). */
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "iframe", "title", "object", "embed"]);

function tagAttrs(raw: string): Record<string, string> {
  const a: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return a;
}

export interface HtmlText {
  text: string;
  title?: string;
  doi?: string;
}

/** Teks bacaan halaman + judul dan DOI dari meta (citation_*, dc.*). Skrip, gaya, dan komentar dibuang. */
export function htmlToText(html: string): HtmlText {
  let out = "";
  let pageTitle: string | undefined;
  const meta: Record<string, string> = {};
  const n = html.length;
  let i = 0;
  let gtCache = -1;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    const gt = gtCache > lt ? gtCache : html.indexOf(">", lt + 1);
    if (gt === -1) {
      // Tidak ada ">" lagi di sisa halaman, jadi tidak ada tag yang bisa terbentuk: sisanya teks biasa.
      out += html.slice(lt);
      break;
    }
    gtCache = gt; // ">" pertama setelah lt tetap yang pertama untuk "<" berikutnya yang masih sebelum gt: tanpa pindai ulang
    const raw = html.slice(lt + 1, gt);
    const m = /^(\/?)([a-zA-Z][a-zA-Z0-9]{0,15})/.exec(raw.slice(0, 20));
    if (!m) {
      out += "<"; // bukan tag (mis. "a < b"): tetap sebagai teks
      i = lt + 1;
      continue;
    }
    i = gt + 1;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (!closing && name === "meta") {
      if (raw.length <= 4000) {
        const a = tagAttrs(raw);
        const key = (a.name ?? a.property ?? "").toLowerCase();
        if (key && a.content !== undefined && !(key in meta)) meta[key] = decodeEntities(a.content).slice(0, 500);
      }
      continue;
    }
    if (!closing && SKIP_TAGS.has(name) && !raw.endsWith("/")) {
      const re = new RegExp(`</${name}\\s*>`, "gi");
      re.lastIndex = i;
      const c = re.exec(html);
      if (!c) break; // tidak ditutup: sisa halaman dianggap isi elemen itu
      if (name === "title") pageTitle = html.slice(i, Math.min(c.index, i + 600));
      i = c.index + c[0].length;
      continue;
    }
    if (BLOCK_TAGS.has(name)) out += "\n";
    else if (CELL_TAGS.has(name)) out += " ";
  }

  const text = tidy(decodeEntities(out.replace(/&nbsp;|&#160;|&#xa0;/gi, " ")));
  const rawTitle = meta["citation_title"] ?? meta["dc.title"] ?? meta["og:title"] ?? pageTitle;
  const title = rawTitle ? tidy(decodeEntities(rawTitle)).replace(/\s+/g, " ").slice(0, 300) || undefined : undefined;
  const rawDoi = meta["citation_doi"] ?? meta["prism.doi"] ?? meta["dc.identifier"];
  const d = rawDoi ? normalizeDoi(rawDoi) : "";
  return { text, title, doi: DOI_RE.test(d) ? d : undefined };
}

// ---------- impor ----------

export interface ImportedUrlSource extends ExtractedSource {
  /** Petunjuk judul dari halaman (bukan metadata sumber yang terverifikasi). */
  title?: string;
  /** DOI dari meta halaman, bila ada. */
  doi?: string;
  provenance: Provenance;
}

const hasPdfMagic = (b: Uint8Array): boolean => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;

function looksLikeHtml(b: Uint8Array): boolean {
  const head = new TextDecoder().decode(b.slice(0, 1024)).toLowerCase();
  return /<!doctype html|<html|<body|<head/.test(head);
}

function decodeBytes(bytes: Uint8Array, contentType: string): string {
  const m = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType);
  if (m) {
    try {
      return new TextDecoder(m[1]).decode(bytes);
    } catch {
      /* label charset tidak dikenal: pakai UTF-8 */
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function importUrlSource(rawUrl: string, deps: FetchDeps = defaultDeps, now: () => Date = () => new Date()): Promise<ImportedUrlSource> {
  const got = await fetchPublicUrl(rawUrl, {}, deps);
  const pdf = hasPdfMagic(got.bytes);
  if (got.mime === "application/pdf" && !pdf) throw new ExtractError("File yang dinyatakan PDF oleh situs bukan PDF yang valid.", 415);

  let ex: ExtractedSource;
  let title: string | undefined;
  let doi: string | undefined;
  const isHtml = !pdf && (got.mime === "text/html" || got.mime === "application/xhtml+xml" || (got.mime === "" && looksLikeHtml(got.bytes)));
  if (pdf) {
    ex = await extractSourceText(got.bytes, "impor.pdf");
  } else if (isHtml) {
    const h = htmlToText(decodeBytes(got.bytes, got.contentType));
    if (h.text.length < MIN_SOURCE_CHARS) {
      throw new ExtractError("Halaman tidak memuat teks yang cukup. Mungkin perlu login atau JavaScript. Tempel teksnya secara manual.");
    }
    ex = { text: h.text.slice(0, MAX_SOURCE_CHARS), pages: null, truncated: h.text.length > MAX_SOURCE_CHARS, chars: h.text.length, kind: "html" };
    title = h.title;
    doi = h.doi;
  } else {
    ex = await extractSourceText(got.bytes, "impor.txt");
  }

  const provenance: Provenance = {
    method: "url",
    url: got.requestedUrl,
    finalUrl: got.finalUrl,
    fetchedAt: now().toISOString(),
    bytes: got.bytes.length,
    sha256: sha256Hex(got.bytes),
  };
  if (got.mime) provenance.contentType = got.mime;
  return { ...ex, title, doi, provenance };
}
