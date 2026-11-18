import PizZip from "pizzip";
import { TemplateError, attr, child, childrenNamed, descendants, elems, lname, parseXml } from "./xml";

export const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;
const MAX_UNZIPPED = 80 * 1024 * 1024;

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

  let total = 0;
  for (const name of Object.keys(zip.files)) {
    total += (zip.files[name] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  }
  if (total > MAX_UNZIPPED) throw new TemplateError("Isi file template terlalu besar.");

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
