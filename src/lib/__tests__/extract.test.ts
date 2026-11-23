import { describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import { ExtractError, docxToText, extractSourceText } from "../extract";
import { styledTemplate } from "./fixtures";

describe("unggah jurnal/referensi: ekstraksi teks", () => {
  it("membaca teks dari file Word; kode field daftar isi tidak ikut", async () => {
    const buf = await styledTemplate();
    const r = await extractSourceText(new Uint8Array(buf), "jurnal.docx");
    expect(r.kind).toBe("docx");
    expect(r.pages).toBeNull();
    expect(r.text).toContain("A. Latar Belakang");
    expect(r.text).toContain("Isi lampiran contoh yang harus tetap ada.");
    expect(r.text).not.toMatch(/TOC\s+\\o/);
    expect(r.text).not.toContain("<w:");
    expect(r.chars).toBeGreaterThanOrEqual(200);
  });

  it("membaca file teks dan menolak yang terlalu pendek", async () => {
    const ok = await extractSourceText(new TextEncoder().encode("Anemia adalah kondisi kekurangan hemoglobin. ".repeat(10)), "catatan.txt");
    expect(ok.kind).toBe("txt");
    expect(ok.truncated).toBe(false);
    await expect(extractSourceText(new TextEncoder().encode("terlalu pendek"), "a.txt")).rejects.toThrow(/terlalu pendek/i);
  });

  it("memotong teks yang sangat panjang pada 60.000 karakter", async () => {
    const r = await extractSourceText(new TextEncoder().encode("kalimat uji panjang. ".repeat(5000)), "panjang.txt");
    expect(r.text.length).toBe(60_000);
    expect(r.truncated).toBe(true);
    expect(r.chars).toBeGreaterThan(60_000);
  });

  it("menolak format yang tidak didukung dan file biner berekstensi txt", async () => {
    await expect(extractSourceText(new Uint8Array([1, 2, 3, 4, 5, 6, 7]), "a.exe")).rejects.toMatchObject({ status: 400 });
    const bin = new Uint8Array(400);
    bin.fill(65);
    bin[10] = 0;
    await expect(extractSourceText(bin, "palsu.txt")).rejects.toBeInstanceOf(ExtractError);
  });

  it("menolak file .docx yang rusak", () => {
    expect(() => docxToText(new Uint8Array([0x50, 0x4b, 1, 2, 3, 4]))).toThrow(ExtractError);
  });
});

// ---------- T03 ----------

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docxOf = (bodyXml: string): Uint8Array => {
  const zip = new PizZip();
  zip.file("word/document.xml", `<w:document ${W}><w:body>${bodyXml}</w:body></w:document>`);
  return new Uint8Array(zip.generate({ type: "uint8array" }));
};
const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const enc = (s: string) => new TextEncoder().encode(s);
const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ExtractError ? e.status : -1;
  }
  return 0;
};

describe("T03: isi .docx (revisi, entitas)", () => {
  it("teks revisi yang dihapus tidak ikut, tetapi penanda paragraf-dihapus (self-closing) tidak memakan teks sah", () => {
    const xml =
      `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr><w:r><w:t>Teks hidup satu.</w:t></w:r></w:p>` +
      para("Teks hidup dua.") +
      `<w:p><w:del w:id="2" w:author="A"><w:r><w:delText>teks terhapus</w:delText></w:r></w:del><w:r><w:t>Teks hidup tiga.</w:t></w:r></w:p>`;
    const t = docxToText(docxOf(xml));
    expect(t).toContain("Teks hidup satu.");
    expect(t).toContain("Teks hidup dua.");
    expect(t).toContain("Teks hidup tiga.");
    expect(t).not.toContain("teks terhapus");
  });

  it("teks yang dipindah (moveFrom) tidak terbaca dua kali; tujuannya tetap", () => {
    const xml = `<w:p><w:moveFromRangeStart w:id="5" w:name="m"/><w:moveFrom w:id="6"><w:r><w:t>teks pindah asal</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="5"/></w:p><w:p><w:moveTo w:id="7"><w:r><w:t>teks pindah tujuan</w:t></w:r></w:moveTo></w:p>`;
    const t = docxToText(docxOf(xml));
    expect(t).toContain("teks pindah tujuan");
    expect(t).not.toContain("teks pindah asal");
  });

  it("entitas XML didekode sekali saja (&amp;lt; menjadi &lt;, bukan <)", () => {
    expect(docxToText(docxOf(para("X &amp;lt; &#x41; &#66; &quot;q&quot;")))).toContain('X &lt; A B "q"');
  });

  it("XML dokumen raksasa (>30 juta karakter) ditolak 413", () => {
    const zip = new PizZip();
    zip.file("word/document.xml", "<w:document>" + "a".repeat(30_000_001) + "</w:document>");
    const bytes = new Uint8Array(zip.generate({ type: "uint8array", compression: "DEFLATE" }));
    expect(bytes.length).toBeLessThan(1_000_000);
    let err: unknown;
    try {
      docxToText(bytes);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ExtractError);
    expect(err).toMatchObject({ status: 413 });
  }, 30_000);
});

describe("T03: file kosong, rusak, dan tipe palsu", () => {
  it("file kosong: .txt -> 422 (terlalu pendek); .pdf dan .docx -> 400 (bukan format sah)", async () => {
    expect(await status(extractSourceText(new Uint8Array(0), "kosong.txt"))).toBe(422);
    expect(await status(extractSourceText(new Uint8Array(0), "kosong.pdf"))).toBe(400);
    expect(await status(extractSourceText(new Uint8Array(0), "kosong.docx"))).toBe(400);
  });

  it("PDF rusak (header %PDF- tetapi isi sampah) ditolak 422, dikenali dari isi bukan dari nama", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Byte dibuat baru per iterasi: pdf.js memindahkan (detach) buffer yang diberikan padanya.
    const bad = () => enc("%PDF-1.4\n" + "sampah bukan struktur pdf. ".repeat(40));
    try {
      for (const name of ["rusak.pdf", "rusak.txt", "rusak.docx"]) {
        await expect(extractSourceText(bad(), name), name).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/PDF/) });
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("zip valid tanpa word/document.xml bernama .docx -> 422; zip bernama .txt dan teks bernama .docx -> 400", async () => {
    const zip = new PizZip();
    zip.file("catatan.txt", "bukan dokumen Word");
    const z = new Uint8Array(zip.generate({ type: "uint8array" }));
    await expect(extractSourceText(z, "palsu.docx")).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/bukan dokumen Word/i) });
    expect(await status(extractSourceText(z, "palsu.txt"))).toBe(400);
    expect(await status(extractSourceText(enc("ini hanya teks biasa. ".repeat(30)), "palsu.docx"))).toBe(400);
  });

  it("txt: BOM dibuang, CRLF dinormalkan, karakter NUL setelah 4 KB dibersihkan", async () => {
    const raw = "\uFEFF" + "Baris uji tentang anemia pada ibu hamil.\r\n".repeat(150) + "ujung\u0000file";
    const r = await extractSourceText(enc(raw), "windows.txt");
    expect(r.kind).toBe("txt");
    expect(r.text).not.toContain("\r");
    expect(r.text).not.toContain("\u0000");
    expect(r.text.charCodeAt(0)).not.toBe(0xfeff);
    expect(r.text.startsWith("Baris uji")).toBe(true);
  });
});
