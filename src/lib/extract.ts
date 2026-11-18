import PizZip from "pizzip";
import { extractText, getDocumentProxy } from "unpdf";

/** Ekstraksi teks dari file jurnal/referensi unggahan mahasiswa (PDF, Word .docx, teks .txt/.md). Hanya di server. */

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 60_000;
export const MIN_SOURCE_CHARS = 200;

export class ExtractError extends Error {
  constructor(
    message: string,
    public status = 422
  ) {
    super(message);
  }
}

export interface ExtractedSource {
  text: string;
  pages: number | null;
  truncated: boolean;
  chars: number;
  kind: "pdf" | "docx" | "txt";
}

// Karakter kontrol (kecuali tab/baris baru) merusak XML Word dan tampilan; dibuang.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const tidy = (s: string): string =>
  s
    .replace(CONTROL, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Teks isi dokumen Word: paragraf per baris; kode field, teks revisi yang dihapus, dan tag dibuang. */
export function docxToText(bytes: Uint8Array): string {
  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch {
    throw new ExtractError("File Word tidak dapat dibuka. Simpan ulang dari Word sebagai .docx lalu coba lagi.");
  }
  const f = zip.file("word/document.xml");
  if (!f) throw new ExtractError("File bukan dokumen Word (.docx) yang valid.");
  const xml = f.asText();
  if (xml.length > 30_000_000) throw new ExtractError("Dokumen Word terlalu besar untuk dibaca.", 413);
  const body = xml
    .replace(/<w:del\b[\s\S]*?<\/w:del>/g, "")
    .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(body);
}

async function pdfToText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { text, pages: totalPages };
  } catch (e) {
    console.error(e);
    throw new ExtractError("PDF tidak dapat dibaca.");
  }
}

export async function extractSourceText(bytes: Uint8Array, name: string): Promise<ExtractedSource> {
  const isPdf = bytes.length > 5 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) === "%PDF-";
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  let raw: string;
  let pages: number | null = null;
  let kind: ExtractedSource["kind"];
  if (isPdf) {
    const r = await pdfToText(bytes);
    raw = r.text;
    pages = r.pages;
    kind = "pdf";
  } else if (isZip && /\.docx$/i.test(name)) {
    raw = docxToText(bytes);
    kind = "docx";
  } else if (/\.(txt|md|text)$/i.test(name) && !bytes.slice(0, 4096).includes(0)) {
    raw = new TextDecoder("utf-8").decode(bytes);
    kind = "txt";
  } else {
    throw new ExtractError("Format file tidak didukung. Gunakan PDF, Word (.docx), atau teks (.txt).", 400);
  }

  const clean = tidy(raw);
  if (clean.length < MIN_SOURCE_CHARS) {
    throw new ExtractError(
      kind === "pdf"
        ? "Teks tidak terbaca. PDF mungkin hasil scan (gambar). Tempel teksnya secara manual."
        : "Isi file terlalu pendek atau kosong. Pastikan file berisi teks."
    );
  }
  return { text: clean.slice(0, MAX_SOURCE_CHARS), pages, truncated: clean.length > MAX_SOURCE_CHARS, chars: clean.length, kind };
}
