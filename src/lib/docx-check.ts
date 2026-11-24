import PizZip from "pizzip";
import type { Source } from "./types";
import { MARKER_RE } from "./citations";
import { assertSafeZip } from "./template/package";
import { DOCX_WARNING_TEXT } from "./docx-warnings";
import { TemplateError, child, descendants, parseXml, textOf, xmlSafe } from "./template/xml";

/**
 * T12: pemeriksa struktur file .docx hasil (dari builder bawaan maupun dari template kampus).
 * Dipakai di route sebelum file dikirim dan di test. Hanya memeriksa hal yang pasti membuat file rusak atau menyesatkan:
 * paket zip, bagian wajib, XML terbentuk baik, karakter terlarang, dan setiap sumber yang dikutip benar-benar ada di daftar pustaka.
 * Tidak menilai isi atau gaya penulisan.
 */

export interface DocxProblem {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface DocxReport {
  /** true bila tidak ada masalah tingkat "error". */
  ok: boolean;
  problems: DocxProblem[];
  /** Teks tiap paragraf isi (tanpa yang kosong), untuk pemeriksaan lanjutan. */
  paragraphs: string[];
}

const REQUIRED_PARTS = ["[Content_Types].xml", "word/document.xml"];
const MAIN_CT = "wordprocessingml.document.main+xml";
// Karakter yang tidak boleh ada di XML 1.0 (Word menolak file yang memuatnya).
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Awal judul sumber yang dipakai untuk mencari entrinya di daftar pustaka. */
const titleKey = (s: Source): string => norm(xmlSafe(s.title)).slice(0, 40);

export function inspectDocx(buf: Uint8Array, opts: { cited?: Source[] } = {}): DocxReport {
  const problems: DocxProblem[] = [];
  const add = (level: DocxProblem["level"], code: string, message: string) => problems.push({ level, code, message });
  const done = (paragraphs: string[] = []): DocxReport => ({ ok: !problems.some((p) => p.level === "error"), problems, paragraphs });

  let zip: PizZip;
  try {
    zip = new PizZip(buf);
  } catch {
    add("error", "zip-rusak", "Berkas hasil bukan paket zip (.docx) yang valid.");
    return done();
  }
  try {
    assertSafeZip(zip, buf.length);
  } catch (e) {
    add("error", "zip-tidak-aman", e instanceof TemplateError ? e.message : "Paket hasil tidak lolos pemeriksaan keamanan.");
    return done();
  }

  for (const p of REQUIRED_PARTS) if (!zip.file(p)) add("error", "bagian-hilang", `Bagian wajib ${p} tidak ada di berkas hasil.`);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return done();

  const ct = zip.file("[Content_Types].xml");
  if (ct) {
    try {
      const txt = ct.asText();
      parseXml(txt, "daftar jenis konten");
      if (!txt.includes(MAIN_CT)) add("warning", "jenis-konten", DOCX_WARNING_TEXT["jenis-konten"]);
    } catch (e) {
      add("error", "xml-rusak", e instanceof TemplateError ? e.message : "Daftar jenis konten tidak terbaca.");
    }
  }

  const xml = docFile.asText();
  if (BAD_CHARS.test(xml)) add("error", "karakter-terlarang", "Isi dokumen memuat karakter kontrol yang tidak sah di XML dan akan ditolak Word.");

  let paragraphs: string[] = [];
  try {
    const doc = parseXml(xml, "isi dokumen");
    const body = child(doc.documentElement, "body");
    if (!body) {
      add("error", "tanpa-isi", "Dokumen hasil tidak memiliki isi.");
      return done();
    }
    paragraphs = descendants(body, "p")
      .map((p) => textOf(p).trim())
      .filter(Boolean);
  } catch (e) {
    add("error", "xml-rusak", e instanceof TemplateError ? e.message : "Isi dokumen tidak terbaca.");
    return done();
  }
  const text = norm(paragraphs.join("\n"));

  const raw = new RegExp(MARKER_RE.source, "g");
  if (raw.test(paragraphs.join("\n"))) {
    add("warning", "penanda-mentah", DOCX_WARNING_TEXT["penanda-mentah"]);
  }

  for (const s of opts.cited ?? []) {
    const key = titleKey(s);
    if (key && !text.includes(key)) {
      add("error", "pustaka-hilang", `Sumber ${s.id} dikutip di isi tetapi tidak ditemukan di daftar pustaka dokumen.`);
    }
  }

  return done(paragraphs);
}
