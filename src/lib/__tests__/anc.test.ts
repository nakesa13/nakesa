import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../templates";
import type { Input } from "../types";
import { IDENTITY_IDS } from "../client";
import { analyzeSection, caseBlock, renderDataSection, KOSONG } from "../case";
import { buildInput, linkDoc, PATIENT_FIELD_IDS } from "../kasus";
import { visibleStepIds, buildOutline } from "../outline";
import { buildPrompt } from "../ai";
import {
  ANC_FIELDS,
  ANC_FIELD_IDS,
  MAX_MEASUREMENTS,
  SERIAL_KEY,
  addMeasurement,
  findUnsupportedDates,
  formatAt,
  parseSerial,
  removeMeasurement,
  serializeSerial,
  serialText,
  sortMeasurements,
  validTimestamp,
  type Measurement,
} from "../anc";

const LK = TEMPLATES.LK;
const ANC: Input = { jenis_asuhan: "Kehamilan (ANC)", kasus: "Anemia ringan" };
const add = (items: Measurement[], at: string, kind: string, value: string, note?: string) => {
  const r = addMeasurement(items, { at, kind, value, note });
  expect(r.error, `${at} ${kind}`).toBeUndefined();
  return r.items;
};

describe("T09: waktu pengukuran", () => {
  it("hanya tanggal dan jam yang benar-benar ada", () => {
    expect(validTimestamp("2026-11-24T08:30")).toBe(true);
    expect(validTimestamp("2028-02-29T00:00")).toBe(true);
    for (const bad of ["", "2026-11-24", "2026-11-24 08:30", "2026-02-30T08:30", "2027-02-29T08:30", "2026-13-01T08:30", "2026-11-24T24:00", "2026-11-24T08:60", "1800-01-01T00:00"]) {
      expect(validTimestamp(bad), bad).toBe(false);
    }
  });
  it("format tampilan Indonesia tanpa konversi zona", () => {
    expect(formatAt("2026-11-24T08:30")).toBe("24 November 2026 08.30");
    expect(formatAt("2026-01-05T17:05")).toBe("5 Januari 2026 17.05");
  });
});

describe("T09: pengukuran serial tidak saling menimpa", () => {
  it("dua pengukuran sejenis pada waktu yang sama tetap menjadi dua entri", () => {
    let l: Measurement[] = [];
    l = add(l, "2026-11-24T08:30", "td", "110/70");
    l = add(l, "2026-11-24T08:30", "td", "120/80");
    expect(l.map((i) => i.value)).toEqual(["110/70", "120/80"]);
    expect(new Set(l.map((i) => i.id)).size).toBe(2);
  });

  it("menambah tidak mengubah entri lama dan tidak memutasi daftar asal", () => {
    const base = add([], "2026-11-24T08:30", "td", "110/70", "duduk");
    const snapshot = JSON.stringify(base);
    const next = add(base, "2026-11-24T09:30", "nadi", "82");
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(next[0]).toEqual(base[0]);
    expect(next).toHaveLength(2);
  });

  it("diurutkan menurut waktu, waktu sama menurut urutan pencatatan", () => {
    let l: Measurement[] = [];
    l = add(l, "2026-11-24T10:00", "td", "B");
    l = add(l, "2026-11-24T08:00", "td", "A");
    l = add(l, "2026-11-24T10:00", "nadi", "C");
    expect(sortMeasurements(l).map((i) => i.value)).toEqual(["A", "B", "C"]);
  });

  it("menghapus satu entri hanya membuang entri itu", () => {
    let l: Measurement[] = [];
    l = add(l, "2026-11-24T08:00", "td", "1");
    l = add(l, "2026-11-24T08:00", "td", "2");
    const rest = removeMeasurement(l, l[0].id);
    expect(rest.map((i) => i.value)).toEqual(["2"]);
  });

  it("masukan tidak sah ditolak dan daftar lama dikembalikan apa adanya", () => {
    const base = add([], "2026-11-24T08:00", "td", "110/70");
    for (const n of [
      { at: "", kind: "td", value: "1" },
      { at: "2026-11-24T08:00", kind: "bukan-jenis", value: "1" },
      { at: "2026-11-24T08:00", kind: "td", value: "   " },
      { at: "2026-11-24T08:00", kind: "td", value: "x".repeat(41) },
    ]) {
      const r = addMeasurement(base, n);
      expect(r.error).toBeTruthy();
      expect(r.items).toBe(base);
    }
  });

  it("dibatasi jumlahnya", () => {
    let l: Measurement[] = [];
    for (let i = 0; i < MAX_MEASUREMENTS; i++) l = add(l, "2026-11-24T08:00", "td", String(i + 1));
    expect(addMeasurement(l, { at: "2026-11-24T08:00", kind: "td", value: "x" }).error).toMatch(/Batas/);
  });

  it("simpan lalu baca kembali memberi daftar yang sama", () => {
    let l: Measurement[] = [];
    l = add(l, "2026-11-24T08:00", "suhu", "36,5", "pagi");
    l = add(l, "2026-11-25T08:00", "bb", "60");
    const back = parseSerial(serializeSerial(l));
    expect(back).toEqual({ items: l, dropped: 0, corrupt: false });
    expect(serializeSerial([])).toBe("");
  });
});

describe("T09: membaca data serial yang rusak tidak membuat data dikarang", () => {
  it("kosong, bukan JSON, dan bukan daftar", () => {
    expect(parseSerial(undefined)).toEqual({ items: [], dropped: 0, corrupt: false });
    expect(parseSerial("  ")).toEqual({ items: [], dropped: 0, corrupt: false });
    expect(parseSerial("{bukan json").corrupt).toBe(true);
    expect(parseSerial('{"a":1}').corrupt).toBe(true);
  });

  it("entri tidak sah dibuang dan dihitung, entri sah tetap ada", () => {
    const raw = JSON.stringify([
      { id: "m1", at: "2026-11-24T08:00", kind: "td", value: "110/70" },
      { id: "m2", at: "2026-02-30T08:00", kind: "td", value: "1" },
      { id: "m3", at: "2026-11-24T08:00", kind: "x", value: "1" },
      { id: "m4", at: "2026-11-24T08:00", kind: "td", value: "" },
      null,
      "teks",
    ]);
    const r = parseSerial(raw);
    expect(r.items.map((i) => i.value)).toEqual(["110/70"]);
    expect(r.dropped).toBe(5);
  });

  it("id ganda atau hilang diberi id baru; tidak ada entri yang hilang", () => {
    const raw = JSON.stringify([
      { id: "m1", at: "2026-11-24T08:00", kind: "td", value: "A" },
      { id: "m1", at: "2026-11-24T09:00", kind: "td", value: "B" },
      { at: "2026-11-24T10:00", kind: "td", value: "C" },
    ]);
    const r = parseSerial(raw);
    expect(r.items.map((i) => i.value)).toEqual(["A", "B", "C"]);
    expect(new Set(r.items.map((i) => i.id)).size).toBe(3);
  });
});

describe("T09: kolom kosong = [belum diisi], bukan diisi sistem", () => {
  it("LK ANC tanpa isian ANC: semua kolom ANC dan serial tertulis [belum diisi]", () => {
    const sub = renderDataSection("LK", "subjektif", ANC);
    const obj = renderDataSection("LK", "objektif", ANC);
    for (const f of ANC_FIELDS) {
      const text = f.group === "subjektif" ? sub : obj;
      expect(text, f.label).toContain(`| ${f.label} | ${KOSONG} |`);
    }
    expect(obj).toContain(`**Pengukuran Serial**\n\n${KOSONG}`);
  });

  it("tidak menghitung TP dari HPHT dan tidak menurunkan usia kehamilan", () => {
    const sub = renderDataSection("LK", "subjektif", { ...ANC, anc_hpht: "3 Maret 2026" });
    expect(sub).toContain("| HPHT | 3 Maret 2026 |");
    expect(sub).toContain(`| Taksiran persalinan (TP) | ${KOSONG} |`);
    expect(sub).toContain(`| Usia kehamilan | ${KOSONG} |`);
  });

  it("bukan ANC dan tanpa data ANC: tidak ada blok ANC", () => {
    const sub = renderDataSection("LK", "subjektif", { jenis_asuhan: "Nifas (PNC)" });
    const obj = renderDataSection("LK", "objektif", { jenis_asuhan: "Nifas (PNC)" });
    expect(sub).not.toContain("ANC");
    expect(obj).not.toContain("Pengukuran Serial");
  });

  it("pengukuran serial tampil sebagai tabel berurutan waktu, nilai persis seperti diketik", () => {
    let l: Measurement[] = [];
    l = add(l, "2026-11-24T10:00", "td", "120/80", "setelah istirahat");
    l = add(l, "2026-11-24T08:00", "td", "110/70");
    const obj = renderDataSection("LK", "objektif", { ...ANC, [SERIAL_KEY]: serializeSerial(l) });
    const i1 = obj.indexOf("110/70");
    const i2 = obj.indexOf("120/80");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(obj).toContain("| 24 November 2026 08.00 | Tekanan darah (mmHg) | 110/70 | - |");
    expect(obj).toContain("setelah istirahat");
  });

  it("karakter | di isian tidak merusak tabel", () => {
    const sub = renderDataSection("LK", "subjektif", { ...ANC, anc_tt: "TT2 | lengkap" });
    expect(sub).toContain("| Status imunisasi TT | TT2 / lengkap |");
  });
});

describe("T09: anti-fabrication terhadap AI", () => {
  const def = LK.sections.find((s) => s.id === "interpretasi")!;
  const flagged = (text: string, input: Input) => analyzeSection("LK", def, text, input, []).unsupportedNumbers;

  it("DATA KASUS memuat kolom ANC kosong sebagai [belum diisi] dan serial sebagai teks, bukan JSON", () => {
    const empty = caseBlock("LK", ANC);
    expect(empty).toContain(`Denyut jantung janin (DJJ): ${KOSONG}`);
    expect(empty).toContain(`Pengukuran serial:\n${KOSONG}`);
    const l = add([], "2026-11-24T08:00", "td", "110/70");
    const filled = caseBlock("LK", { ...ANC, [SERIAL_KEY]: serializeSerial(l) });
    expect(filled).toContain("- 24 November 2026 08.00 | Tekanan darah: 110/70");
    expect(filled).not.toContain('"kind"');
  });

  it("prompt LK ANC membawa [belum diisi] untuk kolom kosong dan melarang menambah data pasien", () => {
    const sec = LK.sections.find((s) => s.id === "interpretasi")!;
    const { prompt } = buildPrompt("LK", sec, ANC, []);
    expect(prompt).toContain(`Tinggi fundus uteri (TFU): ${KOSONG}`);
    expect(prompt).toContain(`Taksiran persalinan (TP): ${KOSONG}`);
    expect(prompt).not.toContain(SERIAL_KEY);
  });

  it("nilai ANC yang dikarang AI saat kolom kosong ditandai", () => {
    const out = "DJJ 148 x/menit dan TFU 30 cm sesuai usia kehamilan. HPHT 3 Maret 2026, TP 10 Desember 2026.";
    const w = flagged(out, ANC);
    expect(w).toEqual(expect.arrayContaining(["148 x/menit", "30 cm", "3 Maret 2026", "10 Desember 2026"]));
  });

  it("nilai yang memang diisi mahasiswa tidak ditandai", () => {
    const input = { ...ANC, anc_djj: "140 x/menit", anc_tfu: "28 cm", anc_hpht: "3 Maret 2026" };
    expect(flagged("DJJ 140 x/menit, TFU 28 cm, HPHT 3 Maret 2026.", input)).toEqual([]);
  });

  it("nilai dan waktu pada pengukuran serial dikenali; nilai di luar daftar ditandai", () => {
    const l = add([], "2026-11-24T08:30", "td", "110/70");
    const input = { ...ANC, [SERIAL_KEY]: serializeSerial(l) };
    expect(flagged("Pada 24 November 2026 08.30 tekanan darah 110/70 mmHg.", input)).toEqual([]);
    const bad = flagged("Pada 25 November 2026 tekanan darah 150/100 mmHg.", input);
    expect(bad).toEqual(expect.arrayContaining(["150/100 mmHg", "25 November 2026"]));
  });

  it("pembaca tanggal mengenali tiga format dan menyamakannya", () => {
    expect(findUnsupportedDates("3 Maret 2026 / 03-03-2026 / 2026-03-03", "3 Maret 2026")).toEqual([]);
    expect(findUnsupportedDates("4 Maret 2026", "3 Maret 2026")).toEqual(["4 Maret 2026"]);
    expect(findUnsupportedDates("tanpa tanggal, hanya angka 2026", "")).toEqual([]);
    expect(serialText(undefined)).toBe(KOSONG);
  });
});

describe("T09: data pasien ANC tidak keluar dari LK", () => {
  it("setiap kolom LK dikelompokkan: data pasien (terdaftar) atau bukan data pasien (eksplisit)", () => {
    const NOT_PATIENT = ["judul", "jenis_asuhan", "kasus", "fokus", ...IDENTITY_IDS];
    const ids = LK.steps.flatMap((s) => s.fields.map((f) => f.id));
    for (const id of ids) expect(PATIENT_FIELD_IDS.includes(id) || NOT_PATIENT.includes(id), `kolom ${id} belum dikelompokkan`).toBe(true);
  });

  it("semua kolom ANC ada di template LK dan terdaftar sebagai data pasien", () => {
    const ids = new Set(LK.steps.flatMap((s) => s.fields.map((f) => f.id)));
    for (const id of ANC_FIELD_IDS) {
      expect(ids.has(id), id).toBe(true);
      expect(PATIENT_FIELD_IDS.includes(id), id).toBe(true);
    }
    expect(LK.steps.flatMap((s) => s.fields).find((f) => f.id === SERIAL_KEY)?.type).toBe("serial");
  });

  it("Reading Journal membuang kolom ANC dan serial walau draf tercemar", () => {
    const dirty: Input = { topik: "ASI", anc_hpht: "3 Maret 2026", anc_djj: "140 x/menit", [SERIAL_KEY]: "[]" };
    const input = buildInput("RJ", dirty, {}, linkDoc("RJ", { kasus: "Anemia" }));
    for (const id of ANC_FIELD_IDS) expect(input[id], id).toBeUndefined();
    expect(input.topik).toBe("ASI");
  });
});

describe("T09: langkah formulir", () => {
  it("langkah ANC ada di template LK dan ikut tampil bila struktur membutuhkan data pasien", () => {
    expect(LK.steps.some((s) => s.id === "anc")).toBe(true);
    const o = buildOutline("LK", [
      { block: 0, text: "BAB III TINJAUAN KASUS", level: 1 },
      { block: 1, text: "A. Data Objektif", level: 2 },
    ]);
    expect(visibleStepIds("LK", o)!.has("anc")).toBe(true);
    expect(visibleStepIds("LK", buildOutline("LK", [{ block: 0, text: "BAB I PENDAHULUAN", level: 1 }]))!.has("anc")).toBe(false);
  });
});
