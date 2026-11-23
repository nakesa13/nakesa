import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../templates";
import type { DocType, Source } from "../types";
import { checkConsistency, hasToken, keywords, type DocSnap } from "../consistency";
import { buildInput, isSharedField, searchKeywords, sharedInput, suggestedInput, PATIENT_FIELD_IDS, type SharedCase } from "../kasus";
import { resolveSection } from "../outline";

const snap = (type: DocType, p: Partial<DocSnap> = {}): DocSnap => ({ type, started: true, input: {}, sections: TEMPLATES[type].sections, texts: {}, sources: [], ...p });
const src = (p: Partial<Source> = {}): Source => ({ id: "S1", type: "jurnal", title: "Efek tablet besi pada anemia", authors: [{ family: "Rahma", given: "Sari" }], year: "2022", journal: "Jurnal Uji", doi: "10.1234/abcd", origin: "manual", verified: false, ...p });
const ids = (f: { id: string }[]) => f.map((x) => x.id);

describe("Kasus bersama", () => {
  it("jenis asuhan dan kasus hanya untuk LP/LK yang terhubung; Jurnal tidak", () => {
    const all = { linked: { LP: true, LK: true, RJ: true } };
    expect(isSharedField("LP", "kasus", all)).toBe(true);
    expect(isSharedField("LK", "jenis_asuhan", all)).toBe(true);
    expect(isSharedField("RJ", "kasus", all)).toBe(false);
    expect(isSharedField("LK", "judul", all)).toBe(false);
    expect(isSharedField("LP", "kasus", {})).toBe(false);
    expect(sharedInput("RJ", { kasus: "x", ...all })).toEqual({});
  });

  it("kasus bersama mengalahkan isian lama di draf; kolom lain tetap", () => {
    const i = buildInput("LK", { kasus: "lama", td: "110/70 mmHg" }, {}, { kasus: "Anemia ringan", jenis_asuhan: "Kehamilan (ANC)", linked: { LK: true } });
    expect(i.kasus).toBe("Anemia ringan");
    expect(i.jenis_asuhan).toBe("Kehamilan (ANC)");
    expect(i.td).toBe("110/70 mmHg");
  });

  it("usulan judul LP dan topik Jurnal dari kasus, tetapi isian draf menang", () => {
    const c = { kasus: "Anemia", jenis_asuhan: "Kehamilan (ANC)", linked: { LP: true, LK: true, RJ: true } };
    expect(suggestedInput("LP", c).judul).toBe("Asuhan Kebidanan pada Ibu Hamil dengan Anemia");
    expect(suggestedInput("RJ", c).topik).toBe("Anemia");
    expect(suggestedInput("LK", c)).toEqual({});
    expect(buildInput("LP", { judul: "Judul saya" }, {}, c).judul).toBe("Judul saya");
    expect(buildInput("LP", {}, {}, c).judul).toContain("Ibu Hamil");
    expect(buildInput("RJ", { topik: "ASI eksklusif" }, {}, c).topik).toBe("ASI eksklusif");
  });

  it("identitas dari Pengaturan, kata kunci pencarian dari kasus", () => {
    expect(buildInput("LP", {}, { nama: "Siti" }, {}).nama).toBe("Siti");
    expect(buildInput("LP", {}, { nama: "Siti" }, {}).nim).toBe("");
    expect(searchKeywords({ kasus: "Anemia", jenis_asuhan: "Kehamilan (ANC)" })).toBe("Anemia Kehamilan");
    expect(searchKeywords({})).toBe("");
  });
});

describe("pembantu pemeriksa", () => {
  it("kata kunci mengabaikan kata umum dan kata pendek", () => {
    expect(keywords("Anemia dalam kehamilan pada ibu")).toEqual(["anemia", "kehamilan"]);
  });
  it("token dicocokkan sebagai kata utuh", () => {
    expect(hasToken("pasien ny. sari datang", "ny. s")).toBe(false);
    expect(hasToken("pasien ny. s datang", "ny. s")).toBe(true);
    expect(hasToken("td 110/70 mmhg.", "110/70 mmhg")).toBe(true);
    expect(hasToken("abc", "")).toBe(false);
  });
});

describe("pemeriksaan konsistensi", () => {
  it("tanpa dokumen yang dimulai: tidak ada temuan", () => {
    const f = checkConsistency([snap("LP", { started: false }), snap("LK", { started: false }), snap("RJ", { started: false })], { kasus: "Anemia" });
    expect(f).toEqual([]);
  });

  it("identitas berbeda antar dokumen ditandai; huruf besar/kecil diabaikan", () => {
    const base = { kasus: "Anemia" };
    const a = checkConsistency([snap("LP", { input: { nama: "Siti" }, texts: { x: "a" } }), snap("LK", { input: { nama: "Sari" }, texts: { x: "a" } })], base);
    expect(ids(a)).toContain("identitas-nama");
    const b = checkConsistency([snap("LP", { input: { nama: "Siti" } }), snap("LK", { input: { nama: "SITI" } })], base);
    expect(ids(b)).not.toContain("identitas-nama");
  });

  it("data pasien LK yang muncul di LP ditandai error; nama mirip tidak", () => {
    const lk = snap("LK", { input: { inisial: "Ny. S", td: "110/70 mmHg" } });
    const bad = checkConsistency([lk, snap("LP", { texts: { pengertian: "Ibu Ny. S dengan tekanan darah 110/70 mmHg mengalami anemia." } })], { kasus: "Anemia" });
    const f = bad.find((x) => x.id === "data-pasien-LP");
    expect(f?.severity).toBe("error");
    expect(f?.detail).toContain("110/70 mmhg");
    const ok = checkConsistency([lk, snap("LP", { texts: { pengertian: "Ny. Sari adalah contoh nama lain." } })], { kasus: "Anemia" });
    expect(ids(ok)).not.toContain("data-pasien-LP");
  });

  it("sumber yang sama dengan tahun berbeda ditandai", () => {
    const f = checkConsistency([snap("LP", { sources: [src({ year: "2020" })] }), snap("LK", { sources: [src({ year: "2021" })] })], { kasus: "Anemia" });
    const s = f.find((x) => x.id.startsWith("sumber-"));
    expect(s?.severity).toBe("warn");
    expect(s?.detail).toContain("tahun");
    const same = checkConsistency([snap("LP", { sources: [src()] }), snap("LK", { sources: [src()] })], { kasus: "Anemia" });
    expect(same.some((x) => x.id.startsWith("sumber-"))).toBe(false);
  });

  it("jurnal yang tidak menyebut kasus diberi saran", () => {
    const long = "hipertensi ".repeat(80);
    const off = checkConsistency([snap("RJ", { input: { j_title: "Hipertensi", j_text: long } })], { kasus: "Anemia dalam kehamilan" });
    expect(ids(off)).toContain("jurnal-relevan");
    const on = checkConsistency([snap("RJ", { input: { j_title: "Hipertensi", j_text: long + " anemia" } })], { kasus: "Anemia dalam kehamilan" });
    expect(ids(on)).not.toContain("jurnal-relevan");
  });

  it("langkah asuhan yang hanya ada di salah satu dokumen", () => {
    const lp = snap("LP", { sections: TEMPLATES.LP.sections.filter((s) => s.id !== "potensial") });
    const f = checkConsistency([snap("LK"), lp], { kasus: "Anemia" }).find((x) => x.id === "langkah-asuhan");
    expect(f?.severity).toBe("info");
    expect(f?.detail).toContain("Diagnosa/masalah potensial");
    expect(ids(checkConsistency([snap("LK"), snap("LP")], { kasus: "Anemia" }))).not.toContain("langkah-asuhan");
  });

  it("kelengkapan dan rujukan yang tidak dikenal; error diurutkan paling atas", () => {
    const f = checkConsistency([snap("LK"), snap("LP", { texts: { pengertian: "Anemia adalah kondisi tertentu [S9]." } })], { kasus: "Anemia" });
    expect(ids(f)).toContain("ai-kosong-LK");
    const r = f.find((x) => x.id === "rujukan-LP");
    expect(r?.severity).toBe("error");
    expect(r?.detail).toContain("S9");
    expect(f[0].severity).toBe("error");
    expect(f.map((x) => x.severity)).toEqual([...f.map((x) => x.severity)].sort((a, b) => ({ error: 0, warn: 1, info: 2 })[a] - ({ error: 0, warn: 1, info: 2 })[b]));
  });

  it("kasus bersama kosong diingatkan", () => {
    expect(ids(checkConsistency([snap("LP")], {}))).toContain("kasus-kosong");
    expect(ids(checkConsistency([snap("RJ")], {}))).not.toContain("kasus-kosong");
  });

  it("dokumen mandiri yang punya kasus sendiri tidak diingatkan 'kasus belum diisi'", () => {
    expect(ids(checkConsistency([snap("LP", { input: { kasus: "Anemia" } })], {}))).not.toContain("kasus-kosong");
  });

  it("bagian isi-sendiri yang kosong ditandai; terisi tidak", () => {
    const sections = [resolveSection("LK", { id: "o1", title: "Catatan Perkembangan", level: 2, role: "manual" })];
    expect(ids(checkConsistency([snap("LK", { sections })], { kasus: "Anemia" }))).toContain("manual-kosong-LK");
    expect(ids(checkConsistency([snap("LK", { sections, texts: { o1: "Catatan saya." } })], { kasus: "Anemia" }))).not.toContain("manual-kosong-LK");
  });
});

describe("T03: data ANC tidak bocor ke LP/Jurnal", () => {
  const serial = JSON.stringify([{ id: "m1", at: "2026-11-24T08:30", kind: "td", value: "150/100 mmHg" }]);
  const lk = snap("LK", { input: { anc_hpht: "2026-03-12", anc_uk: "28 minggu", anc_tfu: "28 cm", anc_letak: "kepala", anc_tt: "TT3", ukur_serial: serial } });
  const run = (t: DocType, text: string) => checkConsistency([lk, snap(t, { texts: { x: text } })], { kasus: "Anemia" }).find((f) => f.id === `data-pasien-${t}`);

  it("HPHT dan usia kehamilan dari LK yang muncul di LP ditandai error", () => {
    const f = run("LP", "Ibu dengan HPHT 2026-03-12 dan usia kehamilan 28 minggu mengalami anemia.");
    expect(f?.severity).toBe("error");
    expect(f?.detail).toContain("2026-03-12");
    expect(f?.detail).toContain("28 minggu");
  });

  it("hasil pengukuran serial dari LK yang muncul di LP ditandai", () => {
    expect(run("LP", "Tekanan darah 150/100 mmHg pada kunjungan itu.")?.detail).toContain("150/100 mmhg");
  });

  it("di Reading Journal tandanya peringatan (warn), bukan error", () => {
    expect(run("RJ", "Subjek penelitian memiliki HPHT 2026-03-12.")?.severity).toBe("warn");
  });

  it("kata umum (letak kepala, TT3) dan teori tanpa nilai pasien tidak ditandai", () => {
    expect(run("LP", "Letak kepala janin lazim pada trimester akhir. Imunisasi TT3 dianjurkan pada kehamilan.")).toBeUndefined();
  });
});

describe("T03: pemeriksa konsistensi bukan pemeriksa klinis", () => {
  const run = (td: string, djj: string) => checkConsistency([snap("LK", { input: { td, anc_djj: djj, anc_uk: "28 minggu", kasus: "Anemia" } })], { kasus: "Anemia" }).map((f) => `${f.id}|${f.severity}|${f.title}|${f.detail}`);

  it("nilai klinis yang ekstrem tidak mengubah temuan sama sekali dan tidak ada kata penilaian klinis", () => {
    const abnormal = run("220/140 mmHg", "60");
    expect(abnormal).toEqual(run("110/70 mmHg", "140"));
    expect(abnormal.join(" ")).not.toMatch(/normal|diagnosis (benar|salah)|berbahaya|aman|gawat|hipertensi|preeklamsia|anemia berat/i);
  });
});

describe("T03: data pasien tidak otomatis ke LP/Reading Journal", () => {
  const dirty = { kasus: "Anemia", jenis_asuhan: "Kehamilan (ANC)", linked: { LP: true, RJ: true }, inisial: "Ny. S", td: "110/70 mmHg", anc_hpht: "2026-03-12" } as unknown as SharedCase;

  it("kasus bersama hanya membawa jenis asuhan dan kasus, juga bila penyimpanan lokal disisipi kolom pasien", () => {
    expect(sharedInput("LP", dirty)).toEqual({ jenis_asuhan: "Kehamilan (ANC)", kasus: "Anemia" });
    const lp = buildInput("LP", {}, {}, dirty);
    for (const k of ["inisial", "td", "anc_hpht"]) expect(lp[k]).toBeUndefined();
    const rj = buildInput("RJ", {}, {}, dirty);
    for (const id of PATIENT_FIELD_IDS) expect(rj[id], id).toBeUndefined();
  });

  it("Reading Journal membuang kolom pasien dari draf, termasuk kolom ANC dan pengukuran serial", () => {
    const rj = buildInput("RJ", { topik: "Anemia", td: "110/70", anc_hpht: "2026-03-12", ukur_serial: "[]", inisial: "Ny. S" }, {}, {});
    expect(rj.topik).toBe("Anemia");
    for (const k of ["td", "anc_hpht", "ukur_serial", "inisial"]) expect(rj[k]).toBeUndefined();
  });

  it("dokumen yang tidak dihubungkan tidak menerima kasus bersama sama sekali", () => {
    expect(sharedInput("LP", { kasus: "Anemia", jenis_asuhan: "Kehamilan (ANC)" })).toEqual({});
    expect(buildInput("LP", {}, {}, { kasus: "Anemia", jenis_asuhan: "Kehamilan (ANC)" }).kasus).toBeUndefined();
  });
});
