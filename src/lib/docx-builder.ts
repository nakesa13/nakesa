import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { CiteStyle, DocSection, Identity, Source } from "./types";
import { buildBibliography, citedOrder, renderInText, type Seg } from "./citations";
import { parseBlocks, parseInline } from "./markup";
import { xmlSafe } from "./template/xml";

const FONT = "Times New Roman";
const SIZE = 24; // 12 pt
const PAGE_W = 11906; // A4
const PAGE_H = 16838;
const M_TOP = 2268; // 4 cm
const M_LEFT = 2268; // 4 cm
const M_RIGHT = 1701; // 3 cm
const M_BOTTOM = 1701; // 3 cm
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT; // 7937
const BODY_LINE = 360; // spasi 1,5

export interface BuildInput {
  coverTitle: string;
  judul: string;
  identity: Identity;
  sections: DocSection[];
  sources: Source[];
  style: CiteStyle;
  chapterStyle: "center" | "left";
}

export interface BuildResult {
  buffer: Buffer;
  citedCount: number;
  /** T12: id sumber yang dikutip dan masuk daftar pustaka (urutan kemunculan). Dipakai pemeriksa .docx. */
  citedIds: string[];
}

const NUMBERED_REF = "nakesa-numbered";

function run(text: string, opts: { bold?: boolean; italics?: boolean; size?: number } = {}): TextRun {
  // T12: karakter kontrol dari hasil tempel (PDF) membuat XML tidak sah dan Word menolak file; buang di satu tempat ini.
  return new TextRun({ text: xmlSafe(text), font: FONT, size: opts.size ?? SIZE, bold: opts.bold, italics: opts.italics });
}

function inlineRuns(text: string, base: { bold?: boolean; size?: number } = {}): TextRun[] {
  return parseInline(text).map((r) => run(r.text, { bold: r.bold || base.bold, size: base.size }));
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: BODY_LINE, after: 120 },
    indent: { firstLine: 567 },
    children: inlineRuns(text),
  });
}

function tableFrom(rows: string[][]): Table {
  const cols = Math.max(...rows.map((r) => r.length));
  let widths: number[];
  if (cols === 2) widths = [2800, CONTENT_W - 2800];
  else {
    const w = Math.floor(CONTENT_W / cols);
    widths = Array.from({ length: cols }, (_, i) => (i === cols - 1 ? CONTENT_W - w * (cols - 1) : w));
  }
  const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map(
      (r, ri) =>
        new TableRow({
          tableHeader: ri === 0,
          cantSplit: true,
          children: widths.map(
            (w, ci) =>
              new TableCell({
                width: { size: w, type: WidthType.DXA },
                borders,
                margins: { top: 40, bottom: 40, left: 100, right: 100 },
                shading: ri === 0 ? { fill: "E7E6E6", type: ShadingType.CLEAR, color: "auto" } : undefined,
                children: [
                  new Paragraph({
                    spacing: { line: 276, after: 0 },
                    children: inlineRuns(r[ci] ?? "", { bold: ri === 0 }),
                  }),
                ],
              })
          ),
        })
    ),
  });
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

function blocksToDocx(text: string, state: { listCount: number }): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const b of parseBlocks(text)) {
    if (b.t === "p") {
      // Paragraf yang seluruhnya tebal (mis. "**Keluhan utama**") = label: tanpa indentasi, menempel ke isi.
      if (/^\*\*[^*]+\*\*:?$/.test(b.text)) {
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            keepNext: true,
            spacing: { line: BODY_LINE, before: 80, after: 40 },
            children: inlineRuns(b.text),
          })
        );
      } else {
        out.push(bodyParagraph(b.text));
      }
    } else if (b.t === "ul") {
      for (const item of b.items) {
        out.push(
          new Paragraph({
            numbering: { reference: "nakesa-bullets", level: 0 },
            alignment: AlignmentType.JUSTIFIED,
            spacing: { line: BODY_LINE, after: 60 },
            children: inlineRuns(item),
          })
        );
      }
    } else if (b.t === "ol") {
      state.listCount += 1;
      for (const item of b.items) {
        out.push(
          new Paragraph({
            numbering: { reference: NUMBERED_REF, level: 0, instance: state.listCount },
            alignment: AlignmentType.JUSTIFIED,
            spacing: { line: BODY_LINE, after: 60 },
            children: inlineRuns(item),
          })
        );
      }
    } else {
      out.push(tableFrom(b.rows), spacer());
    }
  }
  return out;
}

function coverPage(b: BuildInput): Paragraph[] {
  const c = (text: string, o: { bold?: boolean; size?: number; before?: number } = {}) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: o.before ?? 0, after: 120, line: 276 },
      children: [run(text, { bold: o.bold, size: o.size })],
    });
  const id = b.identity;
  const out: Paragraph[] = [
    c(b.coverTitle, { bold: true, size: 32, before: 1200 }),
    c(b.judul.toUpperCase(), { bold: true, size: 28, before: 480 }),
    c("Disusun oleh:", { before: 2400 }),
  ];
  if (id.nama) out.push(c(id.nama, { bold: true }));
  if (id.nim) out.push(c(`NIM: ${id.nim}`));
  if (id.pembimbing) {
    out.push(c("Dosen Pembimbing:", { before: 480 }), c(id.pembimbing));
  }
  const bottom = [id.prodi && `PROGRAM STUDI ${id.prodi.toUpperCase()}`, id.kampus && id.kampus.toUpperCase(), id.tahun].filter(Boolean) as string[];
  bottom.forEach((t, i) => out.push(c(t, { bold: i < bottom.length - 1, before: i === 0 ? 2400 : 0 })));
  return out;
}

function headingParagraph(s: DocSection, chapterStyle: "center" | "left"): Paragraph {
  const level = s.level === 1 ? HeadingLevel.HEADING_1 : s.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
  const center = s.level === 1 && chapterStyle === "center";
  const label = center ? s.title.toUpperCase() : s.title;
  return new Paragraph({
    heading: level,
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [run(label, { bold: true })],
  });
}

function segRuns(segs: Seg[]): TextRun[] {
  return segs.map((s) => run(s.t, { italics: s.i }));
}

export async function buildDocx(b: BuildInput): Promise<BuildResult> {
  const sourceMap = new Map(b.sources.map((s) => [s.id, s]));
  const known = new Set(sourceMap.keys());
  const order = citedOrder(
    b.sections.filter((s) => s.kind !== "heading").map((s) => s.text),
    known
  );
  const numbers = new Map(order.map((id, i) => [id, i + 1]));

  const content: (Paragraph | Table)[] = [];
  const state = { listCount: 0 };
  let first = true;

  for (const s of b.sections) {
    const h = headingParagraph(s, b.chapterStyle);
    if (s.level === 1 && !first && b.chapterStyle === "center") {
      content.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [run(s.title.toUpperCase(), { bold: true })] }));
    } else {
      content.push(h);
    }
    first = false;
    if (s.kind === "heading") continue;
    const text = renderInText(s.text, sourceMap, b.style, numbers);
    content.push(...blocksToDocx(text, state));
  }

  // Daftar pustaka
  if (order.length) {
    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        alignment: b.chapterStyle === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [run(b.chapterStyle === "center" ? "DAFTAR PUSTAKA" : "Daftar Pustaka", { bold: true })],
      })
    );
    for (const e of buildBibliography(order, sourceMap, b.style)) {
      content.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { line: 276, after: 160 },
          indent: { left: 720, hanging: 720 },
          children: [...(e.number ? [run(`${e.number}.\t`)] : []), ...segRuns(e.segs)],
          tabStops: e.number ? [{ type: "left" as const, position: 720 }] : undefined,
        })
      );
    }
  }

  const pageProps = {
    size: { width: PAGE_W, height: PAGE_H },
    margin: { top: M_TOP, left: M_LEFT, right: M_RIGHT, bottom: M_BOTTOM },
  };

  const doc = new Document({
    creator: "NAKESA",
    title: xmlSafe(b.judul),
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE } },
        heading1: {
          run: { font: FONT, size: SIZE, bold: true },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
        },
        heading2: {
          run: { font: FONT, size: SIZE, bold: true },
          paragraph: { spacing: { before: 200, after: 100 }, keepNext: true },
        },
        heading3: {
          run: { font: FONT, size: SIZE, bold: true, italics: true },
          paragraph: { spacing: { before: 160, after: 80 }, keepNext: true },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "nakesa-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1134, hanging: 397 } } },
            },
          ],
        },
        {
          reference: NUMBERED_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1134, hanging: 397 } } },
            },
          ],
        },
      ],
    },
    sections: [
      { properties: { page: pageProps }, children: coverPage(b) },
      {
        properties: { page: { ...pageProps, pageNumbers: { start: 1 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SIZE })],
              }),
            ],
          }),
        },
        children: content,
      },
    ],
  });

  return { buffer: await Packer.toBuffer(doc), citedCount: order.length, citedIds: order };
}
