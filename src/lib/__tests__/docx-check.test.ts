import PizZip from "pizzip";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDocx, type BuildInput } from "../docx-builder";
import { inspectDocx } from "../docx-check";
import { analyzeTemplate } from "../template/analyze";
import { buildDocxFromTemplate } from "../template/build";
import type { Source } from "../types";
import { directTemplate, placeholderTemplate, styledTemplate } from "./fixtures";

// T12: pemeriksa struktur .docx hasil. Berkas rusak dibuat oleh kode (anonim, tanpa data nyata).

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const CT_OK = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const CT_TEMPLATE = CT_OK.replace("document.main+xml", "template.main+xml");

const docXml = (...paras: string[]) => `<w:document ${W}><w:body>${paras.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;

function zipOf(parts: Record<string, string>): Uint8Array {
  const z = new PizZip();
  for (const [k, v] of Object.entries(parts)) z.file(k, v);
  return new Uint8Array(z.generate({ type: "uint8array", compression: "DEFLATE" }));
}
const minimal = (body = docXml("Isi dokumen uji."), ct = CT_OK) => zipOf({ "[Content_Types].xml": ct, "word/document.xml": body });

const src = (o: Partial<Source> = {}): Source => ({
  id: "S1",
  type: "jurnal",
  title: "Efektivitas tablet besi pada ibu hamil",
  authors: [{ family: "Rahma", given: "Siti" }],
  year: "2022",
  journal: "Jurnal Kebidanan",
  origin: "manual",
  verified: false,
  ...o,
});

const codes = (r: ReturnType<typeof inspectDocx>, level?: "error" | "warning") => r.problems.filter((p) => !level || p.level === level).map((p) => p.code);

describe("T12: inspectDocx menolak berkas rusak", () => {
  it("bukan zip", () => {
    const r = inspectDocx(new Uint8Array([1, 2, 3, 4]));
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(["zip-rusak"]);
  });

  it("bagian wajib hilang", () => {
    const r = inspectDocx(zipOf({ "catatan.txt": "bukan dokumen Word" }));
    expect(r.ok).toBe(false);
    expect(codes(r, "error")).toContain("bagian-hilang");
  });

  it("jalur berkas tidak aman (path traversal) ditolak", () => {
    const r = inspectDocx(zipOf({ "[Content_Types].xml": CT_OK, "word/document.xml": docXml("x"), "../evil.xml": "x" }));
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(["zip-tidak-aman"]);
  });

  it("XML isi dokumen rusak", () => {
    const r = inspectDocx(minimal(`<w:document ${W}><w:body>`));
    expect(r.ok).toBe(false);
    expect(codes(r, "error")).toContain("xml-rusak");
  });

  it("karakter kontrol di isi (ditolak Word)", () => {
    const r = inspectDocx(minimal(docXml("Teks\u0002rusak")));
    expect(r.ok).toBe(false);
    expect(codes(r, "error")).toContain("karakter-terlarang");
  });

  it("dokumen tanpa w:body", () => {
    const r = inspectDocx(minimal(`<w:document ${W}></w:document>`));
    expect(r.ok).toBe(false);
    expect(codes(r, "error")).toContain("tanpa-isi");
  });
});

describe("T12: peringatan (tidak memblokir)", () => {
  it("jenis konten utama bukan dokumen Word -> peringatan, tetap ok", () => {
    const r = inspectDocx(minimal(docXml("Isi."), CT_TEMPLATE));
    expect(r.ok).toBe(true);
    expect(codes(r, "warning")).toEqual(["jenis-konten"]);
    expect(codes(inspectDocx(minimal()), "warning")).toEqual([]);
  });

  it("penanda rujukan mentah di teks -> peringatan, tetap ok", () => {
    const r = inspectDocx(minimal(docXml("Judul bagian [S3]")));
    expect(r.ok).toBe(true);
    expect(codes(r, "warning")).toEqual(["penanda-mentah"]);
  });
});

describe("T12: sitasi harus punya entri daftar pustaka", () => {
  it("judul sumber yang dikutip ada di dokumen (huruf besar/kecil dan spasi diabaikan) -> ok", () => {
    const r = inspectDocx(minimal(docXml("Daftar Pustaka", "RAHMA, S. (2022). EFEKTIVITAS   tablet besi pada ibu hamil. Jurnal Kebidanan.")), { cited: [src()] });
    expect(r.ok).toBe(true);
  });

  it("judul sumber yang dikutip tidak ada -> error menyebut id sumber", () => {
    const r = inspectDocx(minimal(docXml("Hanya isi biasa tanpa daftar pustaka.")), { cited: [src({ id: "S4" })] });
    expect(r.ok).toBe(false);
    expect(codes(r, "error")).toEqual(["pustaka-hilang"]);
    expect(r.problems[0].message).toContain("S4");
  });

  it("tanpa sumber yang dikutip, tidak ada pemeriksaan pustaka", () => {
    expect(inspectDocx(minimal(), { cited: [] }).ok).toBe(true);
  });
});

describe("T12: builder bawaan + pemeriksa, ujung ke ujung", () => {
  const input: BuildInput = {
    coverTitle: "LAPORAN PENDAHULUAN",
    judul: "Judul Uji",
    identity: { nama: "Mahasiswa Uji", nim: "1", prodi: "Prodi Uji", kampus: "Kampus Uji", pembimbing: "", tahun: "2026" },
    sections: [
      { id: "a", title: "A. Latar Belakang", level: 2, kind: "ai", text: "Anemia sering terjadi pada kehamilan [S1]." },
      { id: "b", title: "B. Tujuan", level: 2, kind: "ai", text: "Tujuan uji [S2]." },
    ],
    sources: [src(), src({ id: "S2", type: "buku", title: "Ilmu Kebidanan Dasar", authors: [{ family: "Contoh", given: "Andi" }], year: "2020", publisher: "Penerbit Contoh" })],
    style: "APA",
    chapterStyle: "left",
  };

  it("dua sumber dikutip, keduanya punya entri pustaka", async () => {
    const { buffer, citedIds } = await buildDocx(input);
    expect(citedIds).toEqual(["S1", "S2"]);
    expect(inspectDocx(buffer, { cited: input.sources }).ok).toBe(true);
  });

  it("entri pustaka yang dihapus dari berkas terdeteksi sebagai sitasi yatim", async () => {
    const { buffer } = await buildDocx(input);
    const z = new PizZip(buffer);
    const xml = z.file("word/document.xml")!.asText();
    expect(xml).toContain("Ilmu Kebidanan Dasar");
    z.file("word/document.xml", xml.split("Ilmu Kebidanan Dasar").join("Judul diganti"));
    const r = inspectDocx(new Uint8Array(z.generate({ type: "uint8array" })), { cited: input.sources });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.message).join(" ")).toContain("S2");
    expect(r.problems.map((p) => p.message).join(" ")).not.toContain("S1");
  });

  it("penanda [S#] di judul bagian muncul sebagai peringatan, bukan galat", async () => {
    const { buffer } = await buildDocx({ ...input, sections: [{ id: "h", title: "Bab [S1]", level: 1, kind: "heading", text: "" }] });
    const r = inspectDocx(buffer);
    expect(r.ok).toBe(true);
    expect(codes(r, "warning")).toContain("penanda-mentah");
  });
});

describe("T12: hasil dari template kampus juga diperiksa", () => {
  const SRC = src({ title: "Judul artikel uji" });
  const input: BuildInput = {
    coverTitle: "LAPORAN PENDAHULUAN",
    judul: "Asuhan Kebidanan pada Ibu Bersalin",
    identity: { nama: "Siti Aminah", nim: "2301001", prodi: "D III Kebidanan", kampus: "Poltekkes Baru", pembimbing: "Dr. Bidan, M.Keb", tahun: "2026" },
    sections: [
      { id: "a", title: "BAB I PENDAHULUAN", level: 1, kind: "heading", text: "" },
      { id: "b", title: "A. Latar Belakang", level: 2, kind: "ai", text: "Persalinan adalah proses penting [S1]." },
    ],
    sources: [SRC],
    style: "APA",
    chapterStyle: "center",
  };
  const fixtures: Record<string, Buffer> = {};
  beforeAll(async () => {
    fixtures.styledTemplate = await styledTemplate();
    fixtures.directTemplate = await directTemplate();
    fixtures.placeholderTemplate = await placeholderTemplate();
  });

  it("template bergaya, format langsung, dan berplaceholder: berkas sah dan sitasi punya pustaka", async () => {
    for (const k of ["styledTemplate", "directTemplate", "placeholderTemplate"]) {
      const tpl = new Uint8Array(fixtures[k]);
      const res = await buildDocxFromTemplate(input, tpl, analyzeTemplate(tpl).suggested);
      expect(res.citedIds, k).toEqual(["S1"]);
      const r = inspectDocx(res.buffer, { cited: [SRC] });
      expect(codes(r, "error"), k).toEqual([]);
      expect(r.paragraphs.join("\n"), k).toContain("Judul artikel uji");
    }
  });
});
