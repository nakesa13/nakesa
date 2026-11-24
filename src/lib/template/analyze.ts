import { type Pkg, openPackage, countSections, sectPrOf } from "./package";
import type { Analysis, BlockInfo, CoverField, FormatSummary, Mapping } from "./types";
import { attr, child, descendants, lname, textOf } from "./xml";


const FRONT_RE =
  /^(KATA PENGANTAR|PRAKATA|DAFTAR ISI|DAFTAR TABEL|DAFTAR GAMBAR|DAFTAR LAMPIRAN|DAFTAR SINGKATAN|DAFTAR LAMBANG|ABSTRAK|ABSTRACT|LEMBAR\s+\w+|HALAMAN\s+\w+(\s+\w+)?|PERNYATAAN.*|UCAPAN TERIMA KASIH|MOTTO|PERSEMBAHAN)$/i;
const CHAPTER_RE = /^BAB\s+([IVXLC]+|\d+)\b/i;
const LETTER_RE = /^[A-Z]\.\s+\S/;
const NUM_RE = /^\d+(\.\d+)*\.?\s+\S/;
const BIB_RE = /^(DAFTAR\s+(PUSTAKA|REFERENSI)|REFERENCES?|REFERENSI)$/i;
const APPENDIX_RE = /^LAMPIRAN\b/i;
const PLACEHOLDER_RE = /\{\{\s*(judul|nama|nim|prodi|kampus|tahun|pembimbing)\s*\}\}/gi;

// ---------- potongan kecil ----------

function pPrOf(p: Element): Element | null {
  return child(p, "pPr");
}

function flagOn(e: Element | null): boolean {
  if (!e) return false;
  const v = attr(e, "val");
  return !(v === "0" || v === "false" || v === "off");
}

function isTocField(el: Element): boolean {
  for (const t of descendants(el, "instrText")) if (/^\s*TOC\b/i.test(t.textContent ?? "")) return true;
  for (const f of descendants(el, "fldSimple")) if (/^\s*TOC\b/i.test(attr(f, "instr") ?? "")) return true;
  return false;
}

function isTocSdt(el: Element): boolean {
  if (isTocField(el)) return true;
  for (const g of descendants(el, "docPartGallery")) if (/table of contents|daftar isi/i.test(attr(g, "val") ?? "")) return true;
  return false;
}

function pageBreakKind(el: Element): "before" | "after" | null {
  const pPr = pPrOf(el);
  if (pPr && flagOn(child(pPr, "pageBreakBefore"))) return "before";
  if (descendants(el, "br").some((b) => attr(b, "type") === "page")) return "after";
  if (pPr && child(pPr, "sectPr")) return "after";
  return null;
}

function styleLevel(pkg: Pkg, id: string | null): 0 | 1 | 2 | 3 {
  for (const s of pkg.styles.chain(id)) {
    const nm = (s.name ?? "").toLowerCase();
    const m = /^(?:heading|judul)\s*(\d)$/.exec(nm) ?? /^heading(\d)$/i.exec(s.id);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 3) return n as 1 | 2 | 3;
    }
    const o = attr(child(s.pPr, "outlineLvl"), "val");
    if (o !== null && Number(o) < 3) return (Number(o) + 1) as 1 | 2 | 3;
  }
  return 0;
}

function paraLevel(pkg: Pkg, p: Element): 0 | 1 | 2 | 3 {
  const o = attr(child(pPrOf(p), "outlineLvl"), "val");
  if (o !== null) return Number(o) < 3 ? ((Number(o) + 1) as 1 | 2 | 3) : 0;
  return styleLevel(pkg, attr(child(pPrOf(p), "pStyle"), "val"));
}

function describe(pkg: Pkg, i: number, el: Element): BlockInfo {
  const ln = lname(el);
  const base: BlockInfo = { i, kind: "other", text: "", styleId: null, styleName: null, level: 0, pageBreak: false, sectBreak: false, tocLine: false };
  if (ln === "p") {
    const styleId = attr(child(pPrOf(el), "pStyle"), "val");
    const styleName = styleId ? (pkg.styles.map.get(styleId)?.name ?? null) : null;
    const text = textOf(el).replace(/\s+$/g, "");
    const level = paraLevel(pkg, el);
    const pb = pageBreakKind(el);
    const styleToc = /^(toc\s*\d|daftar isi|table of contents)/i.test(styleName ?? "") || /^TOC\d/i.test(styleId ?? "");
    const staticToc = level === 0 && text.length < 220 && /\S.*?(\.{3,}|\t)\s*\d+\s*$/.test(text.trim()) && !CHAPTER_RE.test(text.trim().replace(/(\.{3,}|\t).*$/, "")) === false ? true : level === 0 && text.length < 220 && /\S.*?(\.{3,}|\t)\s*[\dIVXivx]+\s*$/.test(text.trim());
    return {
      ...base,
      kind: isTocField(el) ? "toc" : "p",
      text: text.slice(0, 120),
      styleId,
      styleName,
      level,
      pageBreak: pb !== null,
      sectBreak: !!child(pPrOf(el), "sectPr"),
      tocLine: styleToc || staticToc,
    };
  }
  if (ln === "tbl") return { ...base, kind: "tbl", text: textOf(el).trim().slice(0, 120) };
  if (ln === "sdt") return { ...base, kind: isTocSdt(el) ? "toc" : "sdt", text: textOf(el).trim().slice(0, 120) };
  if (ln === "sectPr") return { ...base, kind: "sectPr" };
  return base;
}

// ---------- format efektif ----------

function rPrProps(r: Element | null) {
  if (!r) return {} as { font?: string; size?: number; bold?: boolean };
  const rf = child(r, "rFonts");
  const font = attr(rf, "ascii") ?? attr(rf, "hAnsi") ?? undefined;
  const sz = attr(child(r, "sz"), "val");
  const b = child(r, "b");
  return { font, size: sz ? Number(sz) / 2 : undefined, bold: b ? flagOn(b) : undefined };
}

function pPrProps(pPr: Element | null) {
  if (!pPr) return {} as { line?: string; align?: string; numbered?: boolean };
  const sp = child(pPr, "spacing");
  const lineV = attr(sp, "line");
  const rule = attr(sp, "lineRule") ?? "auto";
  let line: string | undefined;
  if (lineV) {
    const n = Number(lineV);
    line = rule === "auto" ? String(Math.round((n / 240) * 100) / 100).replace(".", ",") : `${Math.round(n / 20)} pt (${rule === "exact" ? "tetap" : "minimal"})`;
  }
  const jc = attr(child(pPr, "jc"), "val") ?? undefined;
  const numPr = child(pPr, "numPr");
  return { line, align: jc, numbered: numPr ? attr(child(numPr, "numId"), "val") !== "0" : undefined };
}

const ALIGN_ID: Record<string, string> = { both: "rata kiri-kanan", left: "rata kiri", start: "rata kiri", center: "tengah", right: "rata kanan", end: "rata kanan", distribute: "rata kiri-kanan" };

export function summarize(pkg: Pkg, p: Element): FormatSummary {
  const s = pkg.styles;
  const pPr = pPrOf(p);
  const styleId = attr(child(pPr, "pStyle"), "val") ?? s.defaultPara;
  const chain = s.chain(styleId).reverse();
  let font: string | undefined;
  let size: number | undefined;
  let bold: boolean | undefined;
  let line: string | undefined;
  let align: string | undefined;
  let numbered: boolean | undefined;

  const apply = (r: Element | null, pp: Element | null) => {
    const a = rPrProps(r);
    if (a.font) font = a.font;
    if (a.size) size = a.size;
    if (a.bold !== undefined) bold = a.bold;
    const b = pPrProps(pp);
    if (b.line) line = b.line;
    if (b.align) align = b.align;
    if (b.numbered !== undefined) numbered = b.numbered;
  };
  apply(s.docRPr, s.docPPr);
  for (const st of chain) apply(st.rPr, st.pPr);
  const firstRun = descendants(p, "r").find((r) => descendants(r, "t").length > 0) ?? descendants(p, "r")[0] ?? null;
  apply(child(firstRun, "rPr"), pPr);
  void pPr;

  return {
    font: font ?? null,
    sizePt: size ?? null,
    line: line ?? null,
    align: align ? (ALIGN_ID[align] ?? align) : null,
    bold: !!bold,
    autoNumbered: !!numbered,
  };
}

// ---------- tebakan pemetaan ----------

function guessCover(blocks: BlockInfo[], start: number): Record<string, CoverField> {
  const out: Record<string, CoverField> = {};
  const taken = new Set<CoverField>();
  const put = (i: number, f: CoverField) => {
    if (taken.has(f) && f !== "kampus") return;
    taken.add(f);
    out[String(i)] = f;
  };
  const lim = Math.min(start, 60);
  for (let i = 0; i < lim; i++) {
    const b = blocks[i];
    if (b.kind !== "p" || !b.text.trim() || b.tocLine) continue;
    const t = b.text.trim();
    if (/^(nama(\s+mahasiswa)?)\s*[:：]/i.test(t)) put(i, "nama");
    else if (/^(nim|npm|nirm|no\.?\s*induk)\s*[:：]/i.test(t)) put(i, "nim");
    else if (/^(program\s+studi|prodi)\s*[:：]/i.test(t)) put(i, "prodi");
    else if (/^(dosen\s+)?pembimbing\s*[:：]\s*\S/i.test(t)) put(i, "pembimbing");
    else if (/^(tahun|tahun akademik)\s*[:：]?\s*\d{4}/i.test(t) || /^\d{4}$/.test(t)) put(i, "tahun");
  }
  for (let i = 0; i < lim; i++) {
    const b = blocks[i];
    if (b.kind !== "p" || !b.text.trim() || out[String(i)]) continue;
    const t = b.text.trim();
    if (/^(UNIVERSITAS|POLITEKNIK|INSTITUT|SEKOLAH TINGGI|STIKES|STIKEP|AKADEMI|UNIVERSITY)\b/i.test(t)) put(i, "kampus");
    else if (/^PROGRAM\s+STUDI\b/i.test(t) || /^(D[- ]?(III|3|IV|4)|S1|PROFESI)\s+(KEBIDANAN|KEPERAWATAN|FARMASI)/i.test(t)) put(i, "prodi");
  }
  // judul: baris huruf kapital terpanjang yang belum terpakai, setelah kata "LAPORAN"/"READING JOURNAL" bila ada
  let from = 0;
  for (let i = 0; i < lim; i++) if (/^(LAPORAN|READING JOURNAL)/i.test(blocks[i].text.trim())) from = i + 1;
  for (let i = from; i < lim; i++) {
    const b = blocks[i];
    const t = b.text.trim();
    if (b.kind !== "p" || t.length < 15 || out[String(i)]) continue;
    if (t === t.toUpperCase() && /[A-Z]/.test(t) && !/^(DISUSUN|OLEH|DOSEN|PROGRAM|UNIVERSITAS|POLITEKNIK|KEMENTERIAN)/i.test(t)) {
      put(i, "judul");
      break;
    }
  }
  return out;
}

export function describeBlocks(pkg: Pkg): BlockInfo[] {
  return pkg.blocks.map((el, i) => describe(pkg, i, el));
}

export function analyzePackage(pkg: Pkg): Analysis {
  const warnings: string[] = [];
  const blocks = pkg.blocks.map((el, i) => describe(pkg, i, el));
  const n = blocks.length;

  const firstText = blocks.findIndex((b) => b.kind !== "sectPr" && b.text.trim().length > 0);
  let coverEnd = 0;
  for (let i = Math.max(firstText, 0) + 1; i < n; i++) {
    const pk = blocks[i].kind === "p" ? pageBreakKind(pkg.blocks[i]) : null;
    if (pk) {
      coverEnd = pk === "before" ? i : i + 1;
      break;
    }
  }

  const tocHeading = blocks.findIndex((b) => b.kind === "p" && !b.tocLine && /^DAFTAR ISI$/i.test(b.text.trim()));
  const hasTocField = blocks.some((b) => b.kind === "toc");
  const hasToc = hasTocField || tocHeading >= 0;

  // awal isi
  const isCandidate = (b: BlockInfo) => {
    if (b.kind !== "p" || b.tocLine) return false;
    const t = b.text.trim();
    if (!t || FRONT_RE.test(t) || BIB_RE.test(t)) return false;
    return b.level === 1 || CHAPTER_RE.test(t);
  };
  let start = -1;
  const afterToc = tocHeading >= 0 ? tocHeading + 1 : 0;
  for (const strict of [true, false]) {
    for (let i = Math.max(afterToc, strict ? coverEnd : 0); i < n; i++) {
      if (isCandidate(blocks[i])) {
        start = i;
        break;
      }
    }
    if (start >= 0) break;
  }
  if (start < 0) {
    warnings.push("Awal isi dokumen tidak terdeteksi. Pilih sendiri paragraf tempat isi dimulai.");
    start = Math.max(0, n - 1 > 0 ? Math.min(coverEnd, n - 1) : 0);
  }

  // akhir isi / daftar pustaka
  let bibHeading: number | null = null;
  for (let i = start + 1; i < n; i++) {
    if (blocks[i].kind === "p" && !blocks[i].tocLine && BIB_RE.test(blocks[i].text.trim())) {
      bibHeading = i;
      break;
    }
  }
  let bibEnd: number | null = null;
  if (bibHeading !== null) {
    for (let i = bibHeading + 1; i < n; i++) {
      if (blocks[i].kind === "p" && APPENDIX_RE.test(blocks[i].text.trim())) {
        bibEnd = i;
        break;
      }
    }
  }
  const bodyEnd = bibHeading;
  const endIdx = bodyEnd ?? n;

  // contoh format
  const region = blocks.slice(start, endIdx).filter((b) => b.kind === "p");
  const firstOf = (pred: (b: BlockInfo) => boolean) => region.find(pred)?.i ?? null;
  const h1 = firstOf((b) => b.level === 1 || CHAPTER_RE.test(b.text.trim())) ?? (blocks[start]?.kind === "p" ? start : null);
  const h2 = firstOf((b) => b.i !== h1 && (b.level === 2 || (b.level === 0 && LETTER_RE.test(b.text.trim()) && b.text.length < 120)));
  const h3 = firstOf((b) => b.i !== h1 && b.i !== h2 && (b.level === 3 || (b.level === 0 && NUM_RE.test(b.text.trim()) && b.text.length < 100)));
  let bodyIdx: number | null = null;
  let bestLen = 0;
  for (const b of region) {
    if (b.level !== 0 || b.tocLine) continue;
    const t = b.text.trim();
    if (t.length < 80) continue;
    if (CHAPTER_RE.test(t) || LETTER_RE.test(t) && t.length < 120) continue;
    if (child(pPrOf(pkg.blocks[b.i]), "numPr")) continue;
    if (t.length > bestLen) {
      bestLen = t.length;
      bodyIdx = b.i;
    }
  }

  const para = (i: number | null) => (i !== null && blocks[i]?.kind === "p" ? summarize(pkg, pkg.blocks[i]) : null);
  const fmtBody = para(bodyIdx) ?? (pkg.styles.defaultPara ? summarize(pkg, pkg.doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:p")) : null);
  if (bodyIdx === null) warnings.push("Contoh paragraf isi tidak ditemukan di template. Gaya isi memakai gaya standar Word dari template; periksa hasil unduhan.");

  const placeholders = new Set<string>();
  for (const b of pkg.blocks) for (const m of textOf(b).matchAll(PLACEHOLDER_RE)) placeholders.add(m[1].toLowerCase());

  const sectPr = sectPrOf(pkg);
  const pg = child(sectPr, "pgSz");
  const mar = child(sectPr, "pgMar");
  const num = (e: Element | null, a: string) => (attr(e, a) ? Number(attr(e, a)) : null);
  const secs = descendants(pkg.body, "sectPr");
  const hasHeader = secs.some((s) => descendants(s, "headerReference").length > 0);
  const hasFooter = secs.some((s) => descendants(s, "footerReference").length > 0);

  if (descendants(pkg.body, "ins").length || descendants(pkg.body, "del").length) {
    warnings.push("Template memiliki revisi (track changes) yang belum diterima. Terima semua revisi di Word dulu agar hasilnya sesuai.");
  }

  // T11: elemen yang tidak dikenal/ tidak bisa dipertahankan diberi peringatan, tidak dibuang diam-diam.
  // Isi area isi diganti seluruhnya oleh dokumen Anda, jadi tabel, gambar, kotak teks, kontrol konten, dan catatan kaki di sana ikut hilang.
  const replaced = pkg.blocks.slice(start, endIdx);
  const countIn = (name: string) => replaced.reduce((acc, el) => acc + (lname(el) === name ? 1 : 0) + descendants(el, name).length, 0);
  const lost: string[] = [];
  const nTbl = countIn("tbl");
  const nImg = countIn("drawing") + countIn("pict");
  const nBox = countIn("txbxContent");
  const nSdt = countIn("sdt");
  const nFn = countIn("footnoteReference") + countIn("endnoteReference");
  if (nTbl) lost.push(`${nTbl} tabel`);
  if (nImg) lost.push(`${nImg} gambar`);
  if (nBox) lost.push(`${nBox} kotak teks`);
  if (nSdt) lost.push(`${nSdt} kontrol konten`);
  if (nFn) lost.push(`${nFn} catatan kaki`);
  if (lost.length) {
    warnings.push(`Area isi template memuat ${lost.join(", ")}. Semuanya akan diganti oleh isi dokumen Anda. Bila perlu dipertahankan, pindahkan ke luar area isi (mis. sampul atau lampiran) atau atur ulang "Paragraf pertama isi".`);
  }
  const settingsXml = pkg.zip.file("word/settings.xml");
  if (settingsXml && /attachedTemplate/.test(settingsXml.asText())) {
    warnings.push("Template terhubung ke template Word lain. Tautan itu dibuang saat dokumen dibuat.");
  }

  const coverFields = placeholders.size ? {} : guessCover(blocks, start);

  const suggested: Mapping = {
    bodyStart: start,
    bodyEnd,
    bibHeading,
    bibEnd,
    coverFields,
    samples: { h1, h2, h3, body: bodyIdx },
    tocMode: hasTocField ? "keep" : tocHeading >= 0 ? "replace" : "add",
    tocHeading: tocHeading >= 0 ? tocHeading : null,
  };

  const MAX_BLOCKS = 700;
  if (n > MAX_BLOCKS) warnings.push(`Template panjang (${n} blok); hanya ${MAX_BLOCKS} blok pertama ditampilkan.`);

  return {
    total: n,
    blocks: blocks.slice(0, MAX_BLOCKS),
    suggested,
    formats: { h1: para(h1), h2: para(h2), h3: para(h3), body: fmtBody },
    page: { widthTwips: num(pg, "w"), heightTwips: num(pg, "h"), left: num(mar, "left"), right: num(mar, "right"), top: num(mar, "top"), bottom: num(mar, "bottom") },
    sections: countSections(pkg),
    hasHeader,
    hasFooter,
    hasToc,
    placeholders: [...placeholders],
    warnings,
  };
}

export function analyzeTemplate(buf: Uint8Array): Analysis {
  return analyzePackage(openPackage(buf));
}
