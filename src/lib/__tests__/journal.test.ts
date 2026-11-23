import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../templates";
import { buildPrompt } from "../ai";
import { analyzeSection, journalSourceFromInput, renderDataSection } from "../case";
import {
  TIDAK_DAPAT_DINILAI,
  TIDAK_DILAPORKAN,
  assessJournalText,
  findUnsupportedAuthors,
  findUnsupportedStats,
  journalDoiCheck,
  parseScope,
  scopeNote,
} from "../journal";
import { resolveSection } from "../outline";
import type { Input, Source } from "../types";

// T10: Reading Journal. Data fiktif.

const filler = "Kalimat penjelasan penelitian tentang anemia pada ibu hamil di puskesmas. ".repeat(20);
const TITLE = "Pengaruh Tablet Besi terhadap Kadar Hemoglobin Ibu Hamil";
const FULL = [TITLE, "1. PENDAHULUAN", filler, "2. METODE PENELITIAN", filler, "3. HASIL", filler, "4. PEMBAHASAN", filler, "5. KESIMPULAN", filler].join("\n");
const NO_METHOD_RESULT = [TITLE, "PENDAHULUAN", filler, filler, filler].join("\n");
const SHORT = "Abstrak singkat tentang tablet besi. ".repeat(20);

const SRC: Source = { id: "S1", type: "jurnal", title: TITLE, authors: [{ family: "Rahma", given: "Sari" }], year: "2022", content: FULL, origin: "crossref", verified: true };
const sec = (id: string) => TEMPLATES.RJ.sections.find((s) => s.id === id)!;
const SUMMARY_IDS = ["latar", "tujuan", "metode", "hasil", "pembahasan", "kesimpulan"];

describe("T10: teks parsial", () => {
  it("teks yang punya bagian-bagian utama dan cukup panjang dinilai cukup", () => {
    const a = assessJournalText(FULL);
    expect(a.level).toBe("cukup");
    expect(a.missing).toEqual([]);
    expect(a.notes).toEqual([]);
  });

  it("bagian metode dan hasil tidak ditemukan: sebagian, dan disebut apa yang hilang", () => {
    const a = assessJournalText(NO_METHOD_RESULT);
    expect(a.level).toBe("sebagian");
    expect(a.missing).toEqual(expect.arrayContaining(["metode", "hasil", "kesimpulan"]));
    expect(a.notes.join(" ")).toContain("tidak ditemukan");
  });

  it("teks pendek dinilai sebagian walau judul bagian ada", () => {
    const a = assessJournalText(["PENDAHULUAN", "METODE", "HASIL", "KESIMPULAN", SHORT].join("\n"));
    expect(a.level).toBe("sebagian");
    expect(a.notes.join(" ")).toContain("Teks pendek");
  });

  it("cakupan abstrak atau PDF terbaca sebagian selalu sebagian, walau teksnya tampak lengkap", () => {
    expect(assessJournalText(FULL, "abstrak")).toMatchObject({ level: "sebagian" });
    expect(assessJournalText(FULL, "abstrak").notes.join(" ")).toContain("abstrak");
    expect(assessJournalText(FULL, "file-sebagian").level).toBe("sebagian");
    expect(assessJournalText(FULL, "file").level).toBe("cukup");
  });

  it("cakupan tak dikenal dianggap manual; catatan identitas hanya untuk abstrak/sebagian", () => {
    expect(parseScope("aneh")).toBe("manual");
    expect(parseScope(undefined)).toBe("manual");
    expect(scopeNote("abstrak")).toContain("abstrak");
    expect(scopeNote("file-sebagian")).toContain("Sebagian");
    expect(scopeNote("file")).toBe("");
    expect(scopeNote(undefined)).toBe("");
  });

  it("tabel identitas di dokumen mencantumkan cakupan hanya bila teks tidak lengkap", () => {
    expect(renderDataSection("RJ", "identitas_jurnal", { j_title: "X", j_scope: "abstrak" })).toContain("Cakupan teks yang diringkas");
    expect(renderDataSection("RJ", "identitas_jurnal", { j_title: "X", j_scope: "file" })).not.toContain("Cakupan teks");
    expect(renderDataSection("RJ", "identitas_jurnal", { j_title: "X" })).not.toContain("Cakupan teks");
  });

  it("prompt memuat catatan cakupan untuk teks parsial dan tidak untuk teks lengkap", () => {
    const part = buildPrompt("RJ", sec("hasil"), { j_scope: "abstrak" }, [SRC]).prompt;
    expect(part).toContain("CAKUPAN TEKS");
    expect(part).toContain(TIDAK_DILAPORKAN);
    const partial2 = buildPrompt("RJ", sec("hasil"), {}, [{ ...SRC, content: NO_METHOD_RESULT }]).prompt;
    expect(partial2).toContain("CAKUPAN TEKS");
    expect(buildPrompt("RJ", sec("hasil"), {}, [SRC]).prompt).not.toContain("CAKUPAN TEKS");
  });
});

describe("T10: DOI tidak cocok dengan isi", () => {
  const base: Input = { j_title: TITLE, j_year: "2022", j_doi: "10.1234/abcd", j_origin: "crossref", j_text: FULL };
  const other = "Efektivitas Senam Yoga terhadap Nyeri Punggung Persalinan";

  it("judul Crossref yang cocok dengan teks: cocok dan terverifikasi", () => {
    expect(journalDoiCheck(base)).toBe("cocok");
    expect(journalSourceFromInput(base)?.verified).toBe(true);
  });

  it("DOI milik artikel lain: tidak cocok, dan status terverifikasi dicabut", () => {
    const bad = { ...base, j_title: other };
    expect(journalDoiCheck(bad)).toBe("tidak-cocok");
    const s = journalSourceFromInput(bad);
    expect(s?.verified).toBe(false);
    expect(s?.origin).toBe("crossref");
  });

  it("abstrak dari Crossref tidak dinilai (pasti cocok dengan dirinya sendiri) dan tetap terverifikasi", () => {
    const abs = { ...base, j_title: other, j_scope: "abstrak" };
    expect(journalDoiCheck(abs)).toBe("tidak-dapat-dinilai");
    expect(journalSourceFromInput(abs)?.verified).toBe(true);
  });

  it("metadata isian manual atau tanpa DOI/teks tidak dinilai dan tidak pernah terverifikasi", () => {
    const manual = { ...base, j_title: other, j_origin: "manual" };
    expect(journalDoiCheck(manual)).toBe("tidak-dapat-dinilai");
    expect(journalSourceFromInput(manual)?.verified).toBe(false);
    expect(journalDoiCheck({ ...base, j_doi: "" })).toBe("tidak-dapat-dinilai");
    expect(journalDoiCheck({ ...base, j_text: "" })).toBe("tidak-dapat-dinilai");
  });

  it("judul terlalu pendek untuk dinilai tidak dianggap cocok", () => {
    expect(journalDoiCheck({ ...base, j_title: "Anemia" })).toBe("tidak-dapat-dinilai");
  });
});

describe("T10: angka statistik harus dari teks jurnal", () => {
  const corpus = "Sebanyak 120 responden dilibatkan. Perbaikan 45,5% (p = 0,003). Rerata Hb 11,2 g/dL. OR 2,4 (IK 95% 1,2-4,8).";

  it("persentase satu digit ditandai (findUnsupportedAny melewatinya)", () => {
    expect(findUnsupportedStats("Perbaikan 5% pada kelompok kontrol.", corpus)).toEqual(["5"]);
  });

  it("nilai p, n, dan OR yang tidak ada di teks ditandai", () => {
    expect(findUnsupportedStats("Beda bermakna (p = 0,001).", corpus)).toEqual(["0,001"]);
    expect(findUnsupportedStats("Dengan n = 80 responden.", corpus)).toEqual(["80"]);
    expect(findUnsupportedStats("OR 7 menunjukkan risiko.", corpus)).toEqual(["7"]);
  });

  it("angka yang ada di teks lolos walau pemisah desimal berbeda", () => {
    expect(findUnsupportedStats("Perbaikan 45.5% (p = 0,003), OR 2.4, IK 95%.", corpus)).toEqual([]);
  });

  it("analisis bagian RJ menggabungkan hasil tanpa duplikat", () => {
    const w = analyzeSection("RJ", sec("hasil"), "Hasil 99% membaik, 5% memburuk.", { j_text: corpus }, []);
    expect(w.unsupportedNumbers).toEqual(["99", "5"]);
  });

  it("ringkasan yang hanya memuat angka dari teks tidak diberi peringatan", () => {
    const w = analyzeSection("RJ", sec("hasil"), "Dilibatkan 120 responden. Perbaikan 45,5% dengan p = 0,003.", { j_text: corpus }, []);
    expect(w.unsupportedNumbers).toEqual([]);
    expect(w.unsupportedNames).toBeUndefined();
  });
});

describe("T10: nama penulis tidak dikarang", () => {
  const corpus = "Penulis: Rahma, Sari. Studi ini mengutip Putri dkk. pada bagian pembahasan.";

  it("nama dengan pola et al./dkk. atau (Nama, tahun) yang tidak ada di teks ditandai", () => {
    expect(findUnsupportedAuthors("Menurut Smith et al. hasilnya baik.", corpus)).toEqual(["Smith"]);
    expect(findUnsupportedAuthors("Anemia umum (Budiman, 2019) dan (Santoso et al., 2020).", corpus).sort()).toEqual(["Budiman", "Santoso"]);
  });

  it("nama yang ada di teks lolos, juga untuk kutipan yang memang ada di artikel", () => {
    expect(findUnsupportedAuthors("Rahma dkk. melaporkan hal serupa dengan Putri et al.", corpus)).toEqual([]);
  });

  it("kalimat biasa dengan bulan dan tahun tidak disangka nama penulis", () => {
    expect(findUnsupportedAuthors("Penelitian dilakukan pada Maret 2020 di Jakarta.", corpus)).toEqual([]);
  });

  it("analisis bagian: temuan hanya ada bila ada nama asing; penulis dari metadata diperbolehkan", () => {
    const text = "Smith et al. menemukan hal serupa.";
    expect(analyzeSection("RJ", sec("pembahasan"), text, { j_text: "isi jurnal tanpa nama itu" }, []).unsupportedNames).toEqual(["Smith"]);
    const own = analyzeSection("RJ", sec("pembahasan"), "Rahma et al. melaporkan hasil ini.", { j_text: "isi jurnal" }, [SRC]);
    expect(own.unsupportedNames).toBeUndefined();
  });
});

describe("T10: ringkasan terpisah dari telaah kritis, dan 'tidak dilaporkan'", () => {
  it("template: bagian ringkasan sebelum judul telaah kritis, bagian penilaian sesudahnya dan bertanda", () => {
    const secs = TEMPLATES.RJ.sections;
    const h = secs.findIndex((s) => s.id === "telaah_kritis");
    expect(secs[h].kind).toBe("heading");
    expect(secs.filter((s) => s.appraisal).map((s) => s.id)).toEqual(["kelebihan", "kekurangan", "implikasi"]);
    for (const id of ["kelebihan", "kekurangan", "implikasi"]) expect(secs.findIndex((s) => s.id === id)).toBeGreaterThan(h);
    for (const id of SUMMARY_IDS) {
      expect(secs.findIndex((s) => s.id === id), id).toBeLessThan(h);
      expect(sec(id).appraisal, id).toBeFalsy();
    }
  });

  it("struktur dari template kampus tetap membawa tanda telaah kritis", () => {
    expect(resolveSection("RJ", { id: "o3", title: "H. Kelebihan", level: 1, role: "ai", ref: "kelebihan" }).appraisal).toBe(true);
    expect(resolveSection("RJ", { id: "o4", title: "E. Hasil", level: 1, role: "ai", ref: "hasil" }).appraisal).toBeFalsy();
  });

  it("prompt bagian ringkasan: dari teks saja, 'tidak dilaporkan', menggantikan aturan umum, tanpa menilai", () => {
    for (const id of SUMMARY_IDS) {
      const { prompt } = buildPrompt("RJ", sec(id), {}, [SRC]);
      expect(prompt, id).toContain(TIDAK_DILAPORKAN);
      expect(prompt, id).toContain("menggantikan aturan 4");
      expect(prompt, id).toContain("JENIS BAGIAN: RINGKASAN");
      expect(prompt, id).not.toContain("TELAAH KRITIS");
    }
  });

  it("prompt bagian telaah kritis: ditandai sebagai penilaian dan boleh 'tidak dapat dinilai'", () => {
    for (const id of ["kelebihan", "kekurangan", "implikasi"]) {
      const { prompt } = buildPrompt("RJ", sec(id), {}, [SRC]);
      expect(prompt, id).toContain("JENIS BAGIAN: TELAAH KRITIS");
      expect(prompt, id).toContain(TIDAK_DAPAT_DINILAI);
      expect(prompt, id).not.toContain("JENIS BAGIAN: RINGKASAN");
    }
  });

  it("instruksi bagian ringkasan di template memakai frasa yang sama", () => {
    for (const id of ["latar", "tujuan", "metode", "hasil", "pembahasan", "kesimpulan"]) {
      expect(sec(id).instruction, id).toContain(TIDAK_DILAPORKAN);
    }
  });

  it("LP dan LK tidak mendapat aturan khusus Reading Journal", () => {
    const lp = TEMPLATES.LP.sections.find((s) => s.kind === "ai")!;
    expect(buildPrompt("LP", lp, { kasus: "Anemia" }, [SRC]).prompt).not.toContain("ATURAN KHUSUS READING JOURNAL");
  });
});
