import { mkdirSync, writeFileSync } from "node:fs";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { analyzeTemplate } from "../template/analyze";
import { buildDocxFromTemplate } from "../template/build";
import type { BuildInput } from "../docx-builder";
import type { Source } from "../types";
import { directTemplate, placeholderTemplate, styledTemplate } from "./fixtures";

const OUT = process.env.NAKESA_OUT;
const src: Source = { id: "S1", type: "jurnal", title: "Judul artikel uji", authors: [{ family: "Rahma", given: "Sari" }], year: "2022", journal: "Jurnal Uji", origin: "manual", verified: false, content: "x".repeat(300) };

function input(): BuildInput {
  return {
    coverTitle: "LAPORAN PENDAHULUAN",
    judul: "Asuhan Kebidanan pada Ibu Bersalin",
    identity: { nama: "Siti Aminah", nim: "2301001", prodi: "D III Kebidanan", kampus: "Poltekkes Baru", pembimbing: "Dr. Bidan, M.Keb", tahun: "2026" },
    sections: [
      { id: "a", title: "BAB I PENDAHULUAN", level: 1, kind: "heading", text: "" },
      { id: "b", title: "A. Latar Belakang", level: 2, kind: "ai", text: "Persalinan adalah proses penting [S1].\n\n- butir satu\n- butir dua\n\n| Kolom A | Kolom B |\n| 1 | 2 |" },
      { id: "c", title: "1. Pengertian", level: 3, kind: "ai", text: "**Keluhan utama**\n\nIbu mengeluh nyeri." },
    ],
    sources: [src],
    style: "APA",
    chapterStyle: "center",
  };
}

const read = (buf: Buffer, name: string) => new PizZip(buf).file(name)?.asText() ?? "";

describe("template bergaya Word", () => {
  it("mempertahankan sampul, gaya, header/footer, dan mengganti isi", async () => {
    const tpl = await styledTemplate();
    const a = analyzeTemplate(tpl);
    expect(a.hasToc).toBe(true);
    expect(a.suggested.tocMode).toBe("keep");
    expect(a.formats.h1?.font).toBe("Arial");
    const res = await buildDocxFromTemplate(input(), tpl, a.suggested);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/styled.docx`, res.buffer);
      writeFileSync(`${OUT}/styled-template.docx`, tpl);
    }
    const doc = read(res.buffer, "word/document.xml");
    expect(doc).toContain("POLTEKKES BARU");
    expect(doc).not.toContain("UNIVERSITAS CONTOH NUSANTARA");
    expect(doc.replace(/<[^>]+>/g, "")).toContain("PROGRAM STUDI D III KEBIDANAN");
    expect(doc).toContain("Asuhan Kebidanan pada Ibu Bersalin".toUpperCase());
    expect(doc).toContain("Siti Aminah");
    expect(doc).not.toContain("Mahasiswa Contoh");
    expect(doc).toContain("<w:drawing");
    expect(doc).toContain("Persalinan adalah proses penting");
    expect(doc).not.toContain("Ini contoh paragraf isi");
    expect(doc).toContain("Isi lampiran contoh yang harus tetap ada.");
    expect(doc).toContain("Rahma");
    expect(doc).toContain('w:val="Heading1"');
    expect(doc).not.toContain("Contoh Sub");
    expect(doc).toContain('w:val="TOC2"');
    expect(read(res.buffer, "word/settings.xml")).toContain("updateFields");
    expect(Object.keys(new PizZip(res.buffer).files).some((f) => f.startsWith("word/footer"))).toBe(true);
    expect((doc.match(/<w:sectPr/g) ?? []).length).toBe((read(tpl, "word/document.xml").match(/<w:sectPr/g) ?? []).length);
  });
});

describe("template format langsung dan daftar isi statis", () => {
  it("mengganti daftar isi statis dengan field dan memakai format contoh", async () => {
    const tpl = await directTemplate();
    const a = analyzeTemplate(tpl);
    expect(a.suggested.tocMode).toBe("replace");
    expect(a.suggested.bibHeading).not.toBeNull();
    const res = await buildDocxFromTemplate(input(), tpl, a.suggested);
    if (OUT) {
      writeFileSync(`${OUT}/direct.docx`, res.buffer);
      writeFileSync(`${OUT}/direct-template.docx`, tpl);
    }
    const doc = read(res.buffer, "word/document.xml");
    expect(doc).toContain("TOC \\o");
    expect(doc).not.toContain("........");
    expect(doc).toContain('w:line="480"');
    expect(doc).toContain("Persalinan adalah proses penting");
    expect(doc).not.toContain("Ini contoh paragraf isi");
    expect(doc).toContain("Rahma");
    expect(doc).toContain("Siti Aminah");
  });
});

describe("template berplaceholder tanpa daftar isi", () => {
  it("mengisi placeholder di sampul dan header, menambah daftar isi dan daftar pustaka", async () => {
    const tpl = await placeholderTemplate();
    const a = analyzeTemplate(tpl);
    expect(a.placeholders).toContain("judul");
    expect(a.suggested.tocMode).toBe("add");
    const res = await buildDocxFromTemplate(input(), tpl, a.suggested);
    if (OUT) {
      writeFileSync(`${OUT}/placeholder.docx`, res.buffer);
      writeFileSync(`${OUT}/placeholder-template.docx`, tpl);
    }
    const doc = read(res.buffer, "word/document.xml");
    expect(doc).not.toContain("{{");
    expect(doc).toContain("Oleh Siti Aminah (2301001)");
    expect(doc).toContain("DAFTAR ISI");
    expect(doc).toContain("DAFTAR PUSTAKA");
    const hdr = Object.keys(new PizZip(res.buffer).files).filter((f) => /word\/header\d*\.xml/.test(f)).map((f) => read(res.buffer, f)).join("");
    expect(hdr).toContain("Poltekkes Baru - D III Kebidanan");
  });
});

describe("karakter kontrol dari hasil tempel (PDF)", () => {
  it("tidak menghasilkan XML tidak sah yang ditolak Word", async () => {
    const bad = "Teks\u000Cdari\u0002PDF\u0008ini";
    const tpl = await styledTemplate();
    const a = analyzeTemplate(tpl);
    const inp = input();
    inp.judul = "Uji " + bad;
    inp.identity.nama = "Siti" + bad;
    inp.sections[1].text = bad + " [S1].\n\n- " + bad;
    const res = await buildDocxFromTemplate(inp, tpl, a.suggested);
    const doc = read(res.buffer, "word/document.xml");
    // eslint-disable-next-line no-control-regex
    expect(doc).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(doc).toContain("Teks dari PDF ini");
  });
});

describe("template dengan entri folder di dalam ZIP", () => {
  it("tidak menghapus isi paket (kasus file hasil kosong yang ditolak Word)", async () => {
    const base = await styledTemplate();
    const src = new PizZip(base);
    const z = new PizZip();
    for (const d of ["_rels", "word", "word/_rels", "docProps"]) z.folder(d);
    for (const n of Object.keys(src.files)) if (!src.files[n].dir) z.file(n, src.file(n)!.asUint8Array());
    const tpl = new Uint8Array(z.generate({ type: "uint8array" }));
    expect(Object.keys(new PizZip(tpl).files).some((n) => n.endsWith("/"))).toBe(true);

    const a = analyzeTemplate(tpl);
    const res = await buildDocxFromTemplate(input(), tpl, a.suggested);
    const out = new PizZip(res.buffer);
    const have = Object.keys(out.files).filter((n) => !out.files[n].dir);
    for (const n of Object.keys(src.files).filter((n) => !src.files[n].dir)) expect(have).toContain(n);
    expect(res.buffer.length).toBeGreaterThan(3000);
    expect(read(res.buffer, "word/document.xml")).toContain("Persalinan adalah proses penting");
  });
});

describe("galat", () => {
  it("menolak file yang bukan docx", () => {
    expect(() => analyzeTemplate(new Uint8Array([1, 2, 3, 4]))).toThrow(/docx/i);
  });
});
