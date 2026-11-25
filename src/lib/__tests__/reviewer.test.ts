import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../templates";
import type { SectionDef } from "../../templates/types";
import type { DocType, Input, Source } from "../types";
import { KOSONG } from "../case";
import { PERLU_REFERENSI } from "../lp";
import { REVIEW_NOTE, REVIEW_RULES, reviewDocument, type ReviewInput, type ReviewReport, type ReviewSection } from "../reviewer";

// T14: Academic Reviewer. Semua aturan diuji positif dan negatif; tanpa AI, tanpa jaringan.

const BASE: Input = { nama: "Mahasiswa Uji", nim: "2301", prodi: "D3 Kebidanan", kampus: "Kampus Uji", tahun: "2026", judul: "Asuhan Kebidanan Uji" };

const S = (id: string, text: string, over: Partial<SectionDef> = {}, title = `Judul ${id}`): ReviewSection => ({
  def: { id, title, level: 2, kind: "ai", guide: "", ...over },
  title,
  text,
});
const src = (o: Partial<Source> = {}): Source => ({
  id: "S1",
  type: "buku",
  title: "Ilmu Kebidanan Dasar",
  authors: [{ family: "Prawirohardjo" }],
  year: "2020",
  content: "Isi sumber yang cukup panjang. ".repeat(20),
  origin: "manual",
  verified: false,
  ...o,
});
const run = (sections: ReviewSection[], over: Partial<ReviewInput> = {}): ReviewReport => reviewDocument({ docType: "LP", sections, sources: [], input: BASE, ...over });
const by = (r: ReviewReport, ruleId: string) => r.findings.filter((f) => f.ruleId === ruleId);
const ten = (n: number, w = "kata") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

describe("T14: struktur", () => {
  it("tingkat judul melompat", () => {
    const r = run([S("a", "", { kind: "heading", level: 1 }), S("b", "", { kind: "heading", level: 3 })]);
    expect(by(r, "struktur.loncat-tingkat")).toHaveLength(1);
    expect(by(r, "struktur.loncat-tingkat")[0].location.sectionId).toBe("b");
    expect(by(run([S("a", "", { kind: "heading", level: 1 }), S("b", "", { kind: "heading", level: 2 }), S("c", "isi", { level: 3 })]), "struktur.loncat-tingkat")).toHaveLength(0);
  });

  it("judul kembar pada tingkat yang sama, bukan pada tingkat berbeda", () => {
    const r = run([S("a", "x", { level: 2 }, "A. Latar Belakang"), S("b", "y", { level: 2 }, "a. latar  belakang")]);
    expect(by(r, "struktur.judul-ganda").map((f) => f.location.sectionId)).toEqual(["b"]);
    expect(by(run([S("a", "x", { level: 1 }, "Tujuan"), S("b", "y", { level: 2 }, "Tujuan")]), "struktur.judul-ganda")).toHaveLength(0);
  });

  it("judul tanpa isi: diikuti judul setingkat atau di akhir dokumen, bukan diikuti subbab", () => {
    const bad = run([S("a", "", { kind: "heading", level: 1 }, "BAB I"), S("b", "", { kind: "heading", level: 1 }, "BAB II"), S("c", "isi", { level: 2 })]);
    expect(by(bad, "struktur.judul-tanpa-isi").map((f) => f.location.sectionId)).toEqual(["a"]);
    const end = run([S("a", "isi", { level: 2 }), S("b", "", { kind: "heading", level: 1 })]);
    expect(by(end, "struktur.judul-tanpa-isi").map((f) => f.location.sectionId)).toEqual(["b"]);
    const ok = run([S("a", "", { kind: "heading", level: 1 }, "BAB I"), S("b", "", { kind: "heading", level: 2 }, "A. X"), S("c", "isi", { level: 3 })]);
    expect(by(ok, "struktur.judul-tanpa-isi")).toHaveLength(0);
  });

  it("penomoran huruf, angka, dan BAB: loncat atau mundur ditandai; urut dan berganti induk tidak", () => {
    const skip = run([S("a", "x", {}, "A. Satu"), S("b", "x", {}, "C. Tiga")]);
    expect(by(skip, "struktur.penomoran")).toHaveLength(1);
    expect(by(skip, "struktur.penomoran")[0].reason).toContain("terlewat");
    expect(by(run([S("a", "x", {}, "A. Satu"), S("b", "x", {}, "B. Dua"), S("c", "x", {}, "C. Tiga")]), "struktur.penomoran")).toHaveLength(0);
    expect(by(run([S("a", "x", {}, "2. Dua"), S("b", "x", {}, "1. Satu")]), "struktur.penomoran")).toHaveLength(1);
    const bab = run([S("a", "", { kind: "heading", level: 1 }, "BAB I PENDAHULUAN"), S("b", "", { kind: "heading", level: 1 }, "BAB III TINJAUAN")]);
    expect(by(bab, "struktur.penomoran")).toHaveLength(1);
    // huruf di bawah induk baru mulai lagi dari A
    const reset = run([S("a", "", { kind: "heading", level: 1 }, "BAB I"), S("b", "x", {}, "A. X"), S("c", "", { kind: "heading", level: 1 }, "BAB II"), S("d", "x", {}, "A. Y")]);
    expect(by(reset, "struktur.penomoran")).toHaveLength(0);
  });
});

describe("T14: kelengkapan", () => {
  it("bagian AI atau isi-sendiri yang kosong = perlu; bagian data otomatis yang kosong tidak", () => {
    const r = run([S("a", ""), S("b", "", { kind: "data", manual: true }), S("c", "", { kind: "data" }), S("d", "isi")]);
    expect(by(r, "kelengkapan.bagian-kosong").map((f) => f.location.sectionId)).toEqual(["a", "b"]);
    expect(by(r, "kelengkapan.bagian-kosong").every((f) => f.level === "perlu")).toBe(true);
  });

  it("isian [belum diisi] dihitung dan baris pertamanya dikutip", () => {
    const table = `| Data | Ket |\n| HPHT | ${KOSONG} |\n| TP | ${KOSONG} |`;
    const f = by(run([S("a", table, { kind: "data" })]), "kelengkapan.belum-diisi");
    expect(f).toHaveLength(1);
    expect(f[0].reason).toContain("2 isian");
    expect(f[0].location.excerpt).toContain("HPHT");
    expect(by(run([S("a", "| Data | Ket |\n| HPHT | 3 Maret |", { kind: "data" })]), "kelengkapan.belum-diisi")).toHaveLength(0);
  });

  it("tanda [perlu referensi] dilaporkan dengan jumlahnya", () => {
    const t = `Paragraf teori satu yang cukup panjang. ${PERLU_REFERENSI}\n\nParagraf teori dua yang juga cukup panjang. ${PERLU_REFERENSI}`;
    const f = by(run([S("a", t)]), "kelengkapan.perlu-referensi");
    expect(f).toHaveLength(1);
    expect(f[0].reason).toContain("2 paragraf");
  });

  it("terlalu pendek: memakai 40% target kata, minimal 25 kata; bagian data tidak dinilai", () => {
    expect(by(run([S("a", ten(10), { words: 200 })]), "kelengkapan.terlalu-pendek")).toHaveLength(1);
    expect(by(run([S("a", ten(85), { words: 200 })]), "kelengkapan.terlalu-pendek")).toHaveLength(0);
    expect(by(run([S("a", ten(10))]), "kelengkapan.terlalu-pendek")).toHaveLength(1);
    expect(by(run([S("a", ten(30))]), "kelengkapan.terlalu-pendek")).toHaveLength(0);
    expect(by(run([S("a", "pendek", { kind: "data" })]), "kelengkapan.terlalu-pendek")).toHaveLength(0);
  });

  it("identitas sampul: menyebut yang kurang saja", () => {
    const f = by(run([S("a", ten(30))], { input: { ...BASE, nim: "", kampus: " " } }), "kelengkapan.identitas");
    expect(f).toHaveLength(1);
    expect(f[0].reason).toContain("NIM");
    expect(f[0].reason).toContain("kampus");
    expect(f[0].reason).not.toContain("nama,");
    expect(f[0].location).toEqual({ sectionId: null, sectionTitle: "Sampul" });
    expect(by(run([S("a", ten(30))]), "kelengkapan.identitas")).toHaveLength(0);
  });

  it("judul belum diisi: LP/LK saja", () => {
    const noTitle = { ...BASE, judul: "" };
    expect(by(run([S("a", ten(30))], { input: noTitle }), "kelengkapan.judul")).toHaveLength(1);
    expect(by(run([S("a", ten(30))], { docType: "RJ", input: noTitle }), "kelengkapan.judul")).toHaveLength(0);
    expect(by(run([S("a", ten(30))]), "kelengkapan.judul")).toHaveLength(0);
  });
});

describe("T14: bahasa", () => {
  it("spasi ganda hanya di bagian tulisan (bukan data otomatis)", () => {
    expect(by(run([S("a", "Kata  ganda di sini.")]), "bahasa.spasi-ganda")).toHaveLength(1);
    expect(by(run([S("a", "Kata ganda di sini.")]), "bahasa.spasi-ganda")).toHaveLength(0);
    expect(by(run([S("a", "Kata  ganda", { kind: "data" })]), "bahasa.spasi-ganda")).toHaveLength(0);
  });

  it("kalimat lebih dari 60 kata", () => {
    const long = `Kalimat ${ten(70)}.`;
    const f = by(run([S("a", `Awal singkat.\n\n${long}`)]), "bahasa.kalimat-panjang");
    expect(f).toHaveLength(1);
    expect(f[0].location.paragraph).toBe(2);
    expect(by(run([S("a", `Kalimat ${ten(55)}.`)]), "bahasa.kalimat-panjang")).toHaveLength(0);
  });

  it("kata berulang berurutan; kata ulang bertanda hubung tidak", () => {
    const f = by(run([S("a", "Ibu minum minum tablet besi setiap hari.")]), "bahasa.kata-berulang");
    expect(f).toHaveLength(1);
    expect(f[0].reason).toContain("minum");
    expect(by(run([S("a", "Anak-anak minum tablet besi setiap hari.")]), "bahasa.kata-berulang")).toHaveLength(0);
    expect(by(run([S("a", "Ibu minum tablet besi setiap hari.")]), "bahasa.kata-berulang")).toHaveLength(0);
  });

  it("paragraf diawali huruf kecil; satuan, daftar, dan tabel tidak ditandai", () => {
    expect(by(run([S("a", "ibu hamil mengalami anemia ringan.")]), "bahasa.huruf-kecil-awal")).toHaveLength(1);
    expect(by(run([S("a", "Ibu hamil mengalami anemia ringan.")]), "bahasa.huruf-kecil-awal")).toHaveLength(0);
    expect(by(run([S("a", "mmHg adalah satuan tekanan darah.")]), "bahasa.huruf-kecil-awal")).toHaveLength(0);
    expect(by(run([S("a", "- ibu hamil\n- bayi")]), "bahasa.huruf-kecil-awal")).toHaveLength(0);
  });

  it("paragraf panjang tanpa tanda baca akhir (mungkin terpotong); penanda sumber di ujung tidak dihitung", () => {
    const cut = `${ten(15)} dan kemudian`;
    expect(by(run([S("a", cut)]), "bahasa.tanpa-tanda-akhir")).toHaveLength(1);
    expect(by(run([S("a", `${ten(15)} selesai.`)]), "bahasa.tanpa-tanda-akhir")).toHaveLength(0);
    expect(by(run([S("a", `${ten(15)} selesai [S1].`)]), "bahasa.tanpa-tanda-akhir")).toHaveLength(0);
    expect(by(run([S("a", "Singkat saja")]), "bahasa.tanpa-tanda-akhir")).toHaveLength(0);
  });

  it("tanda baca janggal: spasi sebelum tanda baca, tanda baca ganda, tanpa spasi setelah koma atau titik", () => {
    for (const t of [
      "Ibu hamil mengalami anemia , yaitu kadar Hb rendah.",
      "Tekanan darah ibu normal .",
      "Hasil pemeriksaan normal,, tidak ada keluhan.",
      "Hasil pemeriksaan normal.. tidak ada keluhan.",
      "Ibu mendapat tablet besi,vitamin, dan kalsium.",
      "Pemeriksaan dilakukan oleh bidan.Hasilnya normal.",
    ]) {
      expect(by(run([S("a", t)]), "bahasa.tanda-baca"), t).toHaveLength(1);
    }
    const f = by(run([S("a", "Paragraf pertama sudah rapi.\n\nIbu mendapat tablet besi,vitamin, dan kalsium.")]), "bahasa.tanda-baca");
    expect(f).toHaveLength(1);
    expect(f[0].location.paragraph).toBe(2);
    expect(f[0].location.excerpt).toContain("besi,vitamin");
    expect(f[0].level).toBe("saran");
  });

  it("tanda baca yang sah tidak ditandai: angka, elipsis, kutipan langsung, URL/DOI, gelar, daftar, tabel, data otomatis", () => {
    for (const t of [
      "Kadar Hb 10,5 g/dL dan pukul 08.30 WIB tercatat normal.",
      "Pemeriksaan sesuai pedoman (WHO, 2020) berjalan lancar...",
      'Ibu berkata "tidak tahu", lalu pulang ke rumah dengan tenang.',
      "Sumber dapat dibuka di https://doi.org/10.1234/jk.2022.10, lalu dibaca.",
      "Pasien Ny.S usia 28 tahun datang dengan keluhan nyeri.",
      "Rencana asuhan: pantau tekanan darah, berikan tablet besi, dan edukasi gizi.",
      "Kehamilan trimester III... ibu tampak sehat dan tenang selama pemeriksaan.",
    ]) {
      expect(by(run([S("a", t)]), "bahasa.tanda-baca"), t).toHaveLength(0);
    }
    expect(by(run([S("a", "- ibu ,bayi\n- ayah ,ibu")]), "bahasa.tanda-baca")).toHaveLength(0);
    expect(by(run([S("a", "| Data | Ket |\n| TD ,x | 110/70 |")]), "bahasa.tanda-baca")).toHaveLength(0);
    expect(by(run([S("a", "Kata ,salah", { kind: "data" })]), "bahasa.tanda-baca")).toHaveLength(0);
  });

  it("kata tidak baku: ditandai dengan padanannya; kutipan langsung dan istilah kebidanan yang lazim tidak", () => {
    const f = by(run([S("a", "Resiko anemia tinggi dan praktek ini nggak baik. Resiko lain muncul.")]), "bahasa.tidak-baku");
    expect(f).toHaveLength(1);
    expect(f[0].reason).toContain("resiko → risiko (2×)");
    expect(f[0].reason).toContain("praktek → praktik");
    expect(by(run([S("a", 'Ibu berkata "nggak tahu" saat ditanya.')]), "bahasa.tidak-baku")).toHaveLength(0);
    // "diagnosa" dan "analisa" lazim di pedoman asuhan kebidanan (SOAP), sengaja tidak ditandai.
    expect(by(run([S("a", "Diagnosa kebidanan dan analisa data ditulis sesuai pedoman.")]), "bahasa.tidak-baku")).toHaveLength(0);
  });

  it("sudut pandang orang pertama di luar kutipan", () => {
    expect(by(run([S("a", "Saya melakukan pemeriksaan tekanan darah.")]), "bahasa.sudut-pandang")).toHaveLength(1);
    expect(by(run([S("a", 'Ibu mengeluh "saya pusing" sejak kemarin.')]), "bahasa.sudut-pandang")).toHaveLength(0);
    expect(by(run([S("a", "Penulis melakukan pemeriksaan tekanan darah.")]), "bahasa.sudut-pandang")).toHaveLength(0);
    expect(by(run([S("a", "Saya", { kind: "data" })]), "bahasa.sudut-pandang")).toHaveLength(0);
  });
});

describe("T14: sitasi", () => {
  it("penanda tanpa sumber = perlu, dengan nomor paragrafnya", () => {
    const r = run([S("a", `Paragraf pertama.\n\nTeori ini dari sumber lain [S9].`)], { sources: [src()] });
    const f = by(r, "sitasi.rujukan-yatim");
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("perlu");
    expect(f[0].location.paragraph).toBe(2);
    expect(f[0].reason).toContain("S9");
    expect(by(run([S("a", "Teori [S1].")], { sources: [src()] }), "sitasi.rujukan-yatim")).toHaveLength(0);
  });

  it("sumber tanpa isi yang dikutip = perlu; sumber berisi tidak", () => {
    const noBody = src({ content: undefined });
    expect(by(run([S("a", "Teori [S1].")], { sources: [noBody] }), "sitasi.sumber-tanpa-isi")).toHaveLength(1);
    expect(by(run([S("a", "Teori [S1].")], { sources: [src()] }), "sitasi.sumber-tanpa-isi")).toHaveLength(0);
  });

  it("paragraf teori tanpa rujukan hanya dinilai bila ada sumber berisi", () => {
    const para = `${ten(20)} adalah penjelasan teori yang cukup panjang.`;
    const theory = { needsCitation: true };
    expect(by(run([S("a", para, theory)], { sources: [src()] }), "sitasi.paragraf-tanpa-rujukan")).toHaveLength(1);
    expect(by(run([S("a", `${para} [S1]`, theory)], { sources: [src()] }), "sitasi.paragraf-tanpa-rujukan")).toHaveLength(0);
    expect(by(run([S("a", `${para} ${PERLU_REFERENSI}`, theory)], { sources: [src()] }), "sitasi.paragraf-tanpa-rujukan")).toHaveLength(0);
    expect(by(run([S("a", para, theory)], { sources: [] }), "sitasi.paragraf-tanpa-rujukan")).toHaveLength(0);
    expect(by(run([S("a", para)], { sources: [src()] }), "sitasi.paragraf-tanpa-rujukan")).toHaveLength(0);
  });

  it("bagian teori tanpa satu pun sumber berisi (bukan untuk Reading Journal)", () => {
    const theory = S("a", ten(30), { needsCitation: true });
    expect(by(run([theory]), "sitasi.tanpa-sumber")).toHaveLength(1);
    expect(by(run([theory], { sources: [src({ content: "pendek" })] }), "sitasi.tanpa-sumber")).toHaveLength(1);
    expect(by(run([theory], { sources: [src()] }), "sitasi.tanpa-sumber")).toHaveLength(0);
    expect(by(run([theory], { docType: "RJ" }), "sitasi.tanpa-sumber")).toHaveLength(0);
  });

  it("sumber yang tidak dirujuk satu pun: dikelompokkan, bukan untuk Reading Journal", () => {
    const r = run([S("a", "Teori [S1].")], { sources: [src(), src({ id: "S2", title: "Buku Lain" }), src({ id: "S3", title: "Buku Ketiga" })] });
    const f = by(r, "sitasi.sumber-tidak-dikutip");
    expect(f).toHaveLength(1);
    expect(f[0].reason).toContain("S2");
    expect(f[0].reason).toContain("S3");
    expect(f[0].reason).not.toContain("S1,");
    expect(by(run([S("a", "isi")], { docType: "RJ", sources: [src()] }), "sitasi.sumber-tidak-dikutip")).toHaveLength(0);
  });

  it("sumber ganda menurut DOI atau judul+tahun+penulis", () => {
    const a = src({ id: "S1", doi: "10.1234/abc" });
    const b = src({ id: "S2", title: "Judul Lain", doi: "https://doi.org/10.1234/ABC" });
    expect(by(run([S("a", "x [S1] [S2]")], { sources: [a, b] }), "sitasi.sumber-ganda")).toHaveLength(1);
    expect(by(run([S("a", "x [S1] [S2]")], { sources: [a, src({ id: "S2", title: "Judul Lain" })] }), "sitasi.sumber-ganda")).toHaveLength(0);
  });

  it("metadata sumber yang dikutip: tahun atau penulis kosong", () => {
    const noYear = src({ year: "" });
    const f = by(run([S("a", "Teori [S1].")], { sources: [noYear] }), "sitasi.metadata-kurang");
    expect(f).toHaveLength(1);
    expect(f[0].reason).toContain("n.d.");
    expect(by(run([S("a", "Teori [S1].")], { sources: [src({ authors: [] })] }), "sitasi.metadata-kurang")[0].reason).toContain("penulis kosong");
    expect(by(run([S("a", "Teori [S1].")], { sources: [src()] }), "sitasi.metadata-kurang")).toHaveLength(0);
    // tidak dikutip -> tidak diperiksa di sini
    expect(by(run([S("a", "Teori.")], { sources: [noYear] }), "sitasi.metadata-kurang")).toHaveLength(0);
  });

  it("sitasi gaya APA yang diketik tangan", () => {
    for (const t of ["Anemia sering terjadi (Rahma, 2022) pada ibu hamil.", "Menurut pedoman (WHO, 2020) hal ini penting.", "Dua penulis (Rahma & Putri, 2022) menyatakan itu.", "Banyak penulis (Rahma et al., 2022) setuju."]) {
      expect(by(run([S("a", t)]), "sitasi.manual"), t).toHaveLength(1);
    }
    for (const t of ["Hasil terlihat pada (lihat tabel 2) berikut.", "Penanda otomatis dipakai [S1].", "Tekanan darah (110/70, 2022) tercatat."]) {
      expect(by(run([S("a", t)], { sources: [src()] }), "sitasi.manual"), t).toHaveLength(0);
    }
    expect(by(run([S("a", "Data (Rahma, 2022)", { kind: "data" })]), "sitasi.manual")).toHaveLength(0);
  });
});

describe("T14: batas peninjau (tanpa skor, tanpa label kelayakan, tanpa perbaikan otomatis)", () => {
  const messy: ReviewSection[] = [
    S("h1", "", { kind: "heading", level: 1 }, "BAB I"),
    S("h2", "", { kind: "heading", level: 3 }, "BAB III"),
    S("a", "ibu  minum minum resiko nggak jelas dan saya setuju [S9] (Rahma, 2022)", { needsCitation: true }, "A. Satu"),
    S("b", "", {}, "C. Tiga"),
    S("c", `| Data | Ket |\n| HPHT | ${KOSONG} |`, { kind: "data" }, "Data"),
  ];
  const report = run(messy, { input: { judul: "" }, sources: [src({ id: "S2", year: "" })] });

  it("hanya berisi temuan, hitungan per kategori, daftar aturan, dan catatan", () => {
    expect(Object.keys(report).sort()).toEqual(["counts", "findings", "note", "rulesChecked"]);
    expect(report.note).toBe(REVIEW_NOTE);
    expect(Object.keys(report.counts).sort()).toEqual(["bahasa", "kelengkapan", "sitasi", "struktur"]);
    expect(Object.values(report.counts).reduce((a, b) => a + b, 0)).toBe(report.findings.length);
    expect(report.rulesChecked).toEqual(REVIEW_RULES.map((r) => r.id));
  });

  it("dokumen berantakan menghasilkan temuan di keempat kategori", () => {
    for (const c of ["struktur", "kelengkapan", "bahasa", "sitasi"] as const) expect(report.counts[c], c).toBeGreaterThan(0);
  });

  it("setiap temuan punya lokasi, alasan, saran, dan id aturan yang terdaftar", () => {
    expect(report.findings.length).toBeGreaterThan(8);
    const rules = new Map(REVIEW_RULES.map((r) => [r.id, r.category]));
    for (const f of report.findings) {
      expect(rules.get(f.ruleId), f.ruleId).toBe(f.category);
      expect(f.location.sectionTitle.trim(), f.ruleId).not.toBe("");
      expect(f.reason.trim().length, f.ruleId).toBeGreaterThan(10);
      expect(f.suggestion.trim().length, f.ruleId).toBeGreaterThan(10);
      expect(["perlu", "saran"], f.ruleId).toContain(f.level);
      if (f.location.excerpt) expect(f.location.excerpt.length).toBeLessThanOrEqual(90);
    }
  });

  it("tidak ada skor, label kelayakan, atau kata penilaian di keluaran", () => {
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/layak|lulus|skor|score|sempurna|nilai akhir/i);
    for (const f of report.findings) expect(Object.keys(f).sort()).toEqual(["category", "level", "location", "reason", "ruleId", "suggestion"]);
  });

  it("murni: tidak mengubah masukan dan hasilnya sama untuk masukan yang sama", () => {
    const freeze = <T,>(o: T): T => {
      if (o && typeof o === "object") for (const v of Object.values(o)) freeze(v);
      return Object.freeze(o) as T;
    };
    const input: ReviewInput = freeze({ docType: "LP" as DocType, sections: structuredClone(messy), sources: [src({ id: "S2", year: "" })], input: { judul: "" } });
    const a = reviewDocument(input);
    const b = reviewDocument(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(report));
  });

  it("dokumen yang rapi tidak menghasilkan temuan sama sekali", () => {
    const good =
      "Anemia pada kehamilan ditandai dengan kadar hemoglobin yang lebih rendah dari batas normal untuk usia kehamilan tertentu [S1]. Kondisi ini dapat meningkatkan risiko perdarahan saat persalinan dan melahirkan bayi dengan berat badan lahir rendah [S1]. Pemeriksaan kadar hemoglobin secara berkala membantu bidan mendeteksi masalah lebih awal [S1].";
    const r = run(
      [S("h1", "", { kind: "heading", level: 1 }, "BAB I PENDAHULUAN"), S("a", good, { needsCitation: true, words: 60 }, "A. Latar Belakang"), S("b", good, { needsCitation: true, words: 60 }, "B. Tujuan")],
      { sources: [src()] }
    );
    expect(r.findings).toEqual([]);
    expect(r.counts).toEqual({ struktur: 0, kelengkapan: 0, bahasa: 0, sitasi: 0 });
  });
});

describe("T14: ketahanan terhadap teks patologis (berjalan di peramban mahasiswa, jangan sampai tab macet)", () => {
  const timed = (text: string): number => {
    const t0 = Date.now();
    run([S("a", text)], { sources: [src()] });
    return Date.now() - t0;
  };

  it("200 ribu huruf tanpa spasi selesai cepat (dulu kuadratik: ~23 detik)", () => {
    expect(timed("a".repeat(200_000))).toBeLessThanOrEqual(2000);
  });

  it("bentuk patologis lain tetap cepat", () => {
    for (const t of ["a ".repeat(60_000), "(A, 2020) ".repeat(10_000), "Aa. ".repeat(30_000), ", ".repeat(60_000), `"${"x ".repeat(60_000)}`, " ".repeat(100_000) + "x", `https://${"a".repeat(100_000)}`]) {
      expect(timed(t), t.slice(0, 20)).toBeLessThanOrEqual(2000);
    }
  });

  it("deteksi 'tidak ada spasi setelah titik' tetap bekerja setelah pola dibatasi", () => {
    expect(by(run([S("a", "Pemeriksaan dilakukan oleh bidan.Hasilnya normal.")]), "bahasa.tanda-baca")).toHaveLength(1);
    expect(by(run([S("a", "Pemeriksaan dilakukan oleh bidan. Hasilnya normal.")]), "bahasa.tanda-baca")).toHaveLength(0);
  });
});

describe("T14: templat bawaan", () => {
  it.each(["LP", "LK", "RJ"] as const)("%s: seluruh bagian kosong tidak menimbulkan galat dan tiap bagian AI/isi-sendiri dilaporkan kosong", (t) => {
    const defs = TEMPLATES[t].sections;
    const r = reviewDocument({ docType: t, sections: defs.map((d) => ({ def: d, title: d.title, text: "" })), sources: [], input: {} });
    const expected = defs.filter((d) => d.kind !== "heading" && (d.kind === "ai" || d.manual)).length;
    expect(by(r, "kelengkapan.bagian-kosong")).toHaveLength(expected);
    expect(expected).toBeGreaterThan(0);
  });
});
