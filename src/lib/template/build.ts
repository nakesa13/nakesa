import PizZip from "pizzip";
import type { BuildInput, BuildResult } from "../docx-builder";
import { buildBibliography, citedOrder, renderInText } from "../citations";
import { parseBlocks, parseInline } from "../markup";
import { describeBlocks, summarize } from "./analyze";
import { type Pkg, openPackage, sectPrOf } from "./package";
import type { CoverField, Mapping } from "./types";
import { TemplateError, attr, child, childrenNamed, descendants, elems, lname, mk, parseXml, removeChildren, serialize, setPprChild, textOf, textRun, xmlSafe } from "./xml";

const clone = <T extends Node>(n: T): T => n.cloneNode(true) as T;
const isUpper = (s: string) => /[A-Za-z]/.test(s) && s === s.toUpperCase();

interface Sample {
  pPr: Element | null;
  rPr: Element | null;
  upper: boolean;
  autoNum: boolean;
}

function firstTextRPr(p: Element): Element | null {
  const rs = descendants(p, "r");
  const r = rs.find((x) => descendants(x, "t").length > 0) ?? rs[0];
  return child(r ?? null, "rPr");
}

function capture(pkg: Pkg, idx: number | null): Sample | null {
  if (idx === null || idx < 0 || idx >= pkg.blocks.length) return null;
  const p = pkg.blocks[idx];
  if (lname(p) !== "p") return null;
  const pPr = child(p, "pPr");
  const pc = pPr ? clone(pPr) : null;
  if (pc) removeChildren(pc, ["sectPr"]);
  const rPr = firstTextRPr(p);
  return { pPr: pc, rPr: rPr ? clone(rPr) : null, upper: isUpper(textOf(p).trim()), autoNum: summarize(pkg, p).autoNumbered };
}

// ---------- paragraf dan run ----------

function runWithTabs(doc: Document, text: string, rPr: Element | null, opt: { bold?: boolean; italic?: boolean } = {}): Element {
  const parts = text.split("\t");
  if (parts.length === 1) return textRun(doc, text, rPr, opt);
  const r = textRun(doc, parts[0], rPr, opt);
  for (let i = 1; i < parts.length; i++) {
    r.appendChild(mk(doc, "tab"));
    const t = mk(doc, "t");
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    t.appendChild(doc.createTextNode(xmlSafe(parts[i])));
    r.appendChild(t);
  }
  return r;
}

function para(doc: Document, pPr: Element | null, runs: Element[]): Element {
  const p = mk(doc, "p");
  if (pPr && elems(pPr).length) p.appendChild(clone(pPr));
  for (const r of runs) p.appendChild(r);
  return p;
}

function ensurePPr(doc: Document, p: Element): Element {
  let pPr = child(p, "pPr");
  if (!pPr) {
    pPr = mk(doc, "pPr");
    p.insertBefore(pPr, p.firstChild);
  }
  return pPr;
}

function hasText(r: Element): boolean {
  return descendants(r, "drawing").length === 0 && descendants(r, "pict").length === 0 && (descendants(r, "t").length > 0 || descendants(r, "tab").length > 0);
}

/** Ganti seluruh teks paragraf; label (mis. "Nama :") dipertahankan bila ada. Gambar/logo tidak disentuh. */
function writeParagraphText(doc: Document, p: Element, label: string, value: string) {
  const runs = childrenNamed(p, "r").filter(hasText);
  const firstR = child(runs[0] ?? null, "rPr");
  const lastR = child(runs[runs.length - 1] ?? null, "rPr");
  for (const n of elems(p)) {
    const ln = lname(n);
    if ((ln === "r" && hasText(n)) || ln === "proofErr" || ln === "hyperlink" || ln === "smartTag") p.removeChild(n);
  }
  if (label) p.appendChild(runWithTabs(doc, label, firstR));
  if (value) p.appendChild(runWithTabs(doc, value, label ? (runs.length > 1 ? lastR : firstR) : firstR));
}

const LABEL_RE = /^((?:nama(?:\s+mahasiswa)?|nim|npm|nirm|no\.?\s*induk|program\s+studi|prodi|(?:dosen\s+)?pembimbing|tahun(?:\s+akademik)?)[^:：\t]{0,20}[\t ]*[:：]\s*)/i;

function fillCover(pkg: Pkg, mapping: Mapping, values: Record<CoverField, string>, limit: number) {
  for (const [k, field] of Object.entries(mapping.coverFields)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx >= limit) continue;
    const p = pkg.blocks[idx];
    if (!p || lname(p) !== "p" || !(field in values)) continue;
    const text = textOf(p);
    const m = field === "judul" || field === "kampus" ? null : (LABEL_RE.exec(text) ?? (field === "prodi" ? /^(program\s+studi\s+|prodi\s+)/i.exec(text) : null));
    const label = m ? m[1] : "";
    const old = text.slice(label.length);
    const v = values[field];
    writeParagraphText(pkg.doc, p, label, v && isUpper(old.trim()) ? v.toUpperCase() : v);
  }
}

const PH_RE = /\{\{\s*(judul|nama|nim|prodi|kampus|tahun|pembimbing)\s*\}\}/gi;

function fillPlaceholders(doc: Document, values: Record<CoverField, string>) {
  const sub = (s: string) => s.replace(PH_RE, (_m, n: string) => values[n.toLowerCase() as CoverField] ?? "");
  for (const t of descendants(doc.documentElement, "t")) {
    const s = t.textContent ?? "";
    if (/\{\{/.test(s)) t.textContent = sub(s);
  }
  for (const p of descendants(doc.documentElement, "p")) {
    const s = textOf(p);
    if (new RegExp(PH_RE.source, "i").test(s)) writeParagraphText(doc, p, "", sub(s));
  }
}

// ---------- isi ----------

interface Ctx {
  doc: Document;
  bodyPPr: Element | null;
  bodyRPr: Element | null;
  heads: Record<1 | 2 | 3, { pPr: Element | null; rPr: Element | null; upper: boolean; autoNum: boolean; bold: boolean }>;
  contentW: number;
}

function stripBodyRPr(r: Element | null): Element | null {
  if (!r) return null;
  const c = clone(r);
  removeChildren(c, ["b", "bCs", "i", "iCs"]);
  return c;
}

function stripBodyPPr(p: Element | null): Element | null {
  if (!p) return null;
  const c = clone(p);
  removeChildren(c, ["pageBreakBefore", "numPr", "outlineLvl", "sectPr", "keepNext"]);
  return c;
}

function inline(ctx: Ctx, text: string, extra: { bold?: boolean } = {}): Element[] {
  return parseInline(text).map((r) => textRun(ctx.doc, r.text, ctx.bodyRPr, { bold: r.bold || extra.bold }));
}

function listPPr(ctx: Ctx): Element {
  const pPr = ctx.bodyPPr ? clone(ctx.bodyPPr) : mk(ctx.doc, "pPr");
  setPprChild(ctx.doc, pPr, "ind", { left: "720", hanging: "360" });
  return pPr;
}

function plainCellPPr(ctx: Ctx): Element {
  const pPr = ctx.bodyPPr ? clone(ctx.bodyPPr) : mk(ctx.doc, "pPr");
  removeChildren(pPr, ["ind"]);
  setPprChild(ctx.doc, pPr, "spacing", { before: "0", after: "0", line: "240", lineRule: "auto" });
  setPprChild(ctx.doc, pPr, "jc", { val: "left" });
  return pPr;
}

function tableElem(ctx: Ctx, rows: string[][]): Element {
  const d = ctx.doc;
  const cols = Math.max(...rows.map((r) => r.length));
  const W_ = ctx.contentW;
  let widths: number[];
  if (cols === 2) widths = [Math.min(2800, Math.floor(W_ / 2)), W_ - Math.min(2800, Math.floor(W_ / 2))];
  else {
    const w = Math.floor(W_ / cols);
    widths = Array.from({ length: cols }, (_, i) => (i === cols - 1 ? W_ - w * (cols - 1) : w));
  }
  const b = (n: string) => mk(d, n, { val: "single", sz: "4", space: "0", color: "808080" });
  const tbl = mk(d, "tbl");
  tbl.appendChild(
    mk(d, "tblPr", {}, [
      mk(d, "tblW", { w: String(W_), type: "dxa" }),
      mk(d, "tblBorders", {}, ["top", "left", "bottom", "right", "insideH", "insideV"].map(b)),
      mk(d, "tblLayout", { type: "fixed" }),
      mk(d, "tblCellMar", {}, [mk(d, "top", { w: "40", type: "dxa" }), mk(d, "left", { w: "100", type: "dxa" }), mk(d, "bottom", { w: "40", type: "dxa" }), mk(d, "right", { w: "100", type: "dxa" })]),
    ])
  );
  tbl.appendChild(mk(d, "tblGrid", {}, widths.map((w) => mk(d, "gridCol", { w: String(w) }))));
  rows.forEach((r, ri) => {
    const tr = mk(d, "tr");
    tr.appendChild(mk(d, "trPr", {}, ri === 0 ? [mk(d, "cantSplit"), mk(d, "tblHeader")] : [mk(d, "cantSplit")]));
    widths.forEach((w, ci) => {
      const tcPr = mk(d, "tcPr", {}, [mk(d, "tcW", { w: String(w), type: "dxa" })]);
      if (ri === 0) tcPr.appendChild(mk(d, "shd", { val: "clear", color: "auto", fill: "E7E6E6" }));
      tr.appendChild(mk(d, "tc", {}, [tcPr, para(d, plainCellPPr(ctx), inline(ctx, r[ci] ?? "", { bold: ri === 0 }))]));
    });
    tbl.appendChild(tr);
  });
  return tbl;
}

function bodyElems(ctx: Ctx, text: string, listState: { n: number }): Element[] {
  const d = ctx.doc;
  const out: Element[] = [];
  for (const b of parseBlocks(text)) {
    if (b.t === "p") {
      if (/^\*\*[^*]+\*\*:?$/.test(b.text)) {
        const pPr = ctx.bodyPPr ? clone(ctx.bodyPPr) : mk(d, "pPr");
        removeChildren(pPr, ["ind"]);
        setPprChild(d, pPr, "keepNext", {});
        setPprChild(d, pPr, "jc", { val: "left" });
        out.push(para(d, pPr, inline(ctx, b.text)));
      } else out.push(para(d, ctx.bodyPPr, inline(ctx, b.text)));
    } else if (b.t === "ul" || b.t === "ol") {
      listState.n += 1;
      b.items.forEach((item, i) => {
        const mark = b.t === "ul" ? "•" : `${i + 1}.`;
        out.push(para(d, listPPr(ctx), [textRun(d, mark, ctx.bodyRPr), mk(d, "r", {}, [mk(d, "tab")]), ...inline(ctx, item)]));
      });
    } else {
      out.push(tableElem(ctx, b.rows), para(d, null, []));
    }
  }
  return out;
}

function headingElem(ctx: Ctx, level: 1 | 2 | 3, title: string): { el: Element; text: string } {
  const h = ctx.heads[level];
  let t = title;
  if (h.autoNum) t = t.replace(/^(?:BAB\s+[IVXLC\d]+\.?\s+|[A-Za-z]\.\s+|\d+(?:\.\d+)*\.?\s+)/i, "");
  if (h.upper) t = t.toUpperCase();
  const pPr = h.pPr ? clone(h.pPr) : mk(ctx.doc, "pPr");
  if (!child(pPr, "keepNext")) setPprChild(ctx.doc, pPr, "keepNext", {});
  if (!child(pPr, "outlineLvl")) setPprChild(ctx.doc, pPr, "outlineLvl", { val: String(level - 1) });
  const run = textRun(ctx.doc, t, h.rPr, { bold: h.bold });
  return { el: para(ctx.doc, pPr, [run]), text: t };
}

// ---------- daftar isi ----------

function tocStyleId(pkg: Pkg, level: number): string | null {
  for (const s of pkg.styles.map.values()) {
    if (s.type === "paragraph" && (new RegExp(`^toc\\s*${level}$`, "i").test(s.name ?? "") || s.id.toLowerCase() === `toc${level}`)) return s.id;
  }
  return null;
}

function tocElems(pkg: Pkg, ctx: Ctx, heads: { title: string; level: number }[], instr = ' TOC \\o "1-3" \\h \\z \\u '): Element[] {
  const d = ctx.doc;
  const fc = (type: string) => mk(d, "r", {}, [mk(d, "fldChar", { fldCharType: type })]);
  const out: Element[] = [];
  const list = heads.length ? heads : [{ title: "Daftar isi akan terisi saat dokumen dibuka di Word.", level: 1 }];
  list.forEach((h, i) => {
    const pPr = mk(d, "pPr");
    const sid = tocStyleId(pkg, h.level);
    if (sid) pPr.appendChild(mk(d, "pStyle", { val: sid }));
    else setPprChild(d, pPr, "ind", { left: String((h.level - 1) * 360) });
    const p = mk(d, "p", {}, [pPr]);
    if (i === 0) {
      p.appendChild(fc("begin"));
      const it = mk(d, "instrText");
      it.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
      it.appendChild(d.createTextNode(instr));
      p.appendChild(mk(d, "r", {}, [it]));
      p.appendChild(fc("separate"));
    }
    p.appendChild(textRun(d, h.title, ctx.bodyRPr));
    if (i === list.length - 1) p.appendChild(fc("end"));
    out.push(p);
  });
  return out;
}

const fieldDepth = (p: Element): number => {
  let d = 0;
  for (const f of descendants(p, "fldChar")) {
    const t = attr(f, "fldCharType");
    if (t === "begin") d++;
    else if (t === "end") d--;
  }
  return d;
};

/** Cari field TOC bawaan template: paragraf awal, paragraf akhir, dan instruksinya. */
function findTocRange(pkg: Pkg): { first: Element; last: Element; instr: string } | null {
  for (const p of descendants(pkg.body, "p")) {
    const instr =
      descendants(p, "instrText").map((t) => t.textContent ?? "").find((t) => /^\s*TOC\b/i.test(t)) ??
      descendants(p, "fldSimple").map((f) => attr(f, "instr") ?? "").find((t) => /^\s*TOC\b/i.test(t));
    if (!instr) continue;
    let depth = fieldDepth(p);
    let last = p;
    for (let n = p.nextSibling; depth > 0 && n; n = n.nextSibling) {
      if (n.nodeType === 1 && lname(n as Element) === "p") {
        depth += fieldDepth(n as Element);
        last = n as Element;
      }
    }
    if (depth > 0) return null;
    return { first: p, last, instr: ` ${instr.trim()} ` };
  }
  return null;
}

function setUpdateFields(pkg: Pkg) {
  const f = pkg.zip.file("word/settings.xml");
  if (!f) return;
  const doc = parseXml(f.asText(), "pengaturan");
  const root = doc.documentElement;
  if (!child(root, "updateFields")) {
    const AFTER = ["hdrShapeDefaults", "footnotePr", "endnotePr", "compat", "docVars", "rsids", "mathPr", "attachedSchema", "themeFontLang", "clrSchemeMapping", "doNotIncludeSubdocsInStats", "doNotAutoCompressPictures", "forceUpgrade", "captions", "readModeInkLockDown", "smartTagType", "schemaLibrary", "shapeDefaults", "doNotEmbedSmartTags", "decimalSymbol", "listSeparator"];
    const node = mk(doc, "updateFields", { val: "true" });
    const ref = elems(root).find((c) => AFTER.includes(lname(c)));
    if (ref) root.insertBefore(node, ref);
    else root.appendChild(node);
  }
  pkg.zip.file("word/settings.xml", serialize(doc));
}

// ---------- utama ----------

function removeRange(pkg: Pkg, from: number, to: number): Element | null {
  let sect: Element | null = null;
  for (let i = from; i < to; i++) {
    const el = pkg.blocks[i];
    if (!el || !el.parentNode) continue;
    const sp = lname(el) === "p" ? child(child(el, "pPr"), "sectPr") : null;
    if (sp) sect = clone(sp);
    el.parentNode.removeChild(el);
  }
  return sect;
}

function sectParagraph(doc: Document, sect: Element): Element {
  return mk(doc, "p", {}, [mk(doc, "pPr", {}, [sect])]);
}

export async function buildDocxFromTemplate(b: BuildInput, template: Uint8Array, mapping: Mapping): Promise<BuildResult> {
  const pkg = openPackage(template);
  const doc = pkg.doc;
  const els = pkg.blocks;
  const n = els.length;

  const finalSect = els.length && lname(els[n - 1]) === "sectPr" ? els[n - 1] : null;
  const limit = finalSect ? n - 1 : n;
  const bodyStart = mapping.bodyStart;
  if (!Number.isInteger(bodyStart) || bodyStart < 0 || bodyStart >= limit) throw new TemplateError("Awal isi pada template tidak valid. Pilih ulang paragraf tempat isi dimulai.");
  const bibHeading = mapping.bibHeading !== null && mapping.bibHeading !== undefined && mapping.bibHeading > bodyStart && mapping.bibHeading < limit ? mapping.bibHeading : null;
  const bodyEnd = bibHeading ?? limit;
  const bibEnd = bibHeading !== null && mapping.bibEnd !== null && mapping.bibEnd !== undefined && mapping.bibEnd > bibHeading && mapping.bibEnd < limit ? mapping.bibEnd : limit;

  // 1) contoh format (sebelum ada yang dihapus)
  const sBody = capture(pkg, mapping.samples.body);
  const bodyPPr = sBody?.pPr ? stripBodyPPr(sBody.pPr) : (() => {
    const p = mk(doc, "pPr");
    setPprChild(doc, p, "spacing", { line: "360", lineRule: "auto", after: "120" });
    setPprChild(doc, p, "ind", { firstLine: "567" });
    setPprChild(doc, p, "jc", { val: "both" });
    return p;
  })();
  const bodyRPr = stripBodyRPr(sBody?.rPr ?? null);

  const sect = sectPrOf(pkg) ?? descendants(pkg.body, "sectPr")[0] ?? null;
  const pg = child(sect, "pgSz");
  const mar = child(sect, "pgMar");
  const num = (e: Element | null, a: string) => Number(attr(e, a));
  const cw = pg && mar ? num(pg, "w") - num(mar, "left") - num(mar, "right") : 0;

  const ctx: Ctx = {
    doc,
    bodyPPr,
    bodyRPr,
    heads: { 1: null as never, 2: null as never, 3: null as never },
    contentW: cw > 2000 ? cw : 7937,
  };
  const mkHead = (level: 1 | 2 | 3) => {
    const s = capture(pkg, mapping.samples[`h${level}` as "h1" | "h2" | "h3"]);
    if (s) return { pPr: s.pPr, rPr: s.rPr, upper: s.upper, autoNum: s.autoNum, bold: false };
    const pPr = bodyPPr ? clone(bodyPPr) : mk(doc, "pPr");
    removeChildren(pPr, ["ind"]);
    setPprChild(doc, pPr, "jc", { val: level === 1 ? "center" : "left" });
    return { pPr, rPr: bodyRPr, upper: false, autoNum: false, bold: true };
  };
  ctx.heads = { 1: mkHead(1), 2: mkHead(2), 3: mkHead(3) };

  let bibSample: { pPr: Element | null; rPr: Element | null } | null = null;
  if (bibHeading !== null) {
    for (let i = bibHeading + 1; i < bibEnd; i++) {
      if (lname(els[i]) === "p" && textOf(els[i]).trim().length > 15) {
        const s = capture(pkg, i);
        if (s) bibSample = { pPr: stripBodyPPr(s.pPr), rPr: stripBodyRPr(s.rPr) };
        break;
      }
    }
  }

  // 2) sampul dan placeholder
  const idv = b.identity;
  const values: Record<CoverField, string> = {
    judul: xmlSafe(b.judul),
    nama: xmlSafe(idv.nama),
    nim: xmlSafe(idv.nim),
    prodi: xmlSafe(idv.prodi),
    kampus: xmlSafe(idv.kampus),
    tahun: xmlSafe(idv.tahun),
    pembimbing: xmlSafe(idv.pembimbing),
  };
  fillCover(pkg, mapping, values, bodyStart);
  fillPlaceholders(doc, values);
  for (const name of Object.keys(pkg.zip.files)) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    const txt = pkg.zip.file(name)?.asText() ?? "";
    if (!txt.includes("{{")) continue;
    const hd = parseXml(txt, "header/footer");
    fillPlaceholders(hd, values);
    pkg.zip.file(name, serialize(hd));
  }

  // 3) isi: buat elemen baru
  const sourceMap = new Map(b.sources.map((s) => [s.id, s]));
  const order = citedOrder(b.sections.filter((s) => s.kind !== "heading").map((s) => s.text), new Set(sourceMap.keys()));
  const numbers = new Map(order.map((id, i) => [id, i + 1]));
  const listState = { n: 0 };
  const content: Element[] = [];
  const headings: { title: string; level: number }[] = [];
  for (const s of b.sections) {
    const h = headingElem(ctx, s.level, s.title);
    headings.push({ title: h.text, level: s.level });
    content.push(h.el);
    if (s.kind === "heading") continue;
    content.push(...bodyElems(ctx, renderInText(s.text, sourceMap, b.style, numbers), listState));
  }

  // 4) daftar isi
  const blocks = describeBlocks(pkg);
  let tocUsed = mapping.tocMode === "keep" && blocks.some((x) => x.kind === "toc");
  const front: Element[] = [];
  if (mapping.tocMode === "keep") {
    // field TOC template dipertahankan; isi sementaranya diganti judul sebenarnya (Word memperbarui nomor halaman saat dibuka)
    const r = findTocRange(pkg);
    if (r?.first.parentNode) {
      const parent = r.first.parentNode;
      const ref = r.last.nextSibling;
      for (let n: Node | null = r.first; n; ) {
        const nx: Node | null = n === r.last ? null : n.nextSibling;
        parent.removeChild(n);
        n = nx;
      }
      for (const e of tocElems(pkg, ctx, headings, r.instr)) parent.insertBefore(e, ref);
      tocUsed = true;
    }
  } else if (mapping.tocMode === "replace" && mapping.tocHeading !== null && mapping.tocHeading < bodyStart) {
    let i = mapping.tocHeading + 1;
    while (i < bodyStart) {
      const bi = blocks[i];
      const empty = bi.kind === "p" && !bi.text.trim() && !bi.pageBreak && !bi.sectBreak;
      if (bi.kind === "toc" || (bi.kind === "p" && !bi.pageBreak && !bi.sectBreak && (bi.tocLine || empty))) i++;
      else break;
    }
    const heading = els[mapping.tocHeading];
    for (let k = mapping.tocHeading + 1; k < i; k++) els[k].parentNode?.removeChild(els[k]);
    const ref = heading.nextSibling;
    for (const e of tocElems(pkg, ctx, headings)) heading.parentNode!.insertBefore(e, ref);
    tocUsed = true;
  } else if (mapping.tocMode === "add") {
    const pPr = ctx.bodyPPr ? clone(ctx.bodyPPr) : mk(doc, "pPr");
    removeChildren(pPr, ["ind"]);
    setPprChild(doc, pPr, "pageBreakBefore", {});
    setPprChild(doc, pPr, "jc", { val: "center" });
    front.push(para(doc, pPr, [textRun(doc, "DAFTAR ISI", ctx.bodyRPr, { bold: true })]), ...tocElems(pkg, ctx, headings));
    if (!child(ctx.heads[1].pPr, "pageBreakBefore")) front.push(mk(doc, "p", {}, [mk(doc, "r", {}, [mk(doc, "br", { type: "page" })])]));
    tocUsed = true;
  }

  // 5) ganti isi
  const bodySect = removeRange(pkg, bodyStart, bodyEnd);
  const bodyRef: Node | null = bibHeading !== null ? els[bibHeading] : finalSect;
  const place = (e: Element) => pkg.body.insertBefore(e, bodyRef);
  front.forEach(place);
  content.forEach(place);
  if (bodySect) place(sectParagraph(doc, bodySect));

  // 6) daftar pustaka
  const entries = order.length ? buildBibliography(order, sourceMap, b.style) : [];
  const entryElems = entries.map((e) => {
    let pPr: Element;
    if (bibSample?.pPr) {
      pPr = clone(bibSample.pPr);
      if (e.number !== undefined && !child(pPr, "ind")) setPprChild(doc, pPr, "ind", { left: "720", hanging: "720" });
    } else {
      pPr = ctx.bodyPPr ? clone(ctx.bodyPPr) : mk(doc, "pPr");
      setPprChild(doc, pPr, "ind", { left: "720", hanging: "720" });
      setPprChild(doc, pPr, "spacing", { line: "276", lineRule: "auto", after: "160" });
      setPprChild(doc, pPr, "jc", { val: "left" });
    }
    const rPr = bibSample?.rPr ?? ctx.bodyRPr;
    const runs = e.segs.map((s) => textRun(doc, s.t, rPr, { italic: s.i }));
    if (e.number !== undefined) runs.unshift(textRun(doc, `${e.number}.`, rPr), mk(doc, "r", {}, [mk(doc, "tab")]));
    return para(doc, pPr, runs);
  });

  if (bibHeading !== null) {
    const sect2 = removeRange(pkg, bibHeading + 1, bibEnd);
    const heading = els[bibHeading];
    const ref: Node | null = bibEnd < limit ? els[bibEnd] : finalSect;
    if (!entries.length) {
      heading.parentNode?.removeChild(heading);
    } else {
      entryElems.forEach((e) => pkg.body.insertBefore(e, ref));
    }
    if (sect2) pkg.body.insertBefore(sectParagraph(doc, sect2), ref);
  } else if (entries.length) {
    const h = headingElem(ctx, 1, "DAFTAR PUSTAKA");
    const pPr = ensurePPr(doc, h.el);
    if (!child(pPr, "pageBreakBefore")) setPprChild(doc, pPr, "pageBreakBefore", {});
    pkg.body.insertBefore(h.el, finalSect);
    entryElems.forEach((e) => pkg.body.insertBefore(e, finalSect));
  }

  // 7) simpan
  if (tocUsed) setUpdateFields(pkg);
  pkg.zip.file("word/document.xml", serialize(doc));
  // Susun paket baru hanya dari berkas (bukan entri folder). Jangan pakai zip.remove("word/"): pada PizZip itu menghapus folder BESERTA seluruh isinya,
  // sehingga template berentri folder (hasil 7-Zip, macOS, dll) menghasilkan file kosong yang tidak bisa dibuka Word.
  const out = new PizZip();
  const names = Object.keys(pkg.zip.files).filter((n) => !pkg.zip.files[n].dir);
  names.sort((a, b) => (a === "[Content_Types].xml" ? -1 : b === "[Content_Types].xml" ? 1 : 0));
  for (const name of names) {
    const f = pkg.zip.file(name);
    if (f) out.file(name, f.asUint8Array());
  }
  if (!out.file("word/document.xml") || !out.file("[Content_Types].xml")) throw new TemplateError("Gagal menyusun file Word hasil. Coba simpan ulang template dari Word sebagai .docx.");
  const buffer = out.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  return { buffer, citedCount: order.length };
}
