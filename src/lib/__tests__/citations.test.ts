import { describe, expect, it } from "vitest";
import {
  buildBibliography,
  citedOrder,
  extractMarkerIds,
  formatApa,
  formatVancouver,
  parseAuthors,
  renderInText,
  sanitizeMarkers,
} from "../citations";
import type { Source } from "../types";

const jurnal: Source = {
  id: "S1",
  type: "jurnal",
  title: "Efektivitas tablet besi pada ibu hamil",
  authors: [
    { family: "Rahma", given: "Siti Nur" },
    { family: "Putri", given: "Dewi" },
    { family: "Santoso", given: "Budi" },
  ],
  year: "2022",
  journal: "Jurnal Kebidanan",
  volume: "10",
  issue: "2",
  pages: "45-52",
  doi: "10.1234/jk.2022.10",
  origin: "crossref",
  verified: true,
};
const buku: Source = {
  id: "S2",
  type: "buku",
  title: "Ilmu Kebidanan",
  authors: [{ family: "Contoh", given: "Andi" }],
  year: "2020",
  publisher: "Penerbit Contoh",
  edition: "edisi ke-4",
  origin: "manual",
  verified: false,
};
const lembaga: Source = {
  id: "S3",
  type: "pedoman",
  title: "Pedoman Pelayanan Antenatal",
  authors: [{ family: "Kementerian Kesehatan RI" }],
  year: "2020",
  publisher: "Kemenkes",
  origin: "manual",
  verified: false,
};
const map = new Map([jurnal, buku, lembaga].map((s) => [s.id, s]));

describe("penanda rujukan", () => {
  it("membaca penanda tunggal dan ganda", () => {
    expect(extractMarkerIds("a [S1] b [S2, S3]. c [X9]")).toEqual(["S1", "S2", "S3"]);
  });

  it("menghapus penanda yang tidak dikenal (rujukan karangan)", () => {
    const r = sanitizeMarkers("Anemia umum terjadi [S9]. Fe membantu [S1, S7].", new Set(["S1"]));
    expect(r.text).toBe("Anemia umum terjadi. Fe membantu [S1].");
    expect(r.unknown.sort()).toEqual(["S7", "S9"]);
  });

  it("urutan kemunculan pertama dipakai untuk Vancouver", () => {
    const order = citedOrder(["x [S2]", "y [S1] [S2]"], new Set(["S1", "S2", "S3"]));
    expect(order).toEqual(["S2", "S1"]);
  });
});

describe("sitasi di teks", () => {
  const nums = new Map([["S2", 1], ["S1", 2]]);
  it("APA: penulis, tahun", () => {
    expect(renderInText("Fe penting [S1]. Dasar [S2, S3].", map, "APA", nums)).toBe(
      "Fe penting (Rahma et al., 2022). Dasar (Contoh, 2020; Kementerian Kesehatan RI, 2020)."
    );
  });
  it("Vancouver: nomor urut", () => {
    expect(renderInText("Fe penting [S1]. Dasar [S2].", map, "Vancouver", nums)).toBe("Fe penting [2]. Dasar [1].");
  });
  it("penanda tidak dikenal hilang dari keluaran", () => {
    expect(renderInText("Klaim [S8].", map, "APA", nums)).toBe("Klaim.");
  });
});

describe("daftar pustaka", () => {
  it("APA jurnal memakai inisial, miring pada nama jurnal dan volume, tautan DOI", () => {
    const segs = formatApa(jurnal);
    expect(segs.map((s) => s.t).join("")).toBe(
      "Rahma, S. N., Putri, D., & Santoso, B. (2022). Efektivitas tablet besi pada ibu hamil. Jurnal Kebidanan, 10(2), 45-52. https://doi.org/10.1234/jk.2022.10"
    );
    expect(segs.filter((s) => s.i).map((s) => s.t)).toEqual(["Jurnal Kebidanan", "10"]);
  });
  it("Vancouver jurnal", () => {
    expect(formatVancouver(jurnal).map((s) => s.t).join("")).toBe(
      "Rahma SN, Putri D, Santoso B. Efektivitas tablet besi pada ibu hamil. Jurnal Kebidanan. 2022;10(2):45-52. doi:10.1234/jk.2022.10"
    );
  });
  it("APA diurutkan alfabet, Vancouver menurut kemunculan", () => {
    const apa = buildBibliography(["S2", "S1", "S3"], map, "APA").map((e) => e.segs[0].t);
    expect(apa[0].startsWith("Contoh")).toBe(true);
    expect(apa[1].startsWith("Kementerian")).toBe(true);
    expect(apa[2].startsWith("Rahma")).toBe(true);
    const van = buildBibliography(["S2", "S1"], map, "Vancouver");
    expect(van.map((e) => e.number)).toEqual([1, 2]);
  });
  it("memecah teks penulis", () => {
    expect(parseAuthors("Rahma, Siti Nur\nBudi Santoso")).toEqual([
      { family: "Rahma", given: "Siti Nur" },
      { family: "Santoso", given: "Budi" },
    ]);
  });
});
