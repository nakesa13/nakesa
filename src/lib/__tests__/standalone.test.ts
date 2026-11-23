import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../templates";
import type { DocType } from "../types";
import { IDENTITY_IDS } from "../client";
import { checkConsistency, type DocSnap } from "../consistency";
import {
  PATIENT_FIELD_IDS,
  buildInput,
  caseDerivedInput,
  isLinked,
  linkConfirmMessage,
  linkDoc,
  reusePreview,
  unlinkDoc,
  withoutPatientFields,
  type SharedCase,
} from "../kasus";

const DOCS: DocType[] = ["LK", "LP", "RJ"];
const CASE: SharedCase = { kasus: "Anemia ringan", jenis_asuhan: "Kehamilan (ANC)" };
const snap = (type: DocType, p: Partial<DocSnap> = {}): DocSnap => ({ type, started: true, input: {}, sections: TEMPLATES[type].sections, texts: {}, sources: [], ...p });

describe("T07: tiga generator berdiri sendiri", () => {
  it("masing-masing bisa dimulai dari nol: tanpa draf lain dan tanpa kasus bersama", () => {
    for (const t of DOCS) {
      const input = buildInput(t, {}, { nama: "Siti" }, {});
      expect(Object.keys(input).sort()).toEqual([...IDENTITY_IDS].sort());
      expect(input.nama).toBe("Siti");
      expect(isLinked(t, {})).toBe(false);
    }
  });

  it("kasus bersama yang ada TIDAK dipakai dokumen yang belum dihubungkan", () => {
    const lk = buildInput("LK", { kasus: "Mandiri", jenis_asuhan: "Nifas (PNC)" }, {}, CASE);
    expect(lk.kasus).toBe("Mandiri");
    expect(lk.jenis_asuhan).toBe("Nifas (PNC)");
    expect(buildInput("LP", {}, {}, CASE).judul).toBeUndefined();
    expect(buildInput("LP", {}, {}, CASE).kasus).toBeUndefined();
    expect(buildInput("RJ", {}, {}, CASE).topik).toBeUndefined();
  });

  it("opt-in per dokumen: hanya dokumen yang dihubungkan yang mengikuti kasus", () => {
    const c = linkDoc("LK", CASE);
    expect(buildInput("LK", {}, {}, c).kasus).toBe("Anemia ringan");
    expect(buildInput("LP", {}, {}, c).kasus).toBeUndefined();
    expect(buildInput("RJ", {}, {}, c).topik).toBeUndefined();
    const c2 = linkDoc("RJ", c);
    expect(buildInput("RJ", {}, {}, c2).topik).toBe("Anemia ringan");
    expect(isLinked("LP", c2)).toBe(false);
  });

  it("tiap dokumen punya kasus sendiri tanpa saling menimpa", () => {
    const lk = buildInput("LK", { kasus: "Anemia" }, {}, {});
    const lp = buildInput("LP", { kasus: "Preeklamsia" }, {}, {});
    expect(lk.kasus).toBe("Anemia");
    expect(lp.kasus).toBe("Preeklamsia");
  });
});

describe("T07: reuse dengan konfirmasi", () => {
  it("pratinjau menyebut apa yang akan diisi atau diganti", () => {
    const items = reusePreview("LK", { kasus: "Lama" }, CASE);
    expect(items.map((i) => i.id).sort()).toEqual(["jenis_asuhan", "kasus"]);
    const kasus = items.find((i) => i.id === "kasus")!;
    expect(kasus.current).toBe("Lama");
    expect(kasus.incoming).toBe("Anemia ringan");
    const msg = linkConfirmMessage("LK", items);
    expect(msg).toContain('"Lama" akan diganti "Anemia ringan"');
    expect(msg).toContain("Jenis asuhan: akan diisi");
  });

  it("pratinjau kosong bila tidak ada yang berubah", () => {
    expect(reusePreview("LK", {}, {})).toEqual([]);
    expect(reusePreview("LK", { kasus: "Anemia ringan", jenis_asuhan: "Kehamilan (ANC)" }, CASE)).toEqual([]);
    expect(linkConfirmMessage("LK", [])).toContain("Tidak ada isian");
  });

  it("topik jurnal yang sudah diisi sendiri tidak ditimpa dan tidak masuk pratinjau", () => {
    expect(reusePreview("RJ", { topik: "ASI eksklusif" }, CASE)).toEqual([]);
    const items = reusePreview("RJ", {}, CASE);
    expect(items).toEqual([{ id: "topik", label: "Topik jurnal", current: "", incoming: "Anemia ringan" }]);
  });

  it("konfirmasi untuk Reading Journal mengingatkan agar tidak ada identitas pasien", () => {
    const msg = linkConfirmMessage("RJ", reusePreview("RJ", {}, CASE));
    expect(msg).toContain("data pasien tidak pernah dibawa");
    expect(msg).toContain("nama atau identitas pasien");
  });

  it("melepas tautan menyimpan isian yang sedang berlaku di draf", () => {
    const linked = linkDoc("LK", CASE);
    const keep = caseDerivedInput("LK", { td: "110/70 mmHg" }, linked);
    expect(keep).toMatchObject({ kasus: "Anemia ringan", jenis_asuhan: "Kehamilan (ANC)", td: "110/70 mmHg" });
    const unlinked = unlinkDoc("LK", linked);
    expect(isLinked("LK", unlinked)).toBe(false);
    // kasus bersama diubah kemudian: dokumen yang sudah lepas tidak ikut berubah
    const after = buildInput("LK", keep, {}, { ...unlinked, kasus: "Preeklamsia" });
    expect(after.kasus).toBe("Anemia ringan");
  });

  it("melepas tautan Reading Journal mempertahankan topik usulan", () => {
    const linked = linkDoc("RJ", CASE);
    const keep = caseDerivedInput("RJ", {}, linked);
    expect(keep.topik).toBe("Anemia ringan");
    expect(buildInput("RJ", keep, {}, unlinkDoc("RJ", linked)).topik).toBe("Anemia ringan");
  });
});

describe("T07: data pasien tidak masuk Reading Journal", () => {
  it("daftar kolom pasien sesuai dengan kolom di template LK (tidak melenceng)", () => {
    const lkIds = new Set(TEMPLATES.LK.steps.flatMap((s) => s.fields.map((f) => f.id)));
    for (const id of PATIENT_FIELD_IDS) expect(lkIds.has(id), id).toBe(true);
  });

  it("isian RJ tidak pernah memuat kolom pasien, walau dihubungkan dan walau draf tercemar", () => {
    const dirty = { topik: "ASI", inisial: "Ny. S", umur: "27 tahun", td: "110/70 mmHg", implementasi: "Tablet Fe" };
    const input = buildInput("RJ", dirty, { nama: "Siti" }, linkDoc("RJ", CASE));
    for (const id of PATIENT_FIELD_IDS) expect(input[id], id).toBeUndefined();
    expect(input.topik).toBe("ASI");
    expect(input.nama).toBe("Siti");
  });

  it("kasus bersama hanya membawa jenis asuhan dan diagnosis ke Reading Journal", () => {
    const input = buildInput("RJ", {}, {}, linkDoc("RJ", CASE));
    expect(Object.keys(input).sort()).toEqual([...IDENTITY_IDS, "topik"].sort());
    expect(input.jenis_asuhan).toBeUndefined();
  });

  it("withoutPatientFields hanya membuang kolom pasien", () => {
    expect(withoutPatientFields({ inisial: "Ny. S", topik: "ASI", j_title: "x" })).toEqual({ topik: "ASI", j_title: "x" });
  });
});

describe("T07: pemeriksa konsistensi untuk dokumen mandiri", () => {
  it("dokumen mandiri dengan kasus sendiri tidak diperingatkan 'kasus kosong'", () => {
    const f = checkConsistency([snap("LK", { input: { kasus: "Anemia" } })], {});
    expect(f.map((x) => x.id)).not.toContain("kasus-kosong");
  });

  it("dokumen tanpa kasus sama sekali tetap diperingatkan", () => {
    const f = checkConsistency([snap("LK", { input: { kasus: "Anemia" } }), snap("LP")], {});
    const w = f.find((x) => x.id === "kasus-kosong");
    expect(w?.docs).toEqual(["LP"]);
  });
});
