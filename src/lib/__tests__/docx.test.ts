import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { buildDocx, type BuildInput } from "../docx-builder";
import { inspectDocx } from "../docx-check";
import { renderDataSection } from "../case";
import type { DocSection, Source } from "../types";

// T12: isi .docx diperiksa lewat inspectDocx (pizzip + xmldom), tidak lagi bergantung pada pandoc.

const sources: Source[] = [
  {
    id: "S1",
    type: "jurnal",
    title: "Efektivitas tablet besi pada ibu hamil",
    authors: [{ family: "Rahma", given: "Siti" }, { family: "Putri", given: "Dewi" }],
    year: "2022",
    journal: "Jurnal Kebidanan",
    volume: "10",
    issue: "2",
    pages: "45-52",
    doi: "10.1234/jk.2022.10",
    origin: "crossref",
    verified: true,
  },
];

const sections: DocSection[] = [
  { id: "h1", title: "BAB I PENDAHULUAN", level: 1, kind: "heading", text: "" },
  { id: "a", title: "A. Latar Belakang", level: 2, kind: "ai", text: "Anemia sering terjadi pada kehamilan [S1].\n\n- Poin satu\n- Poin **dua**\n\n1. Langkah satu\n2. Langkah dua" },
  { id: "h2", title: "BAB III TINJAUAN KASUS", level: 1, kind: "heading", text: "" },
  { id: "b", title: "A. Data Objektif", level: 2, kind: "data", text: renderDataSection("LK", "objektif", { td: "110/70 mmHg" }) },
];

const base: BuildInput = {
  coverTitle: "LAPORAN KASUS",
  judul: "Asuhan Kebidanan Ny. S",
  identity: { nama: "Mahasiswa Uji", nim: "123", prodi: "D3 Kebidanan", kampus: "Kampus Uji", pembimbing: "", tahun: "2026" },
  sections,
  sources,
  style: "APA",
  chapterStyle: "center",
};

const errors = (r: ReturnType<typeof inspectDocx>) => r.problems.filter((p) => p.level === "error");
const xmlOf = (buf: Buffer, part: string) => new PizZip(buf).file(part)?.asText() ?? "";

describe("builder docx", () => {
  it("menghasilkan .docx valid: sitasi di teks, daftar pustaka, tanpa penanda mentah", async () => {
    const { buffer, citedCount, citedIds } = await buildDocx(base);
    expect(citedCount).toBe(1);
    expect(citedIds).toEqual(["S1"]);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");

    const r = inspectDocx(buffer, { cited: sources });
    expect(errors(r)).toEqual([]);
    expect(r.ok).toBe(true);
    const text = r.paragraphs.join("\n");
    expect(text).toContain("(Rahma & Putri, 2022)");
    expect(text).toContain("DAFTAR PUSTAKA");
    expect(text).toContain("https://doi.org/10.1234/jk.2022.10");
    expect(text).not.toContain("[S1]");
    expect(text).toContain("110/70 mmHg");
  });

  it("Vancouver: sitasi bernomor di teks dan daftar pustaka bernomor", async () => {
    const { buffer } = await buildDocx({ ...base, style: "Vancouver" });
    const r = inspectDocx(buffer, { cited: sources });
    expect(r.ok).toBe(true);
    const text = r.paragraphs.join("\n");
    expect(text).toContain("kehamilan [1].");
    expect(text).toContain("Rahma S, Putri D"); // inisial gaya Vancouver
    expect(text).not.toContain("[S1]");
  });

  it("struktur: judul bab/subbab memakai gaya Heading, A4, dan ada nomor halaman", async () => {
    const { buffer } = await buildDocx(base);
    const doc = xmlOf(buffer, "word/document.xml");
    expect((doc.match(/w:pStyle w:val="Heading1"/g) ?? []).length).toBeGreaterThanOrEqual(3); // 2 bab + daftar pustaka
    expect((doc.match(/w:pStyle w:val="Heading2"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(doc).toContain('w:w="11906"');
    expect(doc).toContain('w:h="16838"');
    expect(Object.keys(new PizZip(buffer).files).some((f) => /^word\/footer\d*\.xml$/.test(f))).toBe(true);
  });

  it("tanpa sitasi: tidak ada daftar pustaka", async () => {
    const { buffer, citedCount } = await buildDocx({ ...base, sections: sections.map((s) => ({ ...s, text: s.text.replace("[S1]", "") })) });
    expect(citedCount).toBe(0);
    const r = inspectDocx(buffer);
    expect(r.ok).toBe(true);
    expect(r.paragraphs.join("\n")).not.toContain("DAFTAR PUSTAKA");
  });

  it("penanda yang tidak dikenal dibuang, tidak menjadi sitasi atau entri pustaka", async () => {
    const { buffer, citedIds } = await buildDocx({ ...base, sections: [{ id: "a", title: "A", level: 2, kind: "ai", text: "Klaim tanpa sumber [S9]." }] });
    expect(citedIds).toEqual([]);
    const text = inspectDocx(buffer).paragraphs.join("\n");
    expect(text).toContain("Klaim tanpa sumber.");
    expect(text).not.toContain("S9");
  });

  it("karakter kontrol dari hasil tempel PDF dibuang: XML tetap sah di Word", async () => {
    const bad = "Teks\u000Cdari\u0002PDF\u0008ini";
    const { buffer } = await buildDocx({
      ...base,
      judul: `Judul ${bad}`,
      identity: { ...base.identity, nama: `Siti${bad}` },
      sections: [{ id: "a", title: `Bagian ${bad}`, level: 2, kind: "ai", text: `${bad} [S1].` }],
    });
    const r = inspectDocx(buffer, { cited: sources });
    expect(errors(r)).toEqual([]);
    expect(r.paragraphs.join("\n")).toContain("Teks dari PDF ini");
    for (const part of ["word/document.xml", "docProps/core.xml"]) {
      // eslint-disable-next-line no-control-regex
      expect(xmlOf(buffer, part), part).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    }
  });
});
