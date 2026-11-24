import { describe, expect, it } from "vitest";
import { buildInput, lpTitleFor, type SharedCase } from "../kasus";
import type { DocType } from "../types";
import { MemoryBackend, STORE_NAMES, type Guard, type Op } from "../workspace/backend";
import { migrateV1ToV2, type LegacySnapshot, type MigrationResult } from "../workspace/migrate";
import { WorkspaceStore } from "../workspace/store";
import type { DocumentRec } from "../workspace/types";
import { buf, testDeps } from "./ws-helpers";

/**
 * T06: migrasi key lokal v1 -> v2. Data v1 diberikan sebagai LegacySnapshot (string JSON mentah dan template);
 * pembacaan dari localStorage/IndexedDB ada di legacy.ts dan hanya berjalan di peramban.
 */

const JENIS = "Kehamilan (ANC)";
const KASUS = "Anemia ringan";

const S1 = {
  id: "S1",
  type: "jurnal",
  title: "Anemia pada Kehamilan",
  authors: [{ family: "Rahma", given: "S" }],
  year: "2022",
  journal: "Jurnal Kebidanan",
  doi: "10.1234/abc",
  content: "Anemia adalah kadar hemoglobin yang rendah.",
  origin: "crossref",
  verified: true,
  provenance: { method: "doi", fetchedAt: "2026-11-24T00:00:00.000Z" },
};
const S2 = { id: "S2", type: "buku", title: "Buku Ajar Kebidanan", authors: [{ family: "Prawirohardjo" }], year: "2020", publisher: "YBP", origin: "manual", verified: false };
const WEB = { id: "S3", type: "web", title: "Situs WHO", authors: [], year: "2023", url: "https://who.int/x", origin: "manual", verified: false };

const settings = { nama: "Siti", nim: "123", prodi: "D3 Kebidanan", kampus: "Poltekkes", pembimbing: "Bu Dewi", tahun: "2026", style: "Vancouver", accessCode: "kode-rahasia" };
const identity = { nama: "Siti", nim: "123", prodi: "D3 Kebidanan", kampus: "Poltekkes", pembimbing: "Bu Dewi", tahun: "2026" };
const kasusC: SharedCase = { jenis_asuhan: JENIS, kasus: KASUS, linked: { LP: true, RJ: true } };

const lpDraft = { input: { tujuan: "memahami" }, sources: [S1, S2], texts: { definisi: "Anemia adalah ... [S1]" }, step: 1, outline: null };
const lkDraft = {
  input: { kasus: "Mandiri", jenis_asuhan: "Nifas (PNC)", td: "110/70 mmHg", inisial: "Ny. A" },
  sources: [],
  texts: {},
  step: 2,
  outline: [{ id: "o1", title: "BAB I", level: 1, role: "manual" }],
};
const rjDraft = { input: { topik: "", j_title: "Judul Jurnal", j_text: "Isi jurnal." }, sources: [], texts: {}, step: 0, outline: null };
const emptyDraft = { input: {}, sources: [], texts: {}, step: 0, outline: null };

const template = { name: "kampus.docx", size: 3, data: buf([1, 2, 3]), analysis: { headings: [] }, mapping: {}, savedAt: 1700000000000 };

function full(): LegacySnapshot {
  return {
    settings: JSON.stringify(settings),
    case: JSON.stringify(kasusC),
    library: JSON.stringify([{ ...S1, id: "S5" }, WEB]),
    drafts: { LP: JSON.stringify(lpDraft), LK: JSON.stringify(lkDraft), RJ: JSON.stringify(rjDraft) },
    templates: { LP: { ...template, data: buf([1, 2, 3]) } },
  };
}

const none = (): LegacySnapshot => ({ settings: null, case: null, library: null, drafts: {}, templates: {} });

async function setup(legacy: LegacySnapshot) {
  const backend = new MemoryBackend();
  const deps = testDeps();
  const store = new WorkspaceStore(backend, deps);
  await store.open();
  const result = await migrateV1ToV2(backend, legacy, deps);
  return { backend, deps, store, result };
}

function migrated(r: MigrationResult) {
  if (r.status !== "migrated") throw new Error("seharusnya migrated");
  return r;
}

async function docs(store: WorkspaceStore) {
  const ws = (await store.listWorkspaces())[0];
  const list = await store.listDocuments(ws.id);
  return { ws, list, byType: Object.fromEntries(list.map((d) => [d.type, d])) as Partial<Record<DocType, DocumentRec>> };
}

const dump = async (b: MemoryBackend) => JSON.stringify(await Promise.all(STORE_NAMES.map((s) => b.getAll(s))));

describe("migrasi v1 -> v2: isi", () => {
  it("memindahkan pengaturan, kasus, draf, sumber, pustaka, dan template ke satu ruang kerja", async () => {
    const { store, result } = await setup(full());
    const r = migrated(result);
    expect(r.summary).toMatchObject({
      documents: 3,
      skippedEmptyDrafts: 0,
      cases: 1,
      sources: 3,
      sourcesMerged: 1, // S5 di pustaka identik dengan S1 di LP
      templates: 1,
      versions: 3,
      quarantined: [],
      warnings: [],
      linkedWithoutDocument: [],
    });

    const { ws, byType } = await docs(store);
    expect(ws).toMatchObject({ name: "Ruang kerja saya", citeStyle: "Vancouver" });
    expect((await store.getProfile()).identity).toEqual(identity);

    const lp = byType.LP!;
    const lk = byType.LK!;
    const rj = byType.RJ!;
    const [theCase] = await store.listCases(ws.id);
    expect(theCase).toMatchObject({ jenisAsuhan: JENIS, kasus: KASUS });
    expect([lp.caseId, lk.caseId, rj.caseId]).toEqual([theCase.id, null, theCase.id]);
    expect([lp.title, lk.title, rj.title]).toEqual([lpTitleFor(JENIS, KASUS), "Laporan Kasus", "Judul Jurnal"]);

    expect(lp.head.texts).toEqual(lpDraft.texts);
    expect(lp.head.step).toBe(1);
    expect(lk.head.outline).toEqual(lkDraft.outline);
    expect(lp.head.sourceRefs.map((x) => x.citeKey)).toEqual(["S1", "S2"]); // penanda [S#] di teks tetap sah
    expect(lp.citeSeq).toBe(2);

    expect((await store.listSources(ws.id)).map((s) => s.title).sort()).toEqual(["Anemia pada Kehamilan", "Buku Ajar Kebidanan", "Situs WHO"]);

    const [t] = await store.listTemplates(ws.id, "LP");
    expect(Array.from(new Uint8Array(t.data))).toEqual([1, 2, 3]);
    expect(ws.defaultTemplateIds).toEqual({ LP: t.id });
    expect([lp.templateId, lk.templateId, rj.templateId]).toEqual([t.id, null, null]);
  });

  it("isian efektif sama dengan v1 untuk LP, LK, dan RJ (terhubung dan mandiri), termasuk sumber", async () => {
    const { store } = await setup(full());
    const { byType } = await docs(store);
    const drafts = { LP: lpDraft, LK: lkDraft, RJ: rjDraft };
    for (const type of ["LP", "LK", "RJ"] as const) {
      const expected = buildInput(type, drafts[type].input, identity, kasusC);
      expect((await store.resolveForGeneration(byType[type]!.id)).input, type).toEqual(expected);
    }
    const lp = await store.resolveForGeneration(byType.LP!.id);
    expect(lp.sources).toMatchObject([
      { id: "S1", title: S1.title, content: S1.content, doi: S1.doi, verified: true, origin: "crossref", provenance: S1.provenance },
      { id: "S2", title: S2.title, publisher: "YBP", verified: false, origin: "manual" },
    ]);
    expect(lp.citeStyle).toBe("Vancouver");
    expect(lp.template).not.toBeNull();
  });

  it("kasus bertanda terhubung tetapi kosong: perilaku v1 (mengosongkan jenis asuhan dan kasus) tetap sama", async () => {
    const legacy = { ...none(), settings: JSON.stringify(settings), case: JSON.stringify({ linked: { LP: true } }), drafts: { LP: JSON.stringify({ ...emptyDraft, input: { jenis_asuhan: "Nifas (PNC)", kasus: "X" } }) } };
    const { store } = await setup(legacy);
    const { byType } = await docs(store);
    const expected = buildInput("LP", { jenis_asuhan: "Nifas (PNC)", kasus: "X" }, identity, { linked: { LP: true } });
    expect(byType.LP!.caseId).not.toBeNull();
    expect((await store.resolveForGeneration(byType.LP!.id)).input).toEqual(expected);
  });

  it("kode akses tidak masuk ke penyimpanan v2; hanya dikembalikan untuk disimpan sebagai rahasia perangkat", async () => {
    const { backend, result } = await setup(full());
    expect(migrated(result).accessCode).toBe("kode-rahasia");
    for (const s of STORE_NAMES) expect(JSON.stringify(await backend.getAll(s)), s).not.toContain("kode-rahasia");
  });

  it("tiap dokumen mendapat Version 'migrasi' (seq 1) yang sah dan bisa dipulihkan", async () => {
    const { store } = await setup(full());
    const { list } = await docs(store);
    for (const d of list) {
      const vs = await store.listVersions(d.id);
      expect(vs, d.type).toHaveLength(1);
      expect(vs[0]).toMatchObject({ seq: 1, reason: "migrasi" });
      expect(vs[0].content.input).toEqual(d.head.input);
      const r = await store.restoreVersion(d.id, vs[0].id);
      expect(r.dropped).toEqual([]);
      expect(r.doc.head.input).toEqual(d.head.input);
    }
  });
});

describe("migrasi v1 -> v2: keamanan data lama dan idempotensi", () => {
  it("tidak mengubah data lama sedikit pun (termasuk byte template)", async () => {
    const legacy = full();
    const before = structuredClone(legacy);
    await setup(legacy);
    expect(legacy).toEqual(before);
    expect(Array.from(new Uint8Array(legacy.templates.LP!.data as ArrayBuffer))).toEqual([1, 2, 3]);
  });

  it("dijalankan lagi, bahkan dengan data lama yang berbeda: dilewati dan tidak mengubah apa pun", async () => {
    const { backend, deps, result } = await setup(full());
    expect(result.status).toBe("migrated");
    const before = await dump(backend);
    expect(await migrateV1ToV2(backend, full(), deps)).toEqual({ status: "skipped", reason: "sudah-selesai" });
    expect(await migrateV1ToV2(backend, none(), deps)).toEqual({ status: "skipped", reason: "sudah-selesai" });
    expect(await dump(backend)).toBe(before);
  });

  it("dua tab menjalankan bersamaan: satu bermigrasi, satu dilewati, hasil tidak ganda", async () => {
    const backend = new MemoryBackend();
    const deps = testDeps();
    const res = await Promise.all([migrateV1ToV2(backend, full(), deps), migrateV1ToV2(backend, full(), deps)]);
    expect(res.map((r) => r.status).sort()).toEqual(["migrated", "skipped"]);
    const store = new WorkspaceStore(backend, deps);
    expect(await store.listWorkspaces()).toHaveLength(1);
    expect((await docs(store)).list).toHaveLength(3);
  });

  it("gagal di tengah (mis. disk penuh): tidak ada data parsial, dan percobaan berikutnya berhasil", async () => {
    class Flaky extends MemoryBackend {
      fail = true;
      override async batch(ops: Op[], guards?: Guard[]) {
        if (this.fail) throw new Error("disk penuh");
        return super.batch(ops, guards);
      }
    }
    const b = new Flaky();
    const deps = testDeps();
    await expect(migrateV1ToV2(b, full(), deps)).rejects.toThrow("disk penuh");
    for (const s of STORE_NAMES) expect(await b.getAll(s), s).toEqual([]);
    b.fail = false;
    expect((await migrateV1ToV2(b, full(), deps)).status).toBe("migrated");
  });

  it("tidak menimpa profil yang sudah ada", async () => {
    const backend = new MemoryBackend();
    const deps = testDeps();
    const store = new WorkspaceStore(backend, deps);
    await store.open();
    await store.saveProfile({ ...identity, nama: "Sudah Ada" });
    await migrateV1ToV2(backend, full(), deps);
    expect((await store.getProfile()).identity.nama).toBe("Sudah Ada");
  });
});

describe("migrasi v1 -> v2: data aneh", () => {
  it("tanpa data lama sama sekali: tetap ada ruang kerja bawaan dan profil awal", async () => {
    const { store, result } = await setup(none());
    expect(migrated(result).summary).toMatchObject({ documents: 0, cases: 0, sources: 0, templates: 0, versions: 0 });
    expect(await store.listWorkspaces()).toHaveLength(1);
    expect((await store.getProfile()).identity.tahun).toBe("2026");
  });

  it("draf kosong tidak membuat dokumen", async () => {
    const { store, result } = await setup({ ...none(), drafts: { LP: JSON.stringify(emptyDraft), RJ: JSON.stringify({ ...emptyDraft, input: { topik: "  " } }) } });
    expect(migrated(result).summary).toMatchObject({ documents: 0, skippedEmptyDrafts: 2 });
    expect((await docs(store)).list).toEqual([]);
  });

  it("JSON rusak tidak ditimpa: disimpan mentah di karantina, bagian lain tetap bermigrasi", async () => {
    const { backend, store, result } = await setup({ ...full(), drafts: { LP: JSON.stringify(lpDraft), LK: "{bukan json", RJ: JSON.stringify(rjDraft) } });
    const r = migrated(result);
    expect(r.summary.quarantined).toEqual(["nakesa.draft.LK: JSON rusak"]);
    expect(r.summary.documents).toBe(2);
    expect(await backend.get("meta", "quarantine:1")).toMatchObject({ key: "nakesa.draft.LK", raw: "{bukan json", reason: "JSON rusak" });
    expect(Object.keys((await docs(store)).byType).sort()).toEqual(["LP", "RJ"]);
  });

  it("pengaturan rusak atau bentuk salah: identitas awal, tetap berjalan", async () => {
    const a = migrated((await setup({ ...none(), settings: "{rusak" })).result);
    expect(a.summary.quarantined).toEqual(["nakesa.settings: JSON rusak"]);
    const b = migrated((await setup({ ...none(), settings: "[1,2]" })).result);
    expect(b.summary.quarantined).toEqual(["nakesa.settings: bentuk tidak dikenal"]);
  });

  it("kasus bertanda terhubung tanpa draf: kasus tetap dibuat dan dilaporkan", async () => {
    const { store, result } = await setup({ ...none(), case: JSON.stringify({ jenis_asuhan: JENIS, kasus: KASUS, linked: { LP: true } }) });
    expect(migrated(result).summary).toMatchObject({ cases: 1, documents: 0, linkedWithoutDocument: ["LP"] });
    expect(await store.listCases((await store.listWorkspaces())[0].id)).toHaveLength(1);
  });

  it("isian bukan teks tidak dibawa tetapi dilaporkan", async () => {
    const bad = { ...emptyDraft, input: { kasus: "Anemia", umur: 25 }, texts: { x: ["array"] } };
    const { store, result } = await setup({ ...none(), drafts: { LK: JSON.stringify(bad) } });
    expect(migrated(result).summary.warnings).toEqual(["nakesa.draft.LK: 2 isian bukan teks tidak dibawa."]);
    expect((await docs(store)).byType.LK!.head.input).toEqual({ kasus: "Anemia" });
  });

  it("template tidak sah dilewati dengan peringatan", async () => {
    const { store, result } = await setup({ ...none(), templates: { LP: { name: "x", size: 1, data: "bukan buffer", analysis: {}, mapping: {}, savedAt: 1 } } });
    expect(migrated(result).summary).toMatchObject({ templates: 0 });
    expect(migrated(result).summary.warnings[0]).toContain("Template LP");
    expect((await store.listWorkspaces())[0].defaultTemplateIds).toEqual({});
  });
});

describe("migrasi v1 -> v2: sumber", () => {
  it("DOI sama tetapi isi berbeda: tidak digabung", async () => {
    const { result } = await setup({ ...none(), library: JSON.stringify([S1, { ...S1, content: "isi yang lain" }]) });
    expect(migrated(result).summary).toMatchObject({ sources: 2, sourcesMerged: 0 });
  });

  it("dua sumber identik dalam satu dokumen tetap dua rujukan berbeda (penanda [S1] dan [S2] di teks tidak runtuh)", async () => {
    const draft = { ...emptyDraft, texts: { x: "[S1] dan [S2]" }, sources: [S1, { ...S1, id: "S2" }] };
    const { store, result } = await setup({ ...none(), drafts: { LP: JSON.stringify(draft) } });
    expect(migrated(result).summary).toMatchObject({ sources: 2, sourcesMerged: 0 });
    const refs = (await docs(store)).byType.LP!.head.sourceRefs;
    expect(refs.map((r) => r.citeKey)).toEqual(["S1", "S2"]);
    expect(new Set(refs.map((r) => r.sourceId)).size).toBe(2);
  });

  it("penanda lama yang ganda atau tidak sah mendapat penanda baru dan dilaporkan", async () => {
    const draft = { ...emptyDraft, sources: [S1, { ...S2, id: "S1" }, { ...WEB, id: "abc" }] };
    const { store, result } = await setup({ ...none(), drafts: { LP: JSON.stringify(draft) } });
    expect(migrated(result).summary.warnings).toHaveLength(2);
    const lp = (await docs(store)).byType.LP!;
    expect(lp.head.sourceRefs.map((r) => r.citeKey)).toEqual(["S1", "S2", "S3"]);
    expect(lp.citeSeq).toBe(3);
  });

  it("sumber tanpa judul atau jenis tidak dikenal masuk karantina; sumber lain tetap dibawa", async () => {
    const draft = { ...emptyDraft, sources: [{ type: "jurnal" }, { ...S2, type: "film" }, S1] };
    const { backend, store, result } = await setup({ ...none(), drafts: { LP: JSON.stringify(draft) } });
    expect(migrated(result).summary.quarantined).toEqual(["nakesa.draft.LP#sources: sumber tidak sah", "nakesa.draft.LP#sources: sumber tidak sah"]);
    expect((await docs(store)).byType.LP!.head.sourceRefs).toEqual([{ citeKey: "S1", sourceId: expect.any(String) }]);
    expect(await backend.get("meta", "quarantine:1")).toBeTruthy();
  });
});
