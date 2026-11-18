import { describe, expect, it } from "vitest";
import { analyzeSection, caseBlock, findUnsupportedAny, findUnsupportedNumbers, renderDataSection } from "../case";
import { RJ } from "@/templates/rj";
import { LK } from "@/templates/lk";
import type { Input, Source } from "../types";

const input: Input = {
  inisial: "Ny. S",
  umur: "27 tahun",
  keluhan_utama: "Lemas dan pusing sejak 3 hari",
  td: "110/70 mmHg",
  nadi: "82 x/menit",
  suhu: "36,5 °C",
  penunjang: "Hb 9,8 g/dL",
  implementasi: "Memberikan KIE nutrisi\nMemberikan tablet Fe",
};

describe("data klinis tidak dikarang", () => {
  it("kolom kosong ditulis [belum diisi], bukan diisi AI", () => {
    const t = renderDataSection("LK", "objektif", input);
    expect(t).toContain("| Tekanan darah | 110/70 mmHg |");
    expect(t).toContain("| Tinggi badan | [belum diisi] |");
    expect(t).toContain("**Pemeriksaan fisik**\n\n[belum diisi]");
  });
  it("implementasi diambil dari isian dan dinomori", () => {
    expect(renderDataSection("LK", "implementasi", input)).toBe("1. Memberikan KIE nutrisi\n2. Memberikan tablet Fe");
  });
  it("mendeteksi angka klinis yang tidak ada di isian", () => {
    const out = "Tekanan darah 110/70 mmHg normal, tetapi suhu 38,2 °C dan Hb 7 g/dL perlu dicermati. Nadi 82 x/menit.";
    const corpus = caseBlock("LK", input) + Object.values(input).join(" ");
    expect(findUnsupportedNumbers(out, corpus).sort()).toEqual(["38,2 °C", "7 g/dL"].sort());
  });
  it("angka yang cocok (koma/titik) tidak ditandai", () => {
    expect(findUnsupportedNumbers("Suhu 36.5 °C", "Suhu: 36,5 °C")).toEqual([]);
  });
});

describe("analisis bagian", () => {
  const src: Source[] = [{ id: "S1", type: "buku", title: "x", authors: [], year: "2020", origin: "manual", verified: false }];
  it("menandai paragraf teori tanpa rujukan dan penanda tak dikenal", () => {
    const def = LK.sections.find((s) => s.id === "teori_kasus")!;
    const long = "Anemia adalah kondisi berkurangnya kadar hemoglobin dalam darah yang sering ditemukan pada ibu hamil di Indonesia.";
    const w = analyzeSection("LK", def, `${long}\n\n${long} [S1] [S5]`, input, src);
    expect(w.uncitedParagraphs).toBe(1);
    expect(w.unknownMarkers).toEqual(["S5"]);
  });
  it("memeriksa angka hanya pada bagian khusus pasien", () => {
    const def = LK.sections.find((s) => s.id === "interpretasi")!;
    const w = analyzeSection("LK", def, "Pasien dengan Hb 6 g/dL.", input, src);
    expect(w.unsupportedNumbers).toEqual(["6 g/dL"]);
  });
});

describe("Reading Journal: angka harus dari teks jurnal", () => {
  const jurnal = "Sebanyak 120 responden dilibatkan. Kelompok intervensi 45,5% mengalami perbaikan (p = 0,003).";
  it("angka yang ada di jurnal lolos, angka asing ditandai", () => {
    const out = "Dilibatkan 120 responden [S1]. Perbaikan 45.5% dengan p = 0,003, dan 80% pada kontrol.";
    expect(findUnsupportedAny(out, jurnal)).toEqual(["80"]);
  });
  it("penomoran daftar dan penanda sumber diabaikan", () => {
    expect(findUnsupportedAny("1. Desain [S12]\n2. Sampel 120", jurnal)).toEqual([]);
  });
  it("dipakai pada bagian RJ", () => {
    const def = RJ.sections.find((s) => s.id === "hasil")!;
    const w = analyzeSection("RJ", def, "Hasil 99% membaik.", { j_text: jurnal }, []);
    expect(w.unsupportedNumbers).toEqual(["99"]);
  });
});
