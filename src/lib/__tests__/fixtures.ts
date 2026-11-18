import { AlignmentType, Document, Footer, Header, ImageRun, LeaderType, NumberFormat, PageNumber, Packer, Paragraph, Tab, TabStopType, TableOfContents, TextRun, HeadingLevel } from "docx";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const LONG = "Ini contoh paragraf isi dari template kampus yang cukup panjang supaya terdeteksi sebagai contoh paragraf isi oleh pembaca template, lengkap dengan beberapa kalimat tambahan.";
const c = (text: string, o: { bold?: boolean; size?: number; font?: string } = {}) =>
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: o.bold, size: o.size, font: o.font })] });

/** Template 1: gaya Word (Heading 1-3), logo, nomor romawi, daftar isi otomatis, header/footer. Font Arial 11. */
export async function styledTemplate(): Promise<Buffer> {
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22 }, paragraph: { spacing: { line: 276 } } },
        heading1: { run: { font: "Arial", size: 28, bold: true }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 }, keepNext: true } },
        heading2: { run: { font: "Arial", size: 24, bold: true }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true } },
        heading3: { run: { font: "Arial", size: 22, bold: true, italics: true }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true } },
      },
    },
    sections: [
      {
        children: [
          c("UNIVERSITAS CONTOH NUSANTARA", { bold: true, size: 28 }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: PNG, transformation: { width: 90, height: 90 } })] }),
          c("LAPORAN PENDAHULUAN", { bold: true, size: 28 }),
          c("JUDUL CONTOH LAPORAN KASUS", { bold: true, size: 26 }),
          c("Disusun oleh:"),
          new Paragraph({ children: [new TextRun({ text: "Nama\t: ", bold: true }), new TextRun("Mahasiswa Contoh")] }),
          new Paragraph({ children: [new TextRun({ text: "NIM\t: ", bold: true }), new TextRun("000000")] }),
          c("PROGRAM STUDI D III KEBIDANAN", { bold: true }),
          c("UNIVERSITAS CONTOH NUSANTARA", { bold: true }),
          c("2000"),
        ],
      },
      {
        properties: { page: { pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) },
        children: [
          c("KATA PENGANTAR", { bold: true }),
          new Paragraph({ children: [new TextRun("Puji syukur kami panjatkan ke hadirat Tuhan Yang Maha Esa.")] }),
          new TableOfContents("DAFTAR ISI", { hyperlink: true, headingStyleRange: "1-3" }),
        ],
      },
      {
        properties: { page: { pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
        headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun("Header Kampus Contoh")] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ["Hal. ", PageNumber.CURRENT] })] })] }) },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("BAB I PENDAHULUAN")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("A. Latar Belakang")] }),
          new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 567 }, children: [new TextRun(LONG)] }),
          new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("1. Contoh Sub")] }),
          new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 567 }, children: [new TextRun(LONG + " Tambahan.")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("DAFTAR PUSTAKA")] }),
          new Paragraph({ indent: { left: 720, hanging: 720 }, children: [new TextRun("Contoh, A. (2000). Entri contoh dari template kampus. Penerbit Contoh.")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("LAMPIRAN")] }),
          new Paragraph({ children: [new TextRun("Isi lampiran contoh yang harus tetap ada.")] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** Template 2: tanpa gaya (format langsung), daftar isi statis bertitik, bab diketik manual. TNR 12. */
export async function directTemplate(): Promise<Buffer> {
  const tab = { tabStops: [{ type: TabStopType.RIGHT, position: 7900, leader: LeaderType.DOT }] };
  const toc = (t: string, pg: string) => new Paragraph({ ...tab, children: [new TextRun({ children: [t, new Tab(), pg], font: "Times New Roman", size: 24 })] });
  const T = (text: string, o: { bold?: boolean } = {}) => new TextRun({ text, font: "Times New Roman", size: 24, bold: o.bold });
  const doc = new Document({
    sections: [
      {
        children: [
          c("POLITEKNIK KESEHATAN CONTOH", { bold: true, font: "Times New Roman", size: 28 }),
          c("LAPORAN KASUS", { bold: true, font: "Times New Roman", size: 28 }),
          c("ASUHAN KEBIDANAN PADA NY. X DENGAN KASUS CONTOH", { bold: true, font: "Times New Roman", size: 26 }),
          new Paragraph({ children: [T("Nama : Contoh")] }),
          new Paragraph({ children: [T("NIM : 111")] }),
          c("2000", { font: "Times New Roman" }),
          new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, children: [T("DAFTAR ISI", { bold: true })] }),
          toc("BAB I PENDAHULUAN", "1"),
          toc("A. Latar Belakang", "1"),
          toc("DAFTAR PUSTAKA", "9"),
          new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [T("BAB I PENDAHULUAN", { bold: true })] }),
          new Paragraph({ spacing: { before: 120 }, children: [T("A. Latar Belakang", { bold: true })] }),
          new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { line: 480 }, indent: { firstLine: 720 }, children: [T(LONG)] }),
          new Paragraph({ children: [T("1. Contoh Sub", { bold: true })] }),
          new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { line: 480 }, indent: { firstLine: 720 }, children: [T(LONG + " Tambahan.")] }),
          new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, children: [T("DAFTAR PUSTAKA", { bold: true })] }),
          new Paragraph({ indent: { left: 720, hanging: 720 }, children: [T("Contoh, A. (2000). Entri contoh dari template kampus. Penerbit Contoh.")] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** Template 3: placeholder {{...}} di sampul dan header, tanpa daftar isi dan tanpa daftar pustaka. */
export async function placeholderTemplate(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun("{{kampus}} - {{prodi}}")] })] }) },
        children: [
          c("{{judul}}", { bold: true }),
          c("Oleh {{nama}} ({{nim}})"),
          c("Pembimbing: {{pembimbing}}"),
          c("{{tahun}}"),
          new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "BAB I PENDAHULUAN", bold: true })] }),
          new Paragraph({ children: [new TextRun({ text: "A. Latar Belakang", bold: true })] }),
          new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [new TextRun(LONG)] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
