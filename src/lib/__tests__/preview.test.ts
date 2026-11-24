import { describe, expect, it } from "vitest";
import { buildDocx, type BuildInput } from "../docx-builder";
import { inspectDocx } from "../docx-check";
import { buildPreview, runsText, type PreviewBlock } from "../preview";
import type { Source } from "../types";

// T12: model pratinjau (perkiraan). Harus memakai bahan yang sama dengan builder .docx: sitasi, urutan sumber, daftar pustaka.

const S1: Source = {
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
};
const S2: Source = { id: "S2", type: "buku", title: "Ilmu Kebidanan Dasar", authors: [{ family: "Contoh", given: "Andi" }], year: "2020", publisher: "Penerbit Contoh", origin: "manual", verified: false };

const input = (o: Partial<BuildInput> = {}): BuildInput => ({
  coverTitle: "LAPORAN KASUS",
  judul: "Asuhan Kebidanan Ny. S",
  identity: { nama: "Mahasiswa Uji", nim: "123", prodi: "D3 Kebidanan", kampus: "Kampus Uji", pembimbing: "", tahun: "2026" },
  sections: [
    { id: "h1", title: "BAB I PENDAHULUAN", level: 1, kind: "heading", text: "" },
    { id: "a", title: "A. Latar Belakang", level: 2, kind: "ai", text: "Tujuan [S2]. Anemia sering terjadi pada kehamilan [S1].\n\n**Keluhan utama**\n\n- Poin satu\n- Poin **dua**\n\n1. Langkah satu\n2. Langkah dua" },
    { id: "h2", title: "BAB III TINJAUAN KASUS", level: 1, kind: "heading", text: "" },
    { id: "b", title: "A. Data Objektif", level: 2, kind: "data", text: "| Data | Hasil |\n| TD | 110/70 mmHg |" },
  ],
  sources: [S1, S2],
  style: "APA",
  chapterStyle: "center",
  ...o,
});

const byType = <T extends PreviewBlock["t"]>(blocks: PreviewBlock[], t: T) => blocks.filter((b): b is Extract<PreviewBlock, { t: T }> => b.t === t);

describe("pratinjau: isi", () => {
  const doc = buildPreview(input());

  it("sitasi menjadi (Penulis, Tahun) dan penanda mentah hilang", () => {
    const text = byType(doc.blocks, "p").map((p) => runsText(p.runs)).join("\n");
    expect(text).toContain("(Contoh, 2020)");
    expect(text).toContain("(Rahma & Putri, 2022)");
    expect(text).not.toMatch(/\[S\d+\]/);
  });

  it("judul bab huruf besar dan di tengah, bab kedua mulai halaman baru, subbab apa adanya", () => {
    const h = byType(doc.blocks, "h");
    expect(h.map((x) => x.text)).toEqual(["BAB I PENDAHULUAN", "A. Latar Belakang", "BAB III TINJAUAN KASUS", "A. Data Objektif"]);
    expect(h.map((x) => x.center)).toEqual([true, false, true, false]);
    expect(h.map((x) => x.pageBreak)).toEqual([false, false, true, false]);
  });

  it("label tebal, daftar poin dan bernomor, serta tabel terbaca", () => {
    const p = byType(doc.blocks, "p");
    expect(p.find((x) => runsText(x.runs) === "Keluhan utama")?.label).toBe(true);
    const lists = byType(doc.blocks, "list");
    expect(lists.map((l) => [l.ordered, l.items.length])).toEqual([[false, 2], [true, 2]]);
    expect(lists[0].items[1].some((r) => r.bold && r.text === "dua")).toBe(true);
    const tables = byType(doc.blocks, "table");
    expect(tables).toHaveLength(1);
    expect(tables[0].rows.map((r) => r.map(runsText))).toEqual([["Data", "Hasil"], ["TD", "110/70 mmHg"]]);
  });

  it("sampul: judul huruf besar, identitas yang kosong tidak ditulis", () => {
    expect(doc.cover.title).toBe("LAPORAN KASUS");
    expect(doc.cover.judul).toBe("ASUHAN KEBIDANAN NY. S");
    expect(doc.cover.lines).toEqual(["Disusun oleh:", "Mahasiswa Uji", "NIM: 123"]);
    expect(doc.cover.bottom).toEqual(["PROGRAM STUDI D3 KEBIDANAN", "KAMPUS UJI", "2026"]);
    const withAdvisor = buildPreview(input({ identity: { ...input().identity, pembimbing: "Dr. Bidan" } }));
    expect(withAdvisor.cover.lines).toContain("Dosen Pembimbing:");
  });
});

describe("pratinjau: daftar pustaka", () => {
  it("APA: urut abjad, hanya sumber yang dikutip, DOI menjadi tautan", () => {
    const doc = buildPreview(input());
    expect(doc.citedIds).toEqual(["S2", "S1"]); // urutan kemunculan pertama
    expect(doc.bibliography?.heading).toBe("DAFTAR PUSTAKA");
    const entries = doc.bibliography!.entries.map((e) => e.segs.map((s) => s.t).join(""));
    expect(entries).toHaveLength(2);
    expect(entries[0].startsWith("Contoh")).toBe(true);
    expect(entries[1]).toContain("https://doi.org/10.1234/jk.2022.10");
    expect(doc.bibliography!.entries.every((e) => e.number === undefined)).toBe(true);
  });

  it("Vancouver: bernomor menurut kemunculan, sitasi [n] di teks", () => {
    const doc = buildPreview(input({ style: "Vancouver" }));
    expect(doc.bibliography!.entries.map((e) => e.number)).toEqual([1, 2]);
    const text = byType(doc.blocks, "p").map((p) => runsText(p.runs)).join("\n");
    expect(text).toContain("Tujuan [1].");
    expect(text).toContain("kehamilan [2].");
  });

  it("tanpa sitasi tidak ada daftar pustaka; penanda tak dikenal dibuang dan tidak dihitung", () => {
    const doc = buildPreview(input({ sections: [{ id: "a", title: "A", level: 2, kind: "ai", text: "Klaim [S9]." }] }));
    expect(doc.bibliography).toBeNull();
    expect(doc.citedIds).toEqual([]);
    expect(runsText((doc.blocks.find((b) => b.t === "p") as Extract<PreviewBlock, { t: "p" }>).runs)).toBe("Klaim.");
  });

  it("gaya bab 'left' (mis. Reading Journal): judul apa adanya, judul pustaka huruf kecil", () => {
    const doc = buildPreview(input({ chapterStyle: "left" }));
    const h = byType(doc.blocks, "h");
    expect(h[0].text).toBe("BAB I PENDAHULUAN"); // judul sudah huruf besar di data; yang diuji: tidak di tengah dan tanpa page break
    expect(h.every((x) => !x.center && !x.pageBreak)).toBe(true);
    expect(doc.bibliography?.heading).toBe("Daftar Pustaka");
  });
});

describe("pratinjau tidak menyimpang dari file .docx", () => {
  it("sumber yang masuk daftar pustaka sama (id dan urutan), dan tiap entri ada di berkas", async () => {
    const i = input();
    const doc = buildPreview(i);
    const built = await buildDocx(i);
    expect(doc.citedIds).toEqual(built.citedIds);
    const text = inspectDocx(built.buffer).paragraphs.join("\n");
    for (const e of doc.bibliography!.entries) expect(text).toContain(e.segs.map((s) => s.t).join("").slice(0, 30));
    // sitasi di teks sama persis
    expect(text).toContain("(Contoh, 2020)");
    expect(text).toContain("(Rahma & Putri, 2022)");
  });

  it("Vancouver: nomor di pratinjau sama dengan nomor di berkas", async () => {
    const i = input({ style: "Vancouver" });
    const text = inspectDocx((await buildDocx(i)).buffer).paragraphs.join("\n");
    expect(text).toContain("Tujuan [1].");
    expect(text).toContain("kehamilan [2].");
  });
});
