import { describe, expect, it } from "vitest";
import { lpTitleFor } from "../kasus";
import type { OutlineItem } from "../outline";
import { parseSources } from "../guard";
import type { Provenance } from "../types";
import type { Analysis, Mapping } from "../template/types";
import { MemoryBackend, STORE_NAMES } from "../workspace/backend";
import { sha256Hex } from "../workspace/hash";
import { WorkspaceStore, emptyHead } from "../workspace/store";
import { StoreError, type SourceDraft, type VersionRec } from "../workspace/types";
import { buf, expectCode, makeStore, src, testDeps } from "./ws-helpers";

/**
 * T06: aturan penyimpanan lokal v2 (ADR T05) diuji dengan MemoryBackend: CRUD, arsip/hapus dengan konfirmasi,
 * tautan/lepas tautan, versi, kunci optimis, dan invarian lintas ruang kerja. Tanpa IndexedDB dan tanpa jaringan.
 */

const OUTLINE: OutlineItem[] = [{ id: "o1", title: "BAB I PENDAHULUAN", level: 1, role: "manual" }];
const TEMPLATE = (data = buf([1, 2, 3])) => ({ docType: "LP" as const, name: "kampus.docx", size: data.byteLength, data, analysis: {} as Analysis, mapping: { a: 1 } as unknown as Mapping });

describe("ruang kerja", () => {
  it("satu ruang kerja bawaan dibuat sekali; dokumen bisa langsung dibuat tanpa kasus, sumber, atau template (I1)", async () => {
    const { store } = await makeStore();
    const a = await store.ensureDefaultWorkspace();
    const b = await store.ensureDefaultWorkspace();
    expect(a.name).toBe("Ruang kerja saya");
    expect(b.id).toBe(a.id);
    expect(await store.listWorkspaces()).toHaveLength(1);
    expect(a).toMatchObject({ ownerId: "local", rev: 1, citeStyle: "APA" });

    for (const type of ["LP", "LK", "RJ"] as const) {
      const d = await store.createDocument(a.id, { type });
      expect(d).toMatchObject({ type, caseId: null, templateId: null, citeSeq: 0, head: emptyHead() });
      const r = await store.resolveForGeneration(d.id);
      expect(r.caseRec).toBeNull();
      expect(r.template).toBeNull();
      expect(r.sources).toEqual([]);
    }
  });

  it("ubah, validasi, dan kunci optimis (rev)", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const u = await store.updateWorkspace(w.id, { name: "  B  ", citeStyle: "Vancouver" });
    expect(u).toMatchObject({ name: "B", citeStyle: "Vancouver", rev: 2 });
    await expectCode(store.updateWorkspace(w.id, { name: "C" }, 1), "conflict");
    expect((await store.getWorkspace(w.id)).name).toBe("B");
    await expectCode(store.createWorkspace({ name: "   " }), "invalid");
    await expectCode(store.createWorkspace({ name: "x".repeat(121) }), "invalid");
    await expectCode(store.getWorkspace("tidak-ada"), "not-found");
  });

  it("arsip menyembunyikan tanpa menghapus, dan ruang kerja arsip tidak menerima dokumen baru", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    await store.archiveWorkspace(w.id);
    expect(await store.listWorkspaces()).toHaveLength(0);
    expect(await store.listWorkspaces({ includeArchived: true })).toHaveLength(1);
    await expectCode(store.createDocument(w.id, { type: "LP" }), "invalid");
    const back = await store.archiveWorkspace(w.id, false);
    expect(back.archivedAt).toBeUndefined();
    expect(await store.listWorkspaces()).toHaveLength(1);
    await store.createDocument(w.id, { type: "LP" });
  });

  it("hapus permanen butuh nama persis, lalu menghapus seluruh isinya saja", async () => {
    const { store, backend } = await makeStore();
    const a = await store.createWorkspace({ name: "Praktik ANC" });
    const b = await store.createWorkspace({ name: "Lain" });
    const doc = await store.createDocument(a.id, { type: "LK" });
    await store.createVersion(doc.id);
    await store.createSource(a.id, src());
    await store.putTemplate(a.id, TEMPLATE());
    await store.createCase(a.id, { kasus: "Anemia" });
    await store.createDocument(b.id, { type: "LP" });
    await store.createSource(b.id, src({ title: "Milik B" }));

    await expectCode(store.removeWorkspace(a.id, { name: "praktik anc" }), "confirm");
    await expectCode(store.removeWorkspace(a.id, { name: "" }), "confirm");
    expect(await store.listDocuments(a.id)).toHaveLength(1);

    const r = await store.removeWorkspace(a.id, { name: " Praktik ANC " });
    expect(r.deleted).toEqual({ cases: 1, documents: 1, versions: 1, sources: 1, templates: 1 });
    await expectCode(store.getWorkspace(a.id), "not-found");
    expect(await store.listDocuments(b.id)).toHaveLength(1);
    expect(await store.listSources(b.id)).toHaveLength(1);
    expect(await backend.getAll("versions")).toEqual([]);
  });
});

describe("dokumen", () => {
  it("banyak dokumen satu jenis; judul bawaan; ubah nama; arsip; hapus butuh konfirmasi dan menghapus Version-nya", async () => {
    const { store, backend } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const a = await store.createDocument(w.id, { type: "LK" });
    const b = await store.createDocument(w.id, { type: "LK", title: "  LK pasien kedua  " });
    expect(a.title).toBe("Laporan Kasus");
    expect(b.title).toBe("LK pasien kedua");
    expect(await store.listDocuments(w.id, { type: "LK" })).toHaveLength(2);

    expect((await store.renameDocument(a.id, "LK Ny. A")).title).toBe("LK Ny. A");
    await expectCode(store.renameDocument(a.id, "  "), "invalid");

    await store.archiveDocument(a.id);
    expect((await store.listDocuments(w.id)).map((d) => d.id)).toEqual([b.id]);
    expect(await store.listDocuments(w.id, { includeArchived: true })).toHaveLength(2);

    await store.createVersion(b.id);
    await store.createVersion(b.id);
    await expectCode(store.removeDocument(b.id, {}), "confirm");
    await expectCode(store.removeDocument(b.id, { confirmed: false }), "confirm");
    expect(await store.getDocument(b.id)).toBeTruthy();
    expect(await store.removeDocument(b.id, { confirmed: true })).toEqual({ versionsDeleted: 2 });
    expect(await backend.getAll("versions")).toEqual([]);
    await expectCode(store.getDocument(b.id), "not-found");
  });

  it("generator saling tidak bergantung: mengubah satu dokumen tidak mengubah isian efektif dokumen lain (I3)", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const lp = await store.createDocument(w.id, { type: "LP" });
    const lk = await store.createDocument(w.id, { type: "LK" });
    await store.saveHead(lp.id, { ...emptyHead(), input: { tujuan: "memahami" } });
    const before = (await store.resolveForGeneration(lp.id)).input;
    await store.saveHead(lk.id, { ...emptyHead(), input: { kasus: "Anemia", td: "110/70 mmHg" } });
    expect((await store.resolveForGeneration(lp.id)).input).toEqual(before);
  });

  it("seluruh rekaman milik pemilik lokal", async () => {
    const { store, backend } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LP" });
    await store.createCase(w.id, { kasus: "x" });
    await store.createSource(w.id, src());
    await store.putTemplate(w.id, TEMPLATE());
    await store.createVersion(d.id);
    for (const s of STORE_NAMES.filter((n) => n !== "meta")) {
      for (const r of await backend.getAll<{ ownerId: string }>(s)) expect(r.ownerId, s).toBe("local");
    }
  });
});

describe("saveHead dan rujukan sumber", () => {
  it("menyimpan dan membaca kembali; rev basi ditolak; tulis bersamaan: satu menang, satu konflik", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LK" });
    const saved = await store.saveHead(d.id, { ...emptyHead(), input: { kasus: "A" }, texts: { x: "a" }, step: 2 }, d.rev);
    expect(saved.rev).toBe(2);
    expect((await store.getDocument(d.id)).head).toMatchObject({ input: { kasus: "A" }, texts: { x: "a" }, step: 2 });
    await expectCode(store.saveHead(d.id, emptyHead(), d.rev), "conflict");

    const res = await Promise.allSettled([
      store.saveHead(d.id, { ...emptyHead(), input: { kasus: "B" } }, saved.rev),
      store.saveHead(d.id, { ...emptyHead(), input: { kasus: "C" } }, saved.rev),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as StoreError).code).toBe("conflict");
  });

  it("isi yang bukan teks atau bentuk salah ditolak", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LK" });
    const bad = (h: unknown) => store.saveHead(d.id, h as ReturnType<typeof emptyHead>);
    await expectCode(bad({ ...emptyHead(), input: { a: 1 } }), "invalid");
    await expectCode(bad({ ...emptyHead(), texts: [] }), "invalid");
    await expectCode(bad({ ...emptyHead(), outline: {} }), "invalid");
    await expectCode(bad({ ...emptyHead(), step: -1 }), "invalid");
    await expectCode(bad({ ...emptyHead(), sourceRefs: "S1" }), "invalid");
    await expectCode(bad(null), "invalid");
  });

  it("citeKey berurutan, tidak pernah dipakai ulang, dan tidak boleh dialihkan ke sumber lain", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LP" });
    const s1 = await store.createSource(w.id, src());
    const s2 = await store.createSource(w.id, src({ title: "B", doi: "10.1/b" }));
    const s3 = await store.createSource(w.id, src({ title: "C", doi: "10.1/c" }));

    expect((await store.addSourceRef(d.id, s1.id)).citeKey).toBe("S1");
    expect((await store.addSourceRef(d.id, s2.id)).citeKey).toBe("S2");
    await expectCode(store.addSourceRef(d.id, s1.id), "invalid");

    await store.removeSourceRef(d.id, "S1");
    expect((await store.addSourceRef(d.id, s3.id)).citeKey).toBe("S3"); // bukan S1
    await expectCode(store.removeSourceRef(d.id, "S1"), "not-found");

    const cur = await store.getDocument(d.id);
    expect(cur.citeSeq).toBe(3);
    const reuse = { ...cur.head, sourceRefs: [...cur.head.sourceRefs, { citeKey: "S1", sourceId: s1.id }] };
    await expectCode(store.saveHead(d.id, reuse), "invalid");
    const swap = { ...cur.head, sourceRefs: cur.head.sourceRefs.map((r) => (r.citeKey === "S2" ? { ...r, sourceId: s1.id } : r)) };
    await expectCode(store.saveHead(d.id, swap), "invalid");
    await expectCode(store.saveHead(d.id, { ...cur.head, sourceRefs: [{ citeKey: "X1", sourceId: s1.id }] }), "invalid");
    await expectCode(store.saveHead(d.id, { ...cur.head, sourceRefs: [{ citeKey: "S2", sourceId: s2.id }, { citeKey: "S3", sourceId: s2.id }] }), "invalid");
  });

  it("tidak ada rujukan lintas ruang kerja", async () => {
    const { store } = await makeStore();
    const w1 = await store.createWorkspace({ name: "A" });
    const w2 = await store.createWorkspace({ name: "B" });
    const d = await store.createDocument(w1.id, { type: "LP" });
    const foreign = await store.createSource(w2.id, src());
    const foreignCase = await store.createCase(w2.id, { kasus: "x" });
    const foreignTpl = await store.putTemplate(w2.id, TEMPLATE());
    await expectCode(store.addSourceRef(d.id, foreign.id), "invalid");
    await expectCode(store.saveHead(d.id, { ...emptyHead(), sourceRefs: [{ citeKey: "S1", sourceId: foreign.id }] }), "invalid");
    await expectCode(store.createDocument(w1.id, { type: "LP", caseId: foreignCase.id }), "invalid");
    await expectCode(store.createDocument(w1.id, { type: "LP", templateId: foreignTpl.id }), "invalid");
    await expectCode(store.linkDocument(d.id, foreignCase.id, { confirmed: true }), "invalid");
    await expectCode(store.changeTemplate(d.id, foreignTpl.id, { resetStructure: false }), "invalid");
    await expectCode(store.updateWorkspace(w1.id, { defaultTemplateIds: { LP: foreignTpl.id } }), "invalid");
  });

  it("maksimal 40 sumber per dokumen", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LP" });
    for (let i = 1; i <= 40; i++) await store.addSourceRef(d.id, (await store.createSource(w.id, src({ title: `Sumber ${i}`, doi: `10.1/${i}` }))).id);
    const extra = await store.createSource(w.id, src({ title: "Sumber 41", doi: "10.1/41" }));
    await expectCode(store.addSourceRef(d.id, extra.id), "limit");
  });
});

describe("sumber", () => {
  it("properti asing (id, rev, ruang kerja, pemilik) pada masukan tidak ikut tersimpan", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const evil = { ...src(), id: "S9", rev: 99, workspaceId: "ws-lain", ownerId: "bukan-saya", archivedAt: "x" } as unknown as SourceDraft;
    const s = await store.createSource(w.id, evil);
    expect(s.id).not.toBe("S9");
    expect(s).toMatchObject({ workspaceId: w.id, rev: 1, ownerId: "local" });
    expect(s).not.toHaveProperty("archivedAt");
    await expectCode(store.createSource(w.id, src({ title: "  " })), "invalid");
    await expectCode(store.createSource(w.id, src({ type: "film" as unknown as SourceDraft["type"] })), "invalid");
  });

  it("provenance disaring: yang rusak dibuang, yang sah dipertahankan", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const ok: Provenance = { method: "url", fetchedAt: "2026-11-24T00:00:00.000Z", url: "https://a.example/x" };
    expect((await store.createSource(w.id, src({ provenance: ok }))).provenance).toEqual(ok);
    expect((await store.createSource(w.id, src({ provenance: { method: "x" } as unknown as Provenance }))).provenance).toBeUndefined();
  });

  it("mengubah judul, tahun, penulis, atau DOI membatalkan verifikasi; hash isi mengikuti isi", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const s = await store.createSource(w.id, src());
    expect(s.contentSha256).toBe(await sha256Hex(s.content ?? ""));
    const a = await store.updateSource(s.id, { pages: "1-5" });
    expect(a).toMatchObject({ verified: true, origin: "crossref", pages: "1-5" });
    const b = await store.updateSource(s.id, { title: "Judul diubah" });
    expect(b).toMatchObject({ verified: false, origin: "manual", title: "Judul diubah", rev: 3 });
    const c = await store.updateSource(s.id, { content: "isi baru" });
    expect(c.contentSha256).toBe(await sha256Hex("isi baru"));
    await expectCode(store.updateSource(s.id, { pages: "9" }, 1), "conflict");
  });

  it("hapus butuh konfirmasi, mencabut rujukan, dan membiarkan penanda [S#] di teks", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LP", title: "LP Anemia" });
    const s = await store.createSource(w.id, src());
    await store.addSourceRef(d.id, s.id);
    const cur = await store.getDocument(d.id);
    await store.saveHead(d.id, { ...cur.head, texts: { x: "lihat [S1]" } });

    expect(await store.sourceUsage(s.id)).toEqual([{ documentId: d.id, title: "LP Anemia", citeKey: "S1" }]);
    await expectCode(store.removeSource(s.id, {}), "confirm");
    expect(await store.removeSource(s.id, { confirmed: true })).toEqual({ detachedFrom: [d.id] });
    const after = await store.getDocument(d.id);
    expect(after.head.sourceRefs).toEqual([]);
    expect(after.head.texts.x).toBe("lihat [S1]");
    expect(after.citeSeq).toBe(1);
  });

  it("sumber yang diarsipkan tidak bisa dipakai dokumen sampai dipulihkan", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LP" });
    const s = await store.createSource(w.id, src());
    await store.archiveSource(s.id);
    expect(await store.listSources(w.id)).toHaveLength(0);
    expect(await store.listSources(w.id, { includeArchived: true })).toHaveLength(1);
    await expectCode(store.addSourceRef(d.id, s.id), "invalid");
    await store.archiveSource(s.id, false);
    expect((await store.addSourceRef(d.id, s.id)).citeKey).toBe("S1");
  });
});

describe("kasus dan tautan opsional per dokumen", () => {
  const JENIS = "Kehamilan (ANC)";
  const KASUS = "Anemia ringan";

  it("kasus: buat, ubah, rapikan spasi", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const c = await store.createCase(w.id, { jenisAsuhan: JENIS, kasus: `  ${KASUS} ` });
    expect(c).toMatchObject({ jenisAsuhan: JENIS, kasus: KASUS, workspaceId: w.id });
    const u = await store.updateCase(c.id, { kasus: "" });
    expect(u.kasus).toBeUndefined();
    await expectCode(store.updateCase(c.id, { kasus: "x" }, 1), "conflict");
  });

  it("tautkan butuh pratinjau yang dikonfirmasi; terhubung mengikuti kasus; lepas menyalin nilai yang berlaku (I4)", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const c = await store.createCase(w.id, { jenisAsuhan: JENIS, kasus: KASUS });
    const lp = await store.createDocument(w.id, { type: "LP" });

    const p = await store.previewLink(lp.id, c.id);
    expect(p.items.map((i) => i.id)).toEqual(["jenis_asuhan", "kasus", "judul"]);
    expect(p.message).toContain(KASUS);

    await expectCode(store.linkDocument(lp.id, c.id, {}), "confirm");
    await expectCode(store.linkDocument(lp.id, c.id, { confirmed: false }), "confirm");
    expect((await store.getDocument(lp.id)).caseId).toBeNull();

    await store.linkDocument(lp.id, c.id, { confirmed: true });
    let r = await store.resolveForGeneration(lp.id);
    expect(r.input).toMatchObject({ jenis_asuhan: JENIS, kasus: KASUS, judul: lpTitleFor(JENIS, KASUS) });

    await store.updateCase(c.id, { kasus: "Anemia sedang" });
    r = await store.resolveForGeneration(lp.id);
    expect(r.input.kasus).toBe("Anemia sedang"); // mengikuti kasus selama terhubung

    const un = await store.unlinkDocument(lp.id);
    expect(un.caseId).toBeNull();
    expect(un.head.input).toMatchObject({ jenis_asuhan: JENIS, kasus: "Anemia sedang" });
    await store.updateCase(c.id, { kasus: "Berubah lagi" });
    expect((await store.resolveForGeneration(lp.id)).input.kasus).toBe("Anemia sedang"); // tidak ikut lagi, tidak hilang
    expect((await store.unlinkDocument(lp.id)).rev).toBe(un.rev); // melepas dokumen yang sudah lepas = tanpa perubahan
  });

  it("pindah ke kasus lain: isian kasus lama disalin dulu, lalu kasus baru berlaku", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const a = await store.createCase(w.id, { jenisAsuhan: JENIS, kasus: "Kasus A" });
    const b = await store.createCase(w.id, { jenisAsuhan: "Nifas (PNC)", kasus: "Kasus B" });
    const lp = await store.createDocument(w.id, { type: "LP" });
    await store.linkDocument(lp.id, a.id, { confirmed: true });
    const moved = await store.linkDocument(lp.id, b.id, { confirmed: true });
    expect(moved.head.input.kasus).toBe("Kasus A");
    expect((await store.resolveForGeneration(lp.id)).input.kasus).toBe("Kasus B");
    expect((await store.unlinkDocument(lp.id)).head.input.kasus).toBe("Kasus B");
  });

  it("Reading Journal tidak pernah menerima data pasien, terhubung atau tidak (I5)", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const c = await store.createCase(w.id, { jenisAsuhan: JENIS, kasus: KASUS });
    const rj = await store.createDocument(w.id, { type: "RJ" });
    await store.saveHead(rj.id, { ...emptyHead(), input: { topik: "Topik saya", td: "120/80 mmHg", inisial: "Ny. A" } });
    for (const phase of ["mandiri", "terhubung"]) {
      if (phase === "terhubung") await store.linkDocument(rj.id, c.id, { confirmed: true });
      const input = (await store.resolveForGeneration(rj.id)).input;
      expect(input, phase).not.toHaveProperty("td");
      expect(input, phase).not.toHaveProperty("inisial");
      expect(input.topik, phase).toBe("Topik saya");
      expect(input, phase).not.toHaveProperty("kasus");
    }
  });

  it("hapus kasus butuh konfirmasi dan hanya melepas dokumen, tidak menghapusnya", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const c = await store.createCase(w.id, { jenisAsuhan: JENIS, kasus: KASUS });
    const lp = await store.createDocument(w.id, { type: "LP" });
    const lk = await store.createDocument(w.id, { type: "LK" });
    await store.linkDocument(lp.id, c.id, { confirmed: true });
    await expectCode(store.removeCase(c.id, {}), "confirm");
    expect(await store.removeCase(c.id, { confirmed: true })).toEqual({ unlinked: [lp.id] });
    await expectCode(store.getCase(c.id), "not-found");
    const after = await store.getDocument(lp.id);
    expect(after.caseId).toBeNull();
    expect(after.head.input).toMatchObject({ jenis_asuhan: JENIS, kasus: KASUS });
    expect(await store.getDocument(lk.id)).toBeTruthy();
  });
});

describe("versi", () => {
  it("snapshot memuat isi, metadata sumber tanpa isinya, dan hash; nomor urut tanpa celah", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LP" });
    const s = await store.createSource(w.id, src());
    await store.addSourceRef(d.id, s.id);
    const cur = await store.getDocument(d.id);
    await store.saveHead(d.id, { ...cur.head, texts: { x: "lihat [S1]" } });

    const v1 = await store.createVersion(d.id);
    const v2 = await store.createVersion(d.id, "ekspor");
    expect([v1.seq, v2.seq]).toEqual([1, 2]);
    expect(v1).toMatchObject({ id: `${d.id}:1`, reason: "manual", documentId: d.id, workspaceId: w.id });
    expect(v1.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v1.content.texts).toEqual({ x: "lihat [S1]" });
    expect(v1.sourceSnapshot.S1.source.title).toBe(s.title);
    expect(v1.sourceSnapshot.S1.source).not.toHaveProperty("content");
    expect(v1.sourceSnapshot.S1.contentSha256).toBe(s.contentSha256);
    expect((await store.listVersions(d.id)).map((v) => v.seq)).toEqual([1, 2]);
  });

  it("dua tab yang membuat versi bersamaan mendapat nomor berbeda", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LP" });
    const [a, b] = await Promise.all([store.createVersion(d.id), store.createVersion(d.id)]);
    expect([a.seq, b.seq].sort()).toEqual([1, 2]);
    expect(await store.listVersions(d.id)).toHaveLength(2);
  });

  it("pulihkan tidak merusak: keadaan sekarang disimpan dulu, dan bisa dibalik", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LK" });
    await store.saveHead(d.id, { ...emptyHead(), input: { kasus: "A" }, texts: { x: "a" } });
    const v1 = await store.createVersion(d.id);
    await store.saveHead(d.id, { ...emptyHead(), input: { kasus: "B" } });

    const r = await store.restoreVersion(d.id, v1.id);
    expect(r.doc.head.input).toEqual({ kasus: "A" });
    expect(r.doc.head.texts).toEqual({ x: "a" });
    const vs = await store.listVersions(d.id);
    expect(vs.map((v) => v.reason)).toEqual(["manual", "sebelum-pulihkan"]);
    expect(vs[1].content.input).toEqual({ kasus: "B" });

    const back = await store.restoreVersion(d.id, vs[1].id);
    expect(back.doc.head.input).toEqual({ kasus: "B" });
  });

  it("isi versi yang rusak (hash tidak cocok) tidak dipulihkan", async () => {
    const { store, backend } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LK" });
    await store.saveHead(d.id, { ...emptyHead(), input: { kasus: "asli" } });
    const v = await store.createVersion(d.id);
    const raw = (await backend.get<VersionRec>("versions", v.id))!;
    raw.content.input = { kasus: "dirusak" };
    await backend.batch([{ kind: "put", store: "versions", key: v.id, value: raw }]);
    await expectCode(store.restoreVersion(d.id, v.id), "integrity");
    expect((await store.getDocument(d.id)).head.input).toEqual({ kasus: "asli" });
  });

  it("versi dokumen lain tidak bisa dipakai memulihkan", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const a = await store.createDocument(w.id, { type: "LP" });
    const b = await store.createDocument(w.id, { type: "LP" });
    const v = await store.createVersion(a.id);
    await expectCode(store.restoreVersion(b.id, v.id), "not-found");
  });

  it("rujukan ke sumber yang sudah dihapus dilepas saat memulihkan, dan citeSeq tidak turun", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LP" });
    const s = await store.createSource(w.id, src());
    await store.addSourceRef(d.id, s.id);
    const v = await store.createVersion(d.id);
    await store.removeSource(s.id, { confirmed: true });
    const r = await store.restoreVersion(d.id, v.id);
    expect(r.dropped).toEqual([{ citeKey: "S1", sourceId: s.id }]);
    expect(r.doc.head.sourceRefs).toEqual([]);
    expect(r.doc.citeSeq).toBe(1);
  });

  it("pemangkasan: maksimal 20 Version; yang 'manual' dan 'migrasi' tidak pernah dipangkas", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d1 = await store.createDocument(w.id, { type: "LP" });
    for (let i = 0; i < 25; i++) await store.createVersion(d1.id, "ekspor");
    const l1 = await store.listVersions(d1.id);
    expect(l1).toHaveLength(20);
    expect(l1[0].seq).toBe(6);

    const d2 = await store.createDocument(w.id, { type: "LP" });
    for (let i = 0; i < 3; i++) await store.createVersion(d2.id, "manual");
    for (let i = 0; i < 25; i++) await store.createVersion(d2.id, "ekspor");
    const l2 = await store.listVersions(d2.id);
    expect(l2).toHaveLength(20);
    expect(l2.filter((v) => v.reason === "manual").map((v) => v.seq)).toEqual([1, 2, 3]);
  });

  it("memulihkan versi tertua tidak ikut memangkas versi itu sendiri", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const d = await store.createDocument(w.id, { type: "LP" });
    for (let i = 0; i < 20; i++) await store.createVersion(d.id, "ekspor");
    await store.restoreVersion(d.id, `${d.id}:1`);
    const l = await store.listVersions(d.id);
    expect(l.some((v) => v.seq === 1)).toBe(true);
    expect(l.some((v) => v.reason === "sebelum-pulihkan")).toBe(true);
  });
});

describe("template", () => {
  it("template milik ruang kerja; bawaan per jenis; jenis yang salah ditolak; hash dihitung", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const t = await store.putTemplate(w.id, TEMPLATE());
    expect(t).toMatchObject({ docType: "LP", size: 3, workspaceId: w.id });
    expect(t.dataSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(t.mappingSha256).toMatch(/^[0-9a-f]{64}$/);
    await expectCode(store.putTemplate(w.id, TEMPLATE(buf([]))), "invalid");

    await store.updateWorkspace(w.id, { defaultTemplateIds: { LP: t.id } });
    expect((await store.createDocument(w.id, { type: "LP" })).templateId).toBe(t.id);
    expect((await store.createDocument(w.id, { type: "RJ" })).templateId).toBeNull();
    expect((await store.createDocument(w.id, { type: "LP", templateId: null })).templateId).toBeNull();
    await expectCode(store.createDocument(w.id, { type: "LK", templateId: t.id }), "invalid");
    await expectCode(store.updateWorkspace(w.id, { defaultTemplateIds: { LK: t.id } }), "invalid");

    const t2 = await store.updateTemplateMapping(t.id, { b: 2 } as unknown as Mapping);
    expect(t2.mappingSha256).not.toBe(t.mappingSha256);
    expect(t2.dataSha256).toBe(t.dataSha256);
  });

  it("ganti template yang mengosongkan struktur membuat Version lebih dulu; tanpa struktur tidak membuat", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const t = await store.putTemplate(w.id, TEMPLATE());
    const d = await store.createDocument(w.id, { type: "LP", templateId: t.id });

    await store.changeTemplate(d.id, null, { resetStructure: true }); // belum ada struktur
    expect(await store.listVersions(d.id)).toHaveLength(0);

    await store.changeTemplate(d.id, t.id, { resetStructure: false });
    await store.saveHead(d.id, { ...emptyHead(), outline: OUTLINE, texts: { o1: "teks dinamis", tujuan: "tetap" } });
    const after = await store.changeTemplate(d.id, null, { resetStructure: true });
    expect(after).toMatchObject({ templateId: null });
    expect(after.head.outline).toBeNull();
    expect(after.head.texts).toEqual({ tujuan: "tetap" });

    const vs = await store.listVersions(d.id);
    expect(vs).toHaveLength(1);
    expect(vs[0].reason).toBe("sebelum-ganti-template");
    expect(vs[0].content.outline).toEqual(OUTLINE);
    expect(vs[0].content.texts.o1).toBe("teks dinamis");
    expect(vs[0].templateRef?.templateId).toBe(t.id);
    // dapat dipulihkan
    const r = await store.restoreVersion(d.id, vs[0].id);
    expect(r.doc.head.outline).toEqual(OUTLINE);
  });

  it("hapus template butuh konfirmasi; dokumen kembali ke format bawaan; bawaan ruang kerja dibersihkan", async () => {
    const { store } = await makeStore();
    const w = await store.createWorkspace({ name: "A" });
    const t = await store.putTemplate(w.id, TEMPLATE());
    await store.updateWorkspace(w.id, { defaultTemplateIds: { LP: t.id } });
    const d = await store.createDocument(w.id, { type: "LP" });
    await store.saveHead(d.id, { ...emptyHead(), outline: OUTLINE, texts: { o1: "x" } });

    await expectCode(store.removeTemplate(t.id, {}), "confirm");
    expect(await store.removeTemplate(t.id, { confirmed: true })).toEqual({ detached: [d.id] });
    await expectCode(store.getTemplate(t.id), "not-found");
    const doc = await store.getDocument(d.id);
    expect(doc.templateId).toBeNull();
    expect(doc.head.outline).toBeNull();
    expect((await store.getWorkspace(w.id)).defaultTemplateIds).toEqual({});
    expect((await store.listVersions(d.id)).map((v) => v.reason)).toEqual(["sebelum-ganti-template"]);
  });
});

describe("bahan untuk generator (I2, I8)", () => {
  it("isian efektif memakai identitas profil; sumber berformat server dengan id = citeKey", async () => {
    const { store } = await makeStore();
    await store.saveProfile({ nama: "Siti", nim: "123", prodi: "D3", kampus: "Poltekkes", pembimbing: "Bu D", tahun: "2026" });
    const w = await store.createWorkspace({ name: "A", citeStyle: "Vancouver" });
    const d = await store.createDocument(w.id, { type: "LK" });
    const s1 = await store.createSource(w.id, src());
    const s2 = await store.createSource(w.id, src({ title: "Buku", type: "buku", doi: undefined, journal: undefined, publisher: "YBP" }));
    await store.addSourceRef(d.id, s1.id);
    await store.addSourceRef(d.id, s2.id);
    const cur = await store.getDocument(d.id);
    await store.saveHead(d.id, { ...cur.head, input: { kasus: "Mandiri" } });

    const r = await store.resolveForGeneration(d.id);
    expect(r.input).toMatchObject({ nama: "Siti", kampus: "Poltekkes", kasus: "Mandiri" });
    expect(r.citeStyle).toBe("Vancouver");
    expect(r.sources.map((s) => s.id)).toEqual(["S1", "S2"]);
    expect(r.sources[0]).not.toHaveProperty("workspaceId");
    expect(r.sources[0]).not.toHaveProperty("rev");
    expect(r.sources[0]).not.toHaveProperty("contentSha256");
    expect(parseSources(r.sources)?.map((s) => s.id)).toEqual(["S1", "S2"]); // diterima validator server
  });

  it("profil: nilai awal tanpa tulis, simpan, rev basi ditolak", async () => {
    const { store } = await makeStore();
    const p0 = await store.getProfile();
    expect(p0.rev).toBe(0);
    const id = { nama: "A", nim: "", prodi: "", kampus: "", pembimbing: "", tahun: "2026" };
    const p1 = await store.saveProfile(id, 0);
    expect(p1.rev).toBe(1);
    await expectCode(store.saveProfile({ ...id, nama: "B" }, 0), "conflict");
    expect((await store.saveProfile({ ...id, nama: "B" }, 1)).identity.nama).toBe("B");
  });
});

describe("backend dan skema", () => {
  it("batch atomik: bila satu nilai gagal disimpan, tidak ada yang tertulis", async () => {
    const b = new MemoryBackend();
    await expect(
      b.batch([
        { kind: "put", store: "meta", key: "a", value: { ok: 1 } },
        { kind: "put", store: "meta", key: "b", value: { f: () => 1 } },
      ])
    ).rejects.toThrow();
    expect(await b.get("meta", "a")).toBeUndefined();
  });

  it("guard: rekaman sudah ada atau rev berubah membatalkan seluruh batch", async () => {
    const b = new MemoryBackend();
    await b.batch([{ kind: "put", store: "meta", key: "a", value: { rev: 1 } }]);
    await expectCode(b.batch([{ kind: "put", store: "meta", key: "x", value: {} }], [{ store: "meta", key: "a", absent: true }]), "conflict");
    await expectCode(b.batch([{ kind: "put", store: "meta", key: "x", value: {} }], [{ store: "meta", key: "a", rev: 2 }]), "conflict");
    await expectCode(b.batch([{ kind: "put", store: "meta", key: "x", value: {} }], [{ store: "meta", key: "tidak-ada", rev: 1 }]), "conflict");
    expect(await b.get("meta", "x")).toBeUndefined();
  });

  it("skema lebih baru dari yang dikenal: baca boleh, tulis ditolak", async () => {
    const backend = new MemoryBackend();
    await backend.batch([{ kind: "put", store: "meta", key: "schema", value: { version: 99 } }]);
    const store = new WorkspaceStore(backend, testDeps());
    expect(await store.open()).toEqual({ readOnly: true, schemaVersion: 99 });
    await expectCode(store.createWorkspace({ name: "x" }), "read-only");
    expect(await store.listWorkspaces()).toEqual([]);
  });
});
