import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "../workspace/store";
import { expectCode, makeStore } from "./ws-helpers";

/**
 * T40 (penyimpanan v2): dua "tab" = dua WorkspaceStore di atas satu backend, masing-masing memegang rev dan isi yang
 * dilihatnya. Rev dokumen berperan sebagai ETag. Lihat juga conflict.test.ts untuk logika slot dan formulir v1.
 */
async function twoTabs() {
  const { backend, deps, store: a } = await makeStore();
  const b = new WorkspaceStore(backend, deps);
  await b.open();
  const ws = await a.createWorkspace({ name: "Uji konflik" });
  const doc = await a.createDocument(ws.id, { type: "LP" });
  // Kedua tab memuat dokumen yang sama (rev 1).
  const base = { rev: doc.rev, head: doc.head };
  return { a, b, id: doc.id, base };
}

describe("T40: WorkspaceStore, dua tab", () => {
  it("tulis dengan rev usang tetap ditolak (saveHead dengan expectedRev tidak berubah)", async () => {
    const { a, b, id, base } = await twoTabs();
    await a.saveHead(id, { ...base.head, texts: { x: "dari A" } });
    await expectCode(b.saveHead(id, { ...base.head, texts: { x: "dari B" } }, base.rev), "conflict");
    expect((await a.getDocument(id)).head.texts.x).toBe("dari A");
  });

  it("rev masih sama: tersimpan biasa", async () => {
    const { a, id, base } = await twoTabs();
    const r = await a.saveHeadChecked(id, { ...base.head, texts: { x: "A" } }, base);
    expect(r).toMatchObject({ saved: true, conflicts: [] });
    expect(r.doc.rev).toBe(base.rev + 1);
  });

  it("bagian berbeda digabung, tidak ada yang hilang", async () => {
    const { a, b, id, base } = await twoTabs();
    await a.saveHead(id, { ...base.head, texts: { a: "dari A" } });
    const r = await b.saveHeadChecked(id, { ...base.head, texts: { b: "dari B" } }, base);
    expect(r.saved).toBe(true);
    expect(r.conflicts).toEqual([]);
    expect(r.doc.head.texts).toEqual({ a: "dari A", b: "dari B" });
    expect(r.doc.rev).toBe(base.rev + 2);
  });

  it("bagian yang sama: konflik, tidak ada yang ditulis, versi tab lain utuh", async () => {
    const { a, b, id, base } = await twoTabs();
    const after = await a.saveHead(id, { ...base.head, texts: { x: "dari A" } });
    const r = await b.saveHeadChecked(id, { ...base.head, texts: { x: "dari B" } }, base);
    expect(r.saved).toBe(false);
    expect(r.conflicts).toEqual([{ slot: "texts:x", base: undefined, mine: "dari B", theirs: "dari A" }]);
    const now = await a.getDocument(id);
    expect(now.head.texts.x).toBe("dari A");
    expect(now.rev).toBe(after.rev);
  });

  it("konflik sebagian: yang tidak bertabrakan tetap tersimpan, yang bertabrakan dikembalikan", async () => {
    const { a, b, id, base } = await twoTabs();
    await a.saveHead(id, { ...base.head, texts: { x: "dari A" } });
    const r = await b.saveHeadChecked(id, { ...base.head, texts: { x: "dari B", y: "hanya B" } }, base);
    expect(r.saved).toBe(true);
    expect(r.conflicts.map((c) => c.slot)).toEqual(["texts:x"]);
    expect(r.doc.head.texts).toEqual({ x: "dari A", y: "hanya B" });
  });

  it("pengguna memilih: versi saya menimpa hanya setelah dipilih; versi tab lain tidak menulis apa pun", async () => {
    const { a, b, id, base } = await twoTabs();
    await a.saveHead(id, { ...base.head, texts: { x: "dari A" } });
    const { conflicts } = await b.saveHeadChecked(id, { ...base.head, texts: { x: "dari B" } }, base);

    const keepTheirs = await b.resolveHeadConflicts(id, conflicts, { "texts:x": "theirs" });
    expect(keepTheirs.doc.head.texts.x).toBe("dari A");
    expect(keepTheirs.conflicts).toEqual([]);

    const both = await b.resolveHeadConflicts(id, conflicts, { "texts:x": "both" });
    expect(both.doc.head.texts.x).toBe("dari A\n\ndari B");

    // Setelah "both" nilai berubah lagi, jadi memilih "mine" dari konflik lama menjadi konflik baru, bukan menimpa.
    const stale = await b.resolveHeadConflicts(id, conflicts, { "texts:x": "mine" });
    expect(stale.conflicts).toHaveLength(1);
    expect(stale.doc.head.texts.x).toBe("dari A\n\ndari B");
  });

  it("memilih 'versi saya' langsung setelah konflik menulis versi saya", async () => {
    const { a, b, id, base } = await twoTabs();
    await a.saveHead(id, { ...base.head, texts: { x: "dari A" } });
    const { conflicts } = await b.saveHeadChecked(id, { ...base.head, texts: { x: "dari B" } }, base);
    const r = await b.resolveHeadConflicts(id, conflicts, { "texts:x": "mine" });
    expect(r.conflicts).toEqual([]);
    expect(r.doc.head.texts.x).toBe("dari B");
  });

  it("tidak ada perubahan dan rev berbeda: tidak menulis", async () => {
    const { a, b, id, base } = await twoTabs();
    const after = await a.saveHead(id, { ...base.head, texts: { x: "dari A" } });
    const r = await b.saveHeadChecked(id, base.head, base);
    expect(r).toMatchObject({ saved: false, conflicts: [] });
    expect((await b.getDocument(id)).rev).toBe(after.rev);
  });
});
