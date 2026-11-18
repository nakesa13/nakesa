import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

export class TemplateError extends Error {}

export function parseXml(xml: string, what = "dokumen"): Document {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level !== "warning") errors.push(msg);
    },
  }).parseFromString(xml, "text/xml") as unknown as Document;
  if (errors.length || !doc.documentElement) throw new TemplateError(`Bagian ${what} pada file Word tidak dapat dibaca.`);
  return doc;
}

export function serialize(doc: Document): string {
  return new XMLSerializer().serializeToString(doc as never);
}

export function elems(parent: Node): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

export const lname = (e: Element): string => e.localName || e.nodeName.replace(/^.*:/, "");

export function child(parent: Element | null | undefined, name: string): Element | null {
  if (!parent) return null;
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && lname(n as Element) === name) return n as Element;
  }
  return null;
}

export function childrenNamed(parent: Element, name: string): Element[] {
  return elems(parent).filter((e) => lname(e) === name);
}

export function attr(e: Element | null | undefined, name: string): string | null {
  if (!e) return null;
  const v = e.getAttributeNS(W, name);
  if (v) return v;
  const w = e.getAttribute("w:" + name);
  return w || null;
}

export function descendants(root: Node, name: string, out: Element[] = []): Element[] {
  for (let n = root.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    if (lname(e) === name) out.push(e);
    descendants(e, name, out);
  }
  return out;
}

/** Teks tampak dari sebuah paragraf/blok (tanpa instruksi field dan teks terhapus). */
export function textOf(node: Node): string {
  let s = "";
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      const ln = lname(e);
      if (ln === "instrText" || ln === "delText") continue;
      if (ln === "t") s += e.textContent ?? "";
      else if (ln === "tab") s += "\t";
      else if (ln === "br" || ln === "cr") s += attr(e, "type") === "page" ? "" : " ";
      else if (ln === "noBreakHyphen") s += "-";
      else walk(e);
    }
  };
  walk(node);
  return s;
}

export function setAttr(e: Element, name: string, value: string) {
  e.setAttributeNS(W, "w:" + name, value);
}

export function mk(doc: Document, name: string, attrs: Record<string, string> = {}, kids: Node[] = []): Element {
  const e = doc.createElementNS(W, "w:" + name);
  for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, "w:" + k, v);
  for (const k of kids) e.appendChild(k);
  return e;
}

/** Buang karakter yang dilarang di XML 1.0 (mis. form feed, \u0002 dari hasil tempel PDF); Word menolak file yang memuatnya. */
export function xmlSafe(s: string): string {
  return s
    .replace(/[\u0000]/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, " ")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

export function textRun(doc: Document, text: string, rPr: Element | null, opt: { bold?: boolean; italic?: boolean } = {}): Element {
  const r = mk(doc, "r");
  const pr = rPr ? (rPr.cloneNode(true) as Element) : mk(doc, "rPr");
  if (opt.bold) setFlag(doc, pr, "b");
  if (opt.italic) setFlag(doc, pr, "i");
  if (elems(pr).length) r.appendChild(pr);
  const t = mk(doc, "t");
  t.setAttributeNS(XML_NS, "xml:space", "preserve");
  t.appendChild(doc.createTextNode(xmlSafe(text)));
  r.appendChild(t);
  return r;
}

// Urutan anak w:rPr menurut skema; dipakai agar elemen baru ditaruh di tempat yang sah.
const RPR_ORDER = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"];

export function setFlag(doc: Document, rPr: Element, name: "b" | "i", on = true) {
  const existing = child(rPr, name);
  if (existing) {
    if (on) existing.removeAttributeNS(W, "val");
    else setAttr(existing, "val", "0");
    return;
  }
  if (!on) return;
  insertOrdered(rPr, mk(doc, name), RPR_ORDER);
}

export function insertOrdered(parent: Element, node: Element, order: string[]) {
  const idx = order.indexOf(lname(node));
  for (const c of elems(parent)) {
    const ci = order.indexOf(lname(c));
    if (ci > idx) {
      parent.insertBefore(node, c);
      return;
    }
  }
  parent.appendChild(node);
}

export const PPR_ORDER = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];

export function removeChildren(parent: Element, names: string[]) {
  for (const c of elems(parent)) if (names.includes(lname(c))) parent.removeChild(c);
}

export function setPprChild(doc: Document, pPr: Element, name: string, attrs: Record<string, string> | null) {
  removeChildren(pPr, [name]);
  if (attrs) insertOrdered(pPr, mk(doc, name, attrs), PPR_ORDER);
}
