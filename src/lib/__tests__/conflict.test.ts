import { describe, expect, it } from "vitest";
import {
  applyEdits,
  canKeepBoth,
  choiceEdits,
  commitDraft,
  diffSlots,
  joinBoth,
  mergeConflicts,
  previewValue,
  resolveConflicts,
  revOf,
  sameValue,
  slotValue,
  withSlot,
  type Choice,
  type Conflict,
  type DraftStorage,
} from "../conflict";
import { EMPTY_DRAFT, type Draft } from "../draft";
import type { Source } from "../types";

/**
 * T40: konflik edit antar tab. Dua "tab" memakai satu penyimpanan bersama (seperti localStorage). Tab `Tab` meniru
 * persis jalur tulis hook useGuardedDraft: base = keadaan yang terakhir dilihat tab itu, lalu commitDraft.
 * "sinkron" = tab menerima peristiwa storage dan melihat keadaan terbaru; tab yang belum sinkron = tab usang.
 */

class FakeStorage implements DraftStorage {
  writes = 0;
  constructor(public draft: Draft = EMPTY_DRAFT) {}
  // Salinan, seperti JSON.parse di localStorage: objek hasil baca tidak pernah sama referensi dengan yang lain.
  read(): Draft {
    return structuredClone(this.draft);
  }
  write(d: Draft): void {
    this.draft = structuredClone(d);
    this.writes++;
  }
}

class Tab {
  view: Draft;
  conflicts: Conflict[] = [];
  constructor(public store: FakeStorage) {
    this.view = store.read();
  }
  sync(): void {
    this.view = this.store.read();
  }
  edit(u: (d: Draft) => Draft, base?: Draft): Conflict[] {
    const b = base ?? this.view;
    const r = commitDraft(this.store, b, u(b));
    this.view = r.draft;
    this.conflicts = mergeConflicts(this.conflicts, r.conflicts);
    return r.conflicts;
  }
  setText(id: string, text: string, base?: Draft): Conflict[] {
    return this.edit((d) => ({ ...d, texts: { ...d.texts, [id]: text } }), base);
  }
  removeText(id: string): Conflict[] {
    return this.edit((d) => {
      const t = { ...d.texts };
      delete t[id];
      return { ...d, texts: t };
    });
  }
  resolve(choices: Record<string, Choice>): void {
    const r = resolveConflicts(this.store, this.conflicts, choices);
    this.view = r.draft;
    this.conflicts = r.conflicts;
  }
}

const D = (o: Partial<Draft> = {}): Draft => ({ ...EMPTY_DRAFT, ...o });
const src = (title: string): Source => ({ id: "S1", type: "jurnal", title, authors: [], year: "2020", origin: "manual", verified: false });

describe("T40: slot", () => {
  it("diffSlots: teks, isian, dan bagian utuh; step dan rev bukan isi dokumen", () => {
    const a = D({ texts: { x: "1", y: "2" }, input: { k: "v" } });
    const b = D({ texts: { x: "1b", z: "3" }, input: {}, step: 3, rev: 9 });
    const d = diffSlots(a, b);
    expect(d).toHaveLength(4);
    expect(d).toEqual(
      expect.arrayContaining([
        { slot: "texts:x", base: "1", value: "1b" },
        { slot: "texts:y", base: "2", value: undefined },
        { slot: "texts:z", base: undefined, value: "3" },
        { slot: "input:k", base: "v", value: undefined },
      ])
    );
    expect(diffSlots(D({ sources: [src("A")] }), D({ sources: [src("B")] })).map((e) => e.slot)).toEqual(["sources"]);
    // template tidak ada = null: bukan perubahan
    expect(diffSlots(D(), D({ template: null }))).toEqual([]);
  });

  it("sameValue: isi sama beda referensi = sama; tidak ada berbeda dari teks kosong", () => {
    expect(sameValue({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(sameValue("", undefined)).toBe(false);
    expect(sameValue(null, undefined)).toBe(false);
    expect(sameValue("a", "a")).toBe(true);
  });

  it("withSlot menghapus id bila nilainya undefined, dan menolak id berbahaya", () => {
    const d = D({ texts: { x: "1" } });
    expect(withSlot(d, "texts:x", undefined).texts).toEqual({});
    expect(withSlot(d, "texts:y", "2").texts).toEqual({ x: "1", y: "2" });
    expect(withSlot(d, "texts:__proto__", "x")).toBe(d);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(slotValue(D({ texts: { x: "1" } }), "texts:x")).toBe("1");
    expect(slotValue(D(), "texts:x")).toBeUndefined();
  });

  it("applyEdits: hanya yang tidak disentuh pihak lain yang tertulis", () => {
    const cur = D({ texts: { a: "A" } });
    const r = applyEdits(cur, [
      { slot: "texts:a", base: "lama", value: "saya" }, // pihak lain sudah ubah -> konflik
      { slot: "texts:b", base: undefined, value: "B" }, // tidak disentuh -> tertulis
      { slot: "texts:a", base: "A", value: "A" }, // sudah sama -> dilewati
    ]);
    expect(r.applied).toBe(1);
    expect(r.value.texts).toEqual({ a: "A", b: "B" });
    expect(r.conflicts).toEqual([{ slot: "texts:a", base: "lama", mine: "saya", theirs: "A" }]);
  });
});

describe("T40: commitDraft", () => {
  it("tanpa tulisan lain: tertulis langsung dan rev naik 1", () => {
    const s = new FakeStorage();
    const t = new Tab(s);
    expect(t.setText("x", "A")).toEqual([]);
    expect(revOf(s.draft)).toBe(1);
    expect(s.draft.texts).toEqual({ x: "A" });
    t.setText("x", "AB");
    expect(revOf(s.draft)).toBe(2);
  });

  it("tidak ada perubahan: tidak menulis dan rev tetap", () => {
    const s = new FakeStorage();
    const t = new Tab(s);
    t.edit((d) => d);
    expect(s.writes).toBe(0);
    expect(revOf(s.draft)).toBe(0);
  });

  it("perpindahan langkah tidak pernah menjadi konflik dan tidak menghapus tulisan tab lain", () => {
    const s = new FakeStorage();
    const a = new Tab(s);
    const b = new Tab(s);
    a.setText("x", "A");
    expect(b.edit((d) => ({ ...d, step: 5 }))).toEqual([]);
    expect(s.draft.step).toBe(5);
    expect(s.draft.texts).toEqual({ x: "A" });
  });
});

describe("T40: dua tab", () => {
  it("perubahan di bagian berbeda digabung; tidak ada yang hilang", () => {
    const s = new FakeStorage();
    const a = new Tab(s);
    const b = new Tab(s); // b tidak menerima peristiwa storage: usang
    a.setText("a", "A1");
    expect(b.setText("b", "B1")).toEqual([]);
    expect(s.draft.texts).toEqual({ a: "A1", b: "B1" });
    expect(revOf(s.draft)).toBe(2);
  });

  it("bagian yang sama diubah di dua tab: KONFLIK, versi tab lain tidak ditimpa, tidak ada tulisan", () => {
    const s = new FakeStorage();
    const a = new Tab(s);
    const b = new Tab(s);
    a.setText("x", "dari A");
    const writes = s.writes;
    const c = b.setText("x", "dari B");
    expect(c).toEqual([{ slot: "texts:x", base: undefined, mine: "dari B", theirs: "dari A" }]);
    expect(s.draft.texts.x).toBe("dari A");
    expect(s.writes).toBe(writes);
    expect(revOf(s.draft)).toBe(1);
  });

  it("pengguna memilih: versi saya / versi tab lain / simpan keduanya", () => {
    const run = (choice: Choice) => {
      const s = new FakeStorage();
      const a = new Tab(s);
      const b = new Tab(s);
      a.setText("x", "dari A");
      b.setText("x", "dari B");
      b.resolve({ "texts:x": choice });
      expect(b.conflicts).toEqual([]);
      return s.draft.texts.x;
    };
    expect(run("mine")).toBe("dari B");
    expect(run("theirs")).toBe("dari A");
    expect(run("both")).toBe("dari A\n\ndari B");
  });

  it("tab yang sudah sinkron menulis tanpa konflik", () => {
    const s = new FakeStorage();
    const a = new Tab(s);
    const b = new Tab(s);
    a.setText("x", "dari A");
    b.sync();
    expect(b.setText("x", "dari B setelah melihat A")).toEqual([]);
    expect(s.draft.texts.x).toBe("dari B setelah melihat A");
  });

  it("dua tab mengubah ke isi yang sama bukan konflik", () => {
    const s = new FakeStorage();
    const a = new Tab(s);
    const b = new Tab(s);
    a.setText("x", "sama");
    expect(b.setText("x", "sama")).toEqual([]);
  });

  it("menghapus di satu tab, mengubah di tab lain: konflik (penghapusan tidak membuang ubahan)", () => {
    const s = new FakeStorage(D({ texts: { x: "awal" }, rev: 1 }));
    const a = new Tab(s);
    const b = new Tab(s);
    a.setText("x", "diubah A");
    const c = b.removeText("x");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ slot: "texts:x", base: "awal", mine: undefined, theirs: "diubah A" });
    expect(s.draft.texts.x).toBe("diubah A");
    expect(previewValue(c[0].mine)).toBe("(kosong)");
  });

  it("bagian utuh (daftar sumber) yang diubah di dua tab: konflik satu slot", () => {
    const make = () => new FakeStorage(D({ sources: [src("awal")], rev: 1 }));
    const s = make();
    const a = new Tab(s);
    const b = new Tab(s);
    a.edit((d) => ({ ...d, sources: [src("dari A")] }));
    const c = b.edit((d) => ({ ...d, sources: [src("dari B")] }));
    expect(c.map((x) => x.slot)).toEqual(["sources"]);
    expect(previewValue(c[0].theirs)).toBe("1 butir");
    b.resolve({ sources: "theirs" });
    expect(s.draft.sources[0].title).toBe("dari A");

    const s2 = make();
    const a2 = new Tab(s2);
    const b2 = new Tab(s2);
    a2.edit((d) => ({ ...d, sources: [src("dari A")] }));
    b2.edit((d) => ({ ...d, sources: [src("dari B")] }));
    b2.resolve({ sources: "mine" });
    expect(s2.draft.sources[0].title).toBe("dari B");
  });

  it("memilih 'versi saya' ketika tab lain menulis lagi di bagian itu: konflik baru, tidak menimpa", () => {
    const s = new FakeStorage();
    const a = new Tab(s);
    const b = new Tab(s);
    a.setText("x", "A1");
    b.setText("x", "B1");
    a.setText("x", "A2"); // tab lain menulis lagi sebelum B memilih
    b.resolve({ "texts:x": "mine" });
    expect(s.draft.texts.x).toBe("A2");
    expect(b.conflicts).toEqual([{ slot: "texts:x", base: "A1", mine: "B1", theirs: "A2" }]);
  });

  it("'simpan keduanya' hanya berlaku bila kedua sisi teks tak kosong", () => {
    const c = (mine: unknown, theirs: unknown): Conflict => ({ slot: "texts:x", base: "b", mine, theirs });
    expect(canKeepBoth(c("a", "b"))).toBe(true);
    expect(canKeepBoth(c("", "b"))).toBe(false);
    expect(canKeepBoth(c(undefined, "b"))).toBe(false);
    expect(canKeepBoth(c([1], "b"))).toBe(false);
    expect(choiceEdits([c("", "b")], { "texts:x": "both" })).toEqual([]);
    expect(joinBoth("", "mine")).toBe("mine");
    expect(joinBoth("theirs", " ")).toBe("theirs");
  });

  it("tanpa pilihan atau 'theirs': tidak menulis apa pun", () => {
    const s = new FakeStorage();
    const a = new Tab(s);
    const b = new Tab(s);
    a.setText("x", "A");
    b.setText("x", "B");
    const writes = s.writes;
    b.resolve({});
    b.resolve({ "texts:x": "theirs" });
    expect(s.writes).toBe(writes);
    expect(s.draft.texts.x).toBe("A");
  });
});

describe("T40: hasil AI yang datang belakangan (penulisan lama, T38)", () => {
  it("bagian yang diubah selama AI menulis TIDAK ditimpa hasil AI; pengguna memilih", () => {
    const s = new FakeStorage(D({ texts: { x: "lama" }, rev: 1 }));
    const tab = new Tab(s);
    const base = tab.view; // keadaan saat penulisan dimulai
    tab.setText("x", "edit saya selama menunggu");
    const clash = tab.setText("x", "teks AI", base);
    expect(clash).toEqual([{ slot: "texts:x", base: "lama", mine: "teks AI", theirs: "edit saya selama menunggu" }]);
    expect(s.draft.texts.x).toBe("edit saya selama menunggu");
    tab.resolve({ "texts:x": "mine" });
    expect(s.draft.texts.x).toBe("teks AI");
  });

  it("tanpa perubahan selama menunggu: hasil AI tertulis, perubahan lain (bagian lain, tab lain) tetap ada", () => {
    const s = new FakeStorage(D({ texts: { x: "lama" }, rev: 1 }));
    const tab = new Tab(s);
    const other = new Tab(s);
    const base = tab.view;
    other.setText("y", "dari tab lain");
    expect(tab.setText("x", "teks AI", base)).toEqual([]);
    expect(s.draft.texts).toEqual({ x: "teks AI", y: "dari tab lain" });
  });

  it("antrean 'Tulis semua': hanya bagian yang benar-benar diubah pengguna yang bertabrakan", () => {
    const s = new FakeStorage();
    const tab = new Tab(s);
    tab.setText("o1", "AI 1", tab.view);
    const base2 = tab.view; // sebelum penulisan o2 dimulai
    tab.setText("o2", "ketikan pengguna");
    const clash = tab.setText("o2", "AI 2", base2);
    expect(clash.map((c) => c.slot)).toEqual(["texts:o2"]);
    expect(s.draft.texts).toEqual({ o1: "AI 1", o2: "ketikan pengguna" });
  });

  it("menulis ulang bagian yang tidak diubah (teks lama sama) tidak konflik", () => {
    const s = new FakeStorage(D({ texts: { x: "versi 1" }, rev: 1 }));
    const tab = new Tab(s);
    const other = new Tab(s);
    const base = tab.view;
    other.setText("y", "lain"); // rev berubah, tetapi x tidak
    expect(tab.setText("x", "versi 2", base)).toEqual([]);
    expect(s.draft.texts.x).toBe("versi 2");
  });
});

describe("T40: pembantu", () => {
  it("mergeConflicts mengganti konflik di slot yang sama dan mempertahankan base paling awal", () => {
    const a: Conflict = { slot: "texts:x", base: "b0", mine: "m1", theirs: "t1" };
    const b: Conflict = { slot: "texts:x", base: "b1", mine: "m2", theirs: "t2" };
    const c: Conflict = { slot: "texts:y", base: "b", mine: "m", theirs: "t" };
    expect(mergeConflicts([a], [b, c])).toEqual([{ slot: "texts:x", base: "b0", mine: "m2", theirs: "t2" }, c]);
  });

  it("previewValue meringkas nilai untuk dialog", () => {
    expect(previewValue(undefined)).toBe("(kosong)");
    expect(previewValue("   ")).toBe("(kosong)");
    expect(previewValue("halo")).toBe("halo");
    expect(previewValue("x".repeat(700), 10)).toBe(`${"x".repeat(10)}…`);
    expect(previewValue([])).toBe("(kosong)");
    expect(previewValue([1, 2, 3])).toBe("3 butir");
    expect(previewValue({ a: 1 })).toBe("(berubah)");
  });
});
