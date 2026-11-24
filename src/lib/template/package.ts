import PizZip from "pizzip";
import { TemplateError, attr, child, childrenNamed, descendants, elems, lname, parseXml } from "./xml";

export const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;
export const MAX_UNZIPPED = 80 * 1024 * 1024;
/** T11: batas paket tidak tepercaya. */
export const MAX_ENTRIES = 1500;
export const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
/** Nisbah isi/terkompresi yang wajar untuk .docx adalah belasan; di atas ini (dan di atas lantai) dianggap zip bomb. */
export const MAX_RATIO = 100;
export const RATIO_FLOOR = 5 * 1024 * 1024;

// Segmen "..", jalur mutlak, garis miring terbalik, huruf drive, dan NUL. Nama entri seperti ini tidak pernah ada di .docx sah.
const UNSAFE_NAME = /(^|\/)\.\.(\/|$)|^\/|\\|^[A-Za-z]:|\0/;

/**
 * Periksa paket zip sebelum ada isinya yang dibaca. Ukuran memakai angka dari header zip (PizZip tidak bisa membaca bertahap),
 * jadi bagian yang dibaca kemudian tetap dibatasi lagi per bagian (parseXml: MAX_XML_CHARS).
 */
export function assertSafeZip(zip: PizZip, compressedBytes: number): void {
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new TemplateError("File Word memuat terlalu banyak berkas.");
  let total = 0;
  for (const name of names) {
    if (UNSAFE_NAME.test(name)) throw new TemplateError("File Word memuat jalur berkas yang tidak aman dan ditolak.");
    const declared = (zip.files[name] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declared === "number") {
      if (declared > MAX_ENTRY_BYTES) throw new TemplateError("Isi file template terlalu besar.");
      total += declared;
    }
  }
  if (total > MAX_UNZIPPED) throw new TemplateError("Isi file template terlalu besar.");
  if (total > RATIO_FLOOR && total / Math.max(compressedBytes, 1) > MAX_RATIO) throw new TemplateError("Isi file template terkompresi secara tidak wajar dan ditolak.");
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) throw new TemplateError("Template memuat makro dan ditolak. Simpan template sebagai .docx biasa (bukan .docm).");
}

export interface StyleDef {
  id: string;
  name: string | null;
  basedOn: string | null;
  type: string | null;
  pPr: Element | null;
  rPr: Element | null;
}

export class Styles {
  map = new Map<string, StyleDef>();
  defaultPara: string | null = null;
  docRPr: Element | null = null;
  docPPr: Element | null = null;

  /** Dari gaya itu naik ke gaya induknya. */
  chain(id: string | null): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let cur = id ? this.map.get(id) : undefined;
    while (cur && !seen.has(cur.id)) {
      out.push(cur);
      seen.add(cur.id);
      cur = cur.basedOn ? this.map.get(cur.basedOn) : undefined;
    }
    return out;
  }
}

export interface Pkg {
  zip: PizZip;
  doc: Document;
  body: Element;
  blocks: Element[];
  styles: Styles;
}

function parseStyles(zip: PizZip): Styles {
  const st = new Styles();
  const f = zip.file("word/styles.xml");
  if (!f) return st;
  const root = parseXml(f.asText(), "gaya").documentElement;
  const dd = child(root, "docDefaults");
  st.docRPr = child(child(child(dd, "rPrDefault"), "rPr") ? child(dd, "rPrDefault") : null, "rPr");
  st.docPPr = child(child(dd, "pPrDefault"), "pPr");
  for (const s of childrenNamed(root, "style")) {
    const id = attr(s, "styleId");
    if (!id) continue;
    const def: StyleDef = {
      id,
      name: attr(child(s, "name"), "val"),
      basedOn: attr(child(s, "basedOn"), "val"),
      type: attr(s, "type"),
      pPr: child(s, "pPr"),
      rPr: child(s, "rPr"),
    };
    st.map.set(id, def);
    if (def.type === "paragraph" && attr(s, "default") === "1") st.defaultPara = id;
  }
  return st;
}

export function openPackage(buf: Uint8Array): Pkg {
  if (buf.length > MAX_TEMPLATE_BYTES) throw new TemplateError("Ukuran file template maksimal 8 MB.");
  let zip: PizZip;
  try {
    zip = new PizZip(buf);
  } catch {
    throw new TemplateError("File bukan dokumen Word (.docx) yang valid. Simpan ulang dari Word sebagai .docx.");
  }
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new TemplateError("File bukan dokumen Word (.docx) yang valid.");

  assertSafeZip(zip, buf.length);

  const doc = parseXml(docFile.asText(), "isi dokumen");
  const body = child(doc.documentElement, "body");
  if (!body) throw new TemplateError("Dokumen Word tidak memiliki isi.");
  return { zip, doc, body, blocks: elems(body), styles: parseStyles(zip) };
}

export function sectPrOf(p: Pkg): Element | null {
  const last = p.blocks[p.blocks.length - 1];
  return last && lname(last) === "sectPr" ? last : null;
}

export function countSections(p: Pkg): number {
  return descendants(p.body, "sectPr").length;
}
