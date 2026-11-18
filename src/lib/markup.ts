/**
 * Mini-markup teks bagian dokumen:
 *  - paragraf dipisah baris kosong
 *  - "- butir" / "* butir"  -> daftar poin
 *  - "1. butir" / "1) butir" -> daftar bernomor
 *  - "| a | b |"            -> tabel (baris pertama = judul kolom)
 *  - **tebal** di dalam teks
 */
export type Block =
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "table"; rows: string[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", text: para.join(" ").trim() });
    para = [];
  };
  const last = () => blocks[blocks.length - 1];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      continue;
    }
    if (line.trim().startsWith("|")) {
      flushPara();
      if (/^\|?\s*:?-{3,}/.test(line.trim())) continue; // baris pemisah tabel
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const prev = last();
      if (prev && prev.t === "table") prev.rows.push(cells);
      else blocks.push({ t: "table", rows: [cells] });
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      flushPara();
      const prev = last();
      if (prev && prev.t === "ul") prev.items.push(b[1].trim());
      else blocks.push({ t: "ul", items: [b[1].trim()] });
      continue;
    }
    const n = NUMBER.exec(line);
    if (n) {
      flushPara();
      const prev = last();
      if (prev && prev.t === "ol") prev.items.push(n[1].trim());
      else blocks.push({ t: "ol", items: [n[1].trim()] });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

export interface InlineRun {
  text: string;
  bold?: boolean;
}

export function parseInline(text: string): InlineRun[] {
  const out: InlineRun[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > idx) out.push({ text: text.slice(idx, m.index) });
    out.push({ text: m[1], bold: true });
    idx = m.index + m[0].length;
  }
  if (idx < text.length) out.push({ text: text.slice(idx) });
  return out.length ? out : [{ text }];
}
