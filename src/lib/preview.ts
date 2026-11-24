import type { BuildInput } from "./docx-builder";
import { buildBibliography, citedOrder, renderInText, type Seg } from "./citations";
import { parseBlocks, parseInline, type InlineRun } from "./markup";

/**
 * T12: model pratinjau dokumen. Dibuat dari bahan yang sama dengan builder .docx (sitasi, daftar pustaka, urutan sumber
 * memakai fungsi yang sama), tetapi hanya PERKIRAAN tampilan: font, spasi, nomor halaman, daftar isi, dan format template
 * kampus tidak ditiru persis. Antarmuka wajib melabelinya "perkiraan".
 */

export type PreviewBlock =
  | { t: "h"; level: 1 | 2 | 3; text: string; center: boolean; pageBreak: boolean }
  | { t: "p"; runs: InlineRun[]; label: boolean }
  | { t: "list"; ordered: boolean; items: InlineRun[][] }
  | { t: "table"; rows: InlineRun[][][] };

export interface PreviewCover {
  title: string;
  judul: string;
  lines: string[];
  bottom: string[];
}

export interface PreviewDoc {
  cover: PreviewCover;
  blocks: PreviewBlock[];
  bibliography: { heading: string; center: boolean; entries: { number?: number; segs: Seg[] }[] } | null;
  /** Sumber yang dikutip, urutan kemunculan pertama (sama dengan yang masuk daftar pustaka .docx). */
  citedIds: string[];
}

const LABEL_RE = /^\*\*[^*]+\*\*:?$/;

function cover(b: BuildInput): PreviewCover {
  const id = b.identity;
  const lines = ["Disusun oleh:"];
  if (id.nama) lines.push(id.nama);
  if (id.nim) lines.push(`NIM: ${id.nim}`);
  if (id.pembimbing) lines.push("Dosen Pembimbing:", id.pembimbing);
  const bottom = [id.prodi && `PROGRAM STUDI ${id.prodi.toUpperCase()}`, id.kampus && id.kampus.toUpperCase(), id.tahun].filter(Boolean) as string[];
  return { title: b.coverTitle, judul: b.judul.toUpperCase(), lines, bottom };
}

export function buildPreview(b: BuildInput): PreviewDoc {
  const sourceMap = new Map(b.sources.map((s) => [s.id, s]));
  const order = citedOrder(
    b.sections.filter((s) => s.kind !== "heading").map((s) => s.text),
    new Set(sourceMap.keys())
  );
  const numbers = new Map(order.map((id, i) => [id, i + 1]));
  const center = b.chapterStyle === "center";

  const blocks: PreviewBlock[] = [];
  let first = true;
  for (const s of b.sections) {
    const isChapter = s.level === 1;
    blocks.push({ t: "h", level: s.level, text: isChapter && center ? s.title.toUpperCase() : s.title, center: isChapter && center, pageBreak: isChapter && center && !first });
    first = false;
    if (s.kind === "heading") continue;
    for (const blk of parseBlocks(renderInText(s.text, sourceMap, b.style, numbers))) {
      if (blk.t === "p") blocks.push({ t: "p", runs: parseInline(blk.text), label: LABEL_RE.test(blk.text) });
      else if (blk.t === "ul" || blk.t === "ol") blocks.push({ t: "list", ordered: blk.t === "ol", items: blk.items.map((i) => parseInline(i)) });
      else blocks.push({ t: "table", rows: blk.rows.map((r) => r.map((c) => parseInline(c))) });
    }
  }

  const bibliography = order.length
    ? {
        heading: center ? "DAFTAR PUSTAKA" : "Daftar Pustaka",
        center,
        entries: buildBibliography(order, sourceMap, b.style).map((e) => ({ number: e.number, segs: e.segs })),
      }
    : null;

  return { cover: cover(b), blocks, bibliography, citedIds: order };
}

/** Teks polos dari deretan run; dipakai test dan pemeriksaan. */
export const runsText = (runs: InlineRun[]): string => runs.map((r) => r.text).join("");
