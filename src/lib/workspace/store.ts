import type { CiteStyle, DocType, Identity, Input, Source } from "../types";
import { buildInput, caseDerivedInput, linkConfirmMessage, reusePreview, type ReuseItem, type SharedCase } from "../kasus";
import { dropDynamicTexts } from "../outline";
import { parseProvenance } from "../provenance";
import type { Analysis, Mapping } from "../template/types";
import type { Backend, Guard, Op, StoreName } from "./backend";
import { defaultDeps, type StoreDeps } from "./deps";
import { canonical } from "./hash";
import { buildVersion, contentHash, isCiteKey, maxCite, pruneOps, toApiSource, type BuildVersionArgs } from "./snapshot";
import {
  DOC_TYPES,
  MAX_REFS,
  SCHEMA_VERSION,
  StoreError,
  type Base,
  type CaseRec,
  type DocHead,
  type DocumentRec,
  type ProfileRec,
  type SourceDraft,
  type SourceRec,
  type SourceRef,
  type TemplateRec,
  type VersionReason,
  type VersionRec,
  type WorkspaceRec,
} from "./types";

/**
 * T06: aturan penyimpanan lokal v2 (ADR T05). Semua aturan di sini diuji dengan MemoryBackend; IdbBackend hanya
 * memetakan Backend ke IndexedDB. Semua penghapusan permanen WAJIB menyertakan konfirmasi eksplisit.
 */

export const DEFAULT_WORKSPACE_NAME = "Ruang kerja saya";
export const PROFILE_ID = "profile";
export const MIGRATION_KEY = "migration:v1->v2";

export const DEFAULT_TITLE: Record<DocType, string> = { LP: "Laporan Pendahuluan", LK: "Laporan Kasus", RJ: "Reading Journal" };
const EMPTY_IDENTITY: Identity = { nama: "", nim: "", prodi: "", kampus: "", pembimbing: "", tahun: "" };
const SOURCE_TYPES: readonly SourceDraft["type"][] = ["jurnal", "buku", "pedoman", "web"];

export const emptyHead = (): DocHead => ({ input: {}, texts: {}, outline: null, step: 0, sourceRefs: [] });

/** Bentuk kasus bersama yang dipahami kasus.ts untuk satu dokumen. Tanpa Case: dokumen berdiri sendiri. */
export function sharedCaseFor(type: DocType, c: CaseRec | null): SharedCase {
  return c ? { jenis_asuhan: c.jenisAsuhan, kasus: c.kasus, linked: { [type]: true } } : {};
}

function cleanText(v: unknown, label: string, max: number, required = true): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s && required) throw new StoreError("invalid", `${label} wajib diisi.`);
  if (s.length > max) throw new StoreError("invalid", `${label} terlalu panjang (maksimal ${max} karakter).`);
  return s;
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as Record<string, unknown>).every((x) => typeof x === "string");

function checkHead(h: DocHead): void {
  if (!h || typeof h !== "object") throw new StoreError("invalid", "Isi dokumen tidak valid.");
  if (!isStringRecord(h.input) || !isStringRecord(h.texts)) throw new StoreError("invalid", "Isian dan teks dokumen harus berupa teks.");
  if (h.outline !== null && !Array.isArray(h.outline)) throw new StoreError("invalid", "Struktur dokumen tidak valid.");
  if (!Number.isInteger(h.step) || h.step < 0 || h.step > 100) throw new StoreError("invalid", "Langkah dokumen tidak valid.");
  if (!Array.isArray(h.sourceRefs)) throw new StoreError("invalid", "Daftar rujukan tidak valid.");
}

function requireConfirmed(c: { confirmed?: boolean } | undefined, what: string): void {
  if (!c || c.confirmed !== true) throw new StoreError("confirm", `${what} butuh konfirmasi eksplisit.`);
}

/**
 * Normalisasi satu sumber dari masukan yang tidak dipercaya. Daftar field eksplisit: properti asing (id, rev,
 * workspaceId, ...) tidak boleh ikut tersimpan. Melempar StoreError bila judul kosong atau jenis tidak dikenal.
 */
export function normalizeSource(d: SourceDraft): SourceDraft {
  if (!SOURCE_TYPES.includes(d.type)) throw new StoreError("invalid", "Jenis sumber tidak dikenal.");
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    type: d.type,
    title: cleanText(d.title, "Judul sumber", 500),
    authors: Array.isArray(d.authors)
      ? d.authors.filter((a) => a && typeof a.family === "string").map((a) => (typeof a.given === "string" ? { family: a.family, given: a.given } : { family: a.family }))
      : [],
    year: typeof d.year === "string" ? d.year.trim().slice(0, 20) : "",
    publisher: str(d.publisher),
    edition: str(d.edition),
    journal: str(d.journal),
    volume: str(d.volume),
    issue: str(d.issue),
    pages: str(d.pages),
    doi: str(d.doi),
    url: str(d.url),
    content: str(d.content),
    origin: d.origin === "crossref" ? "crossref" : "manual",
    verified: d.verified === true,
    provenance: d.provenance ? parseProvenance(d.provenance) : undefined,
  };
}

export class WorkspaceStore {
  private writable = true;

  constructor(
    readonly backend: Backend,
    readonly deps: StoreDeps = defaultDeps
  ) {}

  // ---------- dasar ----------

  /** Menyiapkan penanda skema. Bila skema di penyimpanan lebih baru dari yang dikenal, store menjadi baca-saja. */
  async open(): Promise<{ readOnly: boolean; schemaVersion: number }> {
    const cur = await this.backend.get<{ version: number }>("meta", "schema");
    if (!cur) {
      try {
        await this.backend.batch([{ kind: "put", store: "meta", key: "schema", value: { version: SCHEMA_VERSION } }], [{ store: "meta", key: "schema", absent: true }]);
      } catch (e) {
        if (!(e instanceof StoreError && e.code === "conflict")) throw e; // tab lain sudah menulisnya
      }
      return { readOnly: false, schemaVersion: SCHEMA_VERSION };
    }
    this.writable = cur.version <= SCHEMA_VERSION;
    return { readOnly: !this.writable, schemaVersion: cur.version };
  }

  private base(): Base {
    const t = this.deps.now();
    return { id: this.deps.newId(), ownerId: this.deps.ownerId, createdAt: t, updatedAt: t, rev: 1 };
  }

  private bump<T extends Base>(r: T): T {
    return { ...r, updatedAt: this.deps.now(), rev: r.rev + 1 };
  }

  private async write(ops: Op[], guards: Guard[] = []): Promise<void> {
    if (!this.writable) throw new StoreError("read-only", "Data disimpan oleh versi aplikasi yang lebih baru; tidak dapat diubah dari versi ini.");
    await this.backend.batch(ops, guards);
  }

  private async need<T>(store: StoreName, id: string, label: string): Promise<T> {
    const r = await this.backend.get<T>(store, id);
    if (r === undefined) throw new StoreError("not-found", `${label} tidak ditemukan.`);
    return r;
  }

  private expect(r: Base, expectedRev: number | undefined, label: string): void {
    if (expectedRev !== undefined && r.rev !== expectedRev) throw new StoreError("conflict", `${label} sudah diubah di tempat lain. Muat ulang lalu coba lagi.`);
  }

  private revGuard(store: StoreName, r: Base): Guard {
    return { store, key: r.id, rev: r.rev };
  }

  private existsGuard(store: StoreName, id: string): Guard {
    return { store, key: id };
  }

  private async inWorkspace<T extends { workspaceId: string }>(store: StoreName, workspaceId: string): Promise<T[]> {
    return (await this.backend.getAll<T>(store)).filter((r) => r.workspaceId === workspaceId);
  }

  // ---------- profil ----------

  async getProfile(): Promise<ProfileRec> {
    const p = await this.backend.get<ProfileRec>("meta", PROFILE_ID);
    if (p) return p;
    const t = this.deps.now();
    return { id: PROFILE_ID, ownerId: this.deps.ownerId, createdAt: t, updatedAt: t, rev: 0, identity: { ...EMPTY_IDENTITY } };
  }

  async saveProfile(identity: Identity, expectedRev?: number): Promise<ProfileRec> {
    const cur = await this.getProfile();
    this.expect(cur, expectedRev, "Profil");
    const clean = {} as Identity;
    for (const k of Object.keys(EMPTY_IDENTITY) as (keyof Identity)[]) clean[k] = cleanText(identity[k], k, 200, false);
    const next: ProfileRec = { ...cur, identity: clean, updatedAt: this.deps.now(), rev: cur.rev + 1 };
    await this.write([{ kind: "put", store: "meta", key: PROFILE_ID, value: next }], [cur.rev === 0 ? { store: "meta", key: PROFILE_ID, absent: true } : this.revGuard("meta", cur)]);
    return next;
  }

  async getMigration(): Promise<unknown | undefined> {
    return this.backend.get("meta", MIGRATION_KEY);
  }

  // ---------- workspace ----------

  async createWorkspace(a: { name: string; citeStyle?: CiteStyle }): Promise<WorkspaceRec> {
    const ws: WorkspaceRec = {
      ...this.base(),
      name: cleanText(a.name, "Nama ruang kerja", 120),
      citeStyle: a.citeStyle === "Vancouver" ? "Vancouver" : "APA",
      defaultTemplateIds: {},
    };
    await this.write([{ kind: "put", store: "workspaces", key: ws.id, value: ws }]);
    return ws;
  }

  async listWorkspaces(o: { includeArchived?: boolean } = {}): Promise<WorkspaceRec[]> {
    const all = await this.backend.getAll<WorkspaceRec>("workspaces");
    return all.filter((w) => o.includeArchived || !w.archivedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  }

  getWorkspace(id: string): Promise<WorkspaceRec> {
    return this.need<WorkspaceRec>("workspaces", id, "Ruang kerja");
  }

  /** Satu ruang kerja selalu ada, tanpa langkah tambahan bagi pengguna (ADR I1). */
  async ensureDefaultWorkspace(): Promise<WorkspaceRec> {
    const list = await this.listWorkspaces();
    return list[0] ?? (await this.createWorkspace({ name: DEFAULT_WORKSPACE_NAME }));
  }

  async updateWorkspace(
    id: string,
    patch: { name?: string; citeStyle?: CiteStyle; defaultTemplateIds?: Partial<Record<DocType, string | null>> },
    expectedRev?: number
  ): Promise<WorkspaceRec> {
    const ws = await this.getWorkspace(id);
    this.expect(ws, expectedRev, "Ruang kerja");
    const next = this.bump(ws);
    if (patch.name !== undefined) next.name = cleanText(patch.name, "Nama ruang kerja", 120);
    if (patch.citeStyle !== undefined) next.citeStyle = patch.citeStyle === "Vancouver" ? "Vancouver" : "APA";
    if (patch.defaultTemplateIds) {
      const merged = { ...ws.defaultTemplateIds };
      for (const t of DOC_TYPES) {
        const v = patch.defaultTemplateIds[t];
        if (v === undefined) continue;
        if (v === null) delete merged[t];
        else {
          await this.templateIn(id, v, t);
          merged[t] = v;
        }
      }
      next.defaultTemplateIds = merged;
    }
    await this.write([{ kind: "put", store: "workspaces", key: id, value: next }], [this.revGuard("workspaces", ws)]);
    return next;
  }

  async archiveWorkspace(id: string, archived = true): Promise<WorkspaceRec> {
    const ws = await this.getWorkspace(id);
    const next = this.bump(ws);
    if (archived) next.archivedAt = this.deps.now();
    else delete next.archivedAt;
    await this.write([{ kind: "put", store: "workspaces", key: id, value: next }], [this.revGuard("workspaces", ws)]);
    return next;
  }

  /** Hapus permanen satu ruang kerja beserta seluruh isinya. Konfirmasi = mengetik nama persis (ADR bagian 10). */
  async removeWorkspace(id: string, confirm: { name: string }): Promise<{ deleted: Record<string, number> }> {
    const ws = await this.getWorkspace(id);
    if ((confirm?.name ?? "").trim() !== ws.name) throw new StoreError("confirm", "Ketik nama ruang kerja dengan tepat untuk menghapusnya.");
    const ops: Op[] = [{ kind: "delete", store: "workspaces", key: id }];
    const deleted: Record<string, number> = {};
    for (const store of ["cases", "documents", "versions", "sources", "templates"] as const) {
      const rows = await this.inWorkspace<{ id: string; workspaceId: string }>(store, id);
      deleted[store] = rows.length;
      for (const r of rows) ops.push({ kind: "delete", store, key: r.id });
    }
    await this.write(ops, [this.revGuard("workspaces", ws)]);
    return { deleted };
  }

  // ---------- kasus ----------

  private async caseIn(workspaceId: string, caseId: string): Promise<CaseRec> {
    const c = await this.need<CaseRec>("cases", caseId, "Kasus");
    if (c.workspaceId !== workspaceId) throw new StoreError("invalid", "Kasus berada di ruang kerja lain.");
    return c;
  }

  async createCase(workspaceId: string, a: { jenisAsuhan?: string; kasus?: string }): Promise<CaseRec> {
    await this.getWorkspace(workspaceId);
    const c: CaseRec = {
      ...this.base(),
      workspaceId,
      jenisAsuhan: cleanText(a.jenisAsuhan, "Jenis asuhan", 200, false) || undefined,
      kasus: cleanText(a.kasus, "Kasus", 300, false) || undefined,
    };
    await this.write([{ kind: "put", store: "cases", key: c.id, value: c }], [this.existsGuard("workspaces", workspaceId)]);
    return c;
  }

  listCases(workspaceId: string): Promise<CaseRec[]> {
    return this.inWorkspace<CaseRec>("cases", workspaceId).then((l) => l.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }

  getCase(id: string): Promise<CaseRec> {
    return this.need<CaseRec>("cases", id, "Kasus");
  }

  async updateCase(id: string, patch: { jenisAsuhan?: string; kasus?: string }, expectedRev?: number): Promise<CaseRec> {
    const c = await this.getCase(id);
    this.expect(c, expectedRev, "Kasus");
    const next = this.bump(c);
    if (patch.jenisAsuhan !== undefined) next.jenisAsuhan = cleanText(patch.jenisAsuhan, "Jenis asuhan", 200, false) || undefined;
    if (patch.kasus !== undefined) next.kasus = cleanText(patch.kasus, "Kasus", 300, false) || undefined;
    await this.write([{ kind: "put", store: "cases", key: id, value: next }], [this.revGuard("cases", c)]);
    return next;
  }

  /** Hapus kasus: dokumen yang menautnya dilepas (isian yang berlaku disalin dulu); tidak ada dokumen yang ikut terhapus. */
  async removeCase(id: string, confirm: { confirmed?: boolean }): Promise<{ unlinked: string[] }> {
    requireConfirmed(confirm, "Menghapus kasus");
    const c = await this.getCase(id);
    const docs = (await this.inWorkspace<DocumentRec>("documents", c.workspaceId)).filter((d) => d.caseId === id);
    const ops: Op[] = [{ kind: "delete", store: "cases", key: id }];
    const guards: Guard[] = [this.revGuard("cases", c)];
    for (const d of docs) {
      const next = this.bump(d);
      next.head = { ...d.head, input: caseDerivedInput(d.type, d.head.input, sharedCaseFor(d.type, c)) };
      next.caseId = null;
      ops.push({ kind: "put", store: "documents", key: d.id, value: next });
      guards.push(this.revGuard("documents", d));
    }
    await this.write(ops, guards);
    return { unlinked: docs.map((d) => d.id) };
  }

  // ---------- template ----------

  private async templateIn(workspaceId: string, templateId: string, docType?: DocType): Promise<TemplateRec> {
    const t = await this.need<TemplateRec>("templates", templateId, "Template");
    if (t.workspaceId !== workspaceId) throw new StoreError("invalid", "Template berada di ruang kerja lain.");
    if (docType && t.docType !== docType) throw new StoreError("invalid", `Template ini untuk dokumen ${t.docType}, bukan ${docType}.`);
    return t;
  }

  async putTemplate(
    workspaceId: string,
    a: { docType: DocType; name: string; size: number; data: ArrayBuffer; analysis: Analysis; mapping: Mapping; savedAt?: number }
  ): Promise<TemplateRec> {
    await this.getWorkspace(workspaceId);
    if (!DOC_TYPES.includes(a.docType)) throw new StoreError("invalid", "Jenis dokumen tidak dikenal.");
    if (!(a.data instanceof ArrayBuffer) || a.data.byteLength === 0) throw new StoreError("invalid", "Berkas template kosong.");
    const t: TemplateRec = {
      ...this.base(),
      workspaceId,
      docType: a.docType,
      name: cleanText(a.name, "Nama template", 200),
      size: a.data.byteLength,
      savedAt: a.savedAt ?? Date.parse(this.deps.now()),
      data: a.data,
      analysis: a.analysis,
      mapping: a.mapping,
      dataSha256: await this.deps.sha256(new Uint8Array(a.data)),
      mappingSha256: await this.deps.sha256(canonical(a.mapping)),
    };
    await this.write([{ kind: "put", store: "templates", key: t.id, value: t }], [this.existsGuard("workspaces", workspaceId)]);
    return t;
  }

  async listTemplates(workspaceId: string, docType?: DocType): Promise<TemplateRec[]> {
    const l = await this.inWorkspace<TemplateRec>("templates", workspaceId);
    return l.filter((t) => !docType || t.docType === docType).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getTemplate(id: string): Promise<TemplateRec> {
    return this.need<TemplateRec>("templates", id, "Template");
  }

  /** Koreksi pemetaan oleh pengguna (T11). Hash pemetaan dihitung ulang. */
  async updateTemplateMapping(id: string, mapping: Mapping, expectedRev?: number): Promise<TemplateRec> {
    const t = await this.getTemplate(id);
    this.expect(t, expectedRev, "Template");
    const next = { ...this.bump(t), mapping, mappingSha256: await this.deps.sha256(canonical(mapping)) };
    await this.write([{ kind: "put", store: "templates", key: id, value: next }], [this.revGuard("templates", t)]);
    return next;
  }

  /** Hapus template: dokumen yang memakainya kembali ke format bawaan; struktur yang dibangun darinya ikut dikosongkan
   * setelah Version "sebelum-ganti-template" dibuat. */
  async removeTemplate(id: string, confirm: { confirmed?: boolean }): Promise<{ detached: string[] }> {
    requireConfirmed(confirm, "Menghapus template");
    const t = await this.getTemplate(id);
    const ws = await this.getWorkspace(t.workspaceId);
    const docs = (await this.inWorkspace<DocumentRec>("documents", t.workspaceId)).filter((d) => d.templateId === id);
    const ops: Op[] = [{ kind: "delete", store: "templates", key: id }];
    const guards: Guard[] = [this.revGuard("templates", t), this.revGuard("workspaces", ws)];
    for (const d of docs) {
      const { ops: o, guards: g } = await this.detachTemplate(d, true);
      ops.push(...o);
      guards.push(...g);
    }
    const nextWs = this.bump(ws);
    const kept = { ...ws.defaultTemplateIds };
    for (const k of DOC_TYPES) if (kept[k] === id) delete kept[k];
    nextWs.defaultTemplateIds = kept;
    ops.push({ kind: "put", store: "workspaces", key: ws.id, value: nextWs });
    await this.write(ops, guards);
    return { detached: docs.map((d) => d.id) };
  }

  // ---------- sumber ----------

  async createSource(workspaceId: string, draft: SourceDraft): Promise<SourceRec> {
    await this.getWorkspace(workspaceId);
    const rec: SourceRec = {
      ...this.base(),
      ...this.cleanSource(draft),
      workspaceId,
      contentSha256: draft.content ? await this.deps.sha256(draft.content) : null,
    };
    await this.write([{ kind: "put", store: "sources", key: rec.id, value: rec }], [this.existsGuard("workspaces", workspaceId)]);
    return rec;
  }

  private cleanSource(d: SourceDraft): SourceDraft {
    return normalizeSource(d);
  }

  async listSources(workspaceId: string, o: { includeArchived?: boolean } = {}): Promise<SourceRec[]> {
    const l = await this.inWorkspace<SourceRec>("sources", workspaceId);
    return l.filter((s) => o.includeArchived || !s.archivedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getSource(id: string): Promise<SourceRec> {
    return this.need<SourceRec>("sources", id, "Sumber");
  }

  /** Mengubah judul, tahun, penulis, atau DOI membatalkan status "terverifikasi" (data sudah tidak sama dengan yang diverifikasi). */
  async updateSource(id: string, patch: Partial<SourceDraft>, expectedRev?: number): Promise<SourceRec> {
    const s = await this.getSource(id);
    this.expect(s, expectedRev, "Sumber");
    const merged = this.cleanSource({ ...s, ...patch });
    const identityChanged = canonical([s.title, s.year, s.authors, s.doi]) !== canonical([merged.title, merged.year, merged.authors, merged.doi]);
    const next: SourceRec = {
      ...this.bump(s),
      ...merged,
      contentSha256: merged.content ? await this.deps.sha256(merged.content) : null,
      ...(identityChanged && s.verified && patch.verified === undefined ? { verified: false, origin: "manual" as const } : {}),
    };
    await this.write([{ kind: "put", store: "sources", key: id, value: next }], [this.revGuard("sources", s)]);
    return next;
  }

  async archiveSource(id: string, archived = true): Promise<SourceRec> {
    const s = await this.getSource(id);
    const next = this.bump(s);
    if (archived) next.archivedAt = this.deps.now();
    else delete next.archivedAt;
    await this.write([{ kind: "put", store: "sources", key: id, value: next }], [this.revGuard("sources", s)]);
    return next;
  }

  /** Dokumen yang merujuk sumber ini (untuk dialog konfirmasi hapus). */
  async sourceUsage(sourceId: string): Promise<{ documentId: string; title: string; citeKey: string }[]> {
    const s = await this.getSource(sourceId);
    const out: { documentId: string; title: string; citeKey: string }[] = [];
    for (const d of await this.inWorkspace<DocumentRec>("documents", s.workspaceId)) {
      for (const r of d.head.sourceRefs) if (r.sourceId === sourceId) out.push({ documentId: d.id, title: d.title, citeKey: r.citeKey });
    }
    return out;
  }

  /** Hapus permanen. Rujukan di dokumen dicabut; penanda [S#] yang tertinggal di teks akan ditandai "tidak ada di daftar sumber". */
  async removeSource(id: string, confirm: { confirmed?: boolean }): Promise<{ detachedFrom: string[] }> {
    requireConfirmed(confirm, "Menghapus sumber");
    const s = await this.getSource(id);
    const ops: Op[] = [{ kind: "delete", store: "sources", key: id }];
    const guards: Guard[] = [this.revGuard("sources", s)];
    const detachedFrom: string[] = [];
    for (const d of await this.inWorkspace<DocumentRec>("documents", s.workspaceId)) {
      if (!d.head.sourceRefs.some((r) => r.sourceId === id)) continue;
      const next = this.bump(d);
      next.head = { ...d.head, sourceRefs: d.head.sourceRefs.filter((r) => r.sourceId !== id) };
      ops.push({ kind: "put", store: "documents", key: d.id, value: next });
      guards.push(this.revGuard("documents", d));
      detachedFrom.push(d.id);
    }
    await this.write(ops, guards);
    return { detachedFrom };
  }

  // ---------- dokumen ----------

  async createDocument(workspaceId: string, a: { type: DocType; title?: string; caseId?: string | null; templateId?: string | null }): Promise<DocumentRec> {
    const ws = await this.getWorkspace(workspaceId);
    if (ws.archivedAt) throw new StoreError("invalid", "Ruang kerja ini diarsipkan; pulihkan dulu untuk menambah dokumen.");
    if (!DOC_TYPES.includes(a.type)) throw new StoreError("invalid", "Jenis dokumen tidak dikenal.");
    const caseId = a.caseId ?? null;
    if (caseId) await this.caseIn(workspaceId, caseId);
    const templateId = a.templateId !== undefined ? a.templateId : (ws.defaultTemplateIds[a.type] ?? null);
    if (templateId) await this.templateIn(workspaceId, templateId, a.type);
    const doc: DocumentRec = {
      ...this.base(),
      workspaceId,
      type: a.type,
      title: cleanText(a.title, "Judul dokumen", 300, false) || DEFAULT_TITLE[a.type],
      caseId,
      templateId,
      head: emptyHead(),
      citeSeq: 0,
    };
    await this.write([{ kind: "put", store: "documents", key: doc.id, value: doc }], [this.existsGuard("workspaces", workspaceId)]);
    return doc;
  }

  async listDocuments(workspaceId: string, o: { includeArchived?: boolean; type?: DocType } = {}): Promise<DocumentRec[]> {
    const l = await this.inWorkspace<DocumentRec>("documents", workspaceId);
    return l.filter((d) => (o.includeArchived || !d.archivedAt) && (!o.type || d.type === o.type)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getDocument(id: string): Promise<DocumentRec> {
    return this.need<DocumentRec>("documents", id, "Dokumen");
  }

  async renameDocument(id: string, title: string, expectedRev?: number): Promise<DocumentRec> {
    const d = await this.getDocument(id);
    this.expect(d, expectedRev, "Dokumen");
    const next = { ...this.bump(d), title: cleanText(title, "Judul dokumen", 300) };
    await this.write([{ kind: "put", store: "documents", key: id, value: next }], [this.revGuard("documents", d)]);
    return next;
  }

  async archiveDocument(id: string, archived = true): Promise<DocumentRec> {
    const d = await this.getDocument(id);
    const next = this.bump(d);
    if (archived) next.archivedAt = this.deps.now();
    else delete next.archivedAt;
    await this.write([{ kind: "put", store: "documents", key: id, value: next }], [this.revGuard("documents", d)]);
    return next;
  }

  /** Hapus permanen dokumen beserta seluruh Version-nya (Version LK memuat data kasus). */
  async removeDocument(id: string, confirm: { confirmed?: boolean }): Promise<{ versionsDeleted: number }> {
    requireConfirmed(confirm, "Menghapus dokumen");
    const d = await this.getDocument(id);
    const versions = (await this.inWorkspace<VersionRec>("versions", d.workspaceId)).filter((v) => v.documentId === id);
    const ops: Op[] = [{ kind: "delete", store: "documents", key: id }, ...versions.map((v): Op => ({ kind: "delete", store: "versions", key: v.id }))];
    await this.write(ops, [this.revGuard("documents", d)]);
    return { versionsDeleted: versions.length };
  }

  /** Simpan keadaan kerja. Rujukan divalidasi: sumber ada di ruang kerja yang sama, citeKey sah, unik, dan tidak dipakai ulang. */
  async saveHead(id: string, head: DocHead, expectedRev?: number): Promise<DocumentRec> {
    const doc = await this.getDocument(id);
    this.expect(doc, expectedRev, "Dokumen");
    checkHead(head);
    await this.validateRefs(doc, head.sourceRefs, true);
    const next: DocumentRec = { ...this.bump(doc), head, citeSeq: Math.max(doc.citeSeq, maxCite(head.sourceRefs)) };
    await this.write([{ kind: "put", store: "documents", key: id, value: next }], [this.revGuard("documents", doc)]);
    return next;
  }

  private async validateRefs(doc: DocumentRec, refs: SourceRef[], strict: boolean): Promise<void> {
    if (refs.length > MAX_REFS) throw new StoreError("limit", `Satu dokumen maksimal ${MAX_REFS} sumber.`);
    const keys = new Set<string>();
    const ids = new Set<string>();
    for (const r of refs) {
      if (!r || typeof r.citeKey !== "string" || typeof r.sourceId !== "string" || !isCiteKey(r.citeKey)) throw new StoreError("invalid", "Penanda sumber tidak valid.");
      if (keys.has(r.citeKey) || ids.has(r.sourceId)) throw new StoreError("invalid", "Penanda atau sumber ganda di dokumen.");
      keys.add(r.citeKey);
      ids.add(r.sourceId);
      const s = await this.backend.get<SourceRec>("sources", r.sourceId);
      if (!s || s.workspaceId !== doc.workspaceId) throw new StoreError("invalid", "Sumber tidak ada di ruang kerja ini.");
      if (!strict) continue;
      const existing = doc.head.sourceRefs.find((x) => x.citeKey === r.citeKey);
      if (existing) {
        if (existing.sourceId !== r.sourceId) throw new StoreError("invalid", `Penanda ${r.citeKey} sudah dipakai sumber lain dan tidak boleh dialihkan.`);
      } else if (Number(r.citeKey.slice(1)) <= doc.citeSeq) {
        throw new StoreError("invalid", `Penanda ${r.citeKey} pernah dipakai dan tidak boleh dipakai ulang.`);
      }
    }
  }

  /** Tambahkan sumber ke dokumen dengan citeKey berikutnya yang belum pernah dipakai. */
  async addSourceRef(docId: string, sourceId: string, expectedRev?: number): Promise<{ doc: DocumentRec; citeKey: string }> {
    const doc = await this.getDocument(docId);
    this.expect(doc, expectedRev, "Dokumen");
    const s = await this.getSource(sourceId);
    if (s.workspaceId !== doc.workspaceId) throw new StoreError("invalid", "Sumber berada di ruang kerja lain.");
    if (s.archivedAt) throw new StoreError("invalid", "Sumber ini diarsipkan; pulihkan dulu untuk memakainya.");
    if (doc.head.sourceRefs.some((r) => r.sourceId === sourceId)) throw new StoreError("invalid", "Sumber ini sudah ada di dokumen.");
    if (doc.head.sourceRefs.length >= MAX_REFS) throw new StoreError("limit", `Satu dokumen maksimal ${MAX_REFS} sumber.`);
    const n = doc.citeSeq + 1;
    if (n > 999) throw new StoreError("limit", "Nomor penanda sumber sudah habis untuk dokumen ini.");
    const citeKey = `S${n}`;
    const next: DocumentRec = { ...this.bump(doc), head: { ...doc.head, sourceRefs: [...doc.head.sourceRefs, { citeKey, sourceId }] }, citeSeq: n };
    await this.write([{ kind: "put", store: "documents", key: docId, value: next }], [this.revGuard("documents", doc)]);
    return { doc: next, citeKey };
  }

  /** Cabut rujukan. citeSeq tidak turun, jadi penanda ini tidak akan menunjuk sumber lain di kemudian hari. */
  async removeSourceRef(docId: string, citeKey: string, expectedRev?: number): Promise<DocumentRec> {
    const doc = await this.getDocument(docId);
    this.expect(doc, expectedRev, "Dokumen");
    if (!doc.head.sourceRefs.some((r) => r.citeKey === citeKey)) throw new StoreError("not-found", "Rujukan tidak ditemukan.");
    const next: DocumentRec = { ...this.bump(doc), head: { ...doc.head, sourceRefs: doc.head.sourceRefs.filter((r) => r.citeKey !== citeKey) } };
    await this.write([{ kind: "put", store: "documents", key: docId, value: next }], [this.revGuard("documents", doc)]);
    return next;
  }

  // ---------- tautan kasus (opsional, per dokumen) ----------

  /** Isian dokumen saat ini termasuk yang berasal dari kasus (dasar pratinjau dan pelepasan tautan). */
  private async currentInput(doc: DocumentRec): Promise<Input> {
    if (!doc.caseId) return doc.head.input;
    const c = await this.caseIn(doc.workspaceId, doc.caseId);
    return caseDerivedInput(doc.type, doc.head.input, sharedCaseFor(doc.type, c));
  }

  /** Apa yang akan berubah bila dokumen ini ditautkan ke kasus tertentu, dan teks konfirmasinya. */
  async previewLink(docId: string, caseId: string): Promise<{ items: ReuseItem[]; message: string }> {
    const doc = await this.getDocument(docId);
    const c = await this.caseIn(doc.workspaceId, caseId);
    const items = reusePreview(doc.type, await this.currentInput(doc), sharedCaseFor(doc.type, c));
    return { items, message: linkConfirmMessage(doc.type, items) };
  }

  /**
   * Tautkan dokumen ke kasus. Wajib `confirmed: true` (pengguna sudah melihat pratinjau). Bila sebelumnya terhubung ke kasus
   * lain, isian dari kasus lama disalin ke dokumen lebih dulu supaya tidak hilang diam-diam.
   */
  async linkDocument(docId: string, caseId: string, confirm: { confirmed?: boolean }): Promise<DocumentRec> {
    requireConfirmed(confirm, "Menautkan dokumen ke kasus");
    const doc = await this.getDocument(docId);
    const c = await this.caseIn(doc.workspaceId, caseId);
    if (doc.caseId === caseId) return doc;
    const input = await this.currentInput(doc);
    const next: DocumentRec = { ...this.bump(doc), caseId: c.id, head: { ...doc.head, input } };
    await this.write([{ kind: "put", store: "documents", key: docId, value: next }], [this.revGuard("documents", doc), this.existsGuard("cases", c.id)]);
    return next;
  }

  /** Lepas tautan tanpa kehilangan isian: nilai yang sedang berlaku disalin ke dokumen (ADR I4). */
  async unlinkDocument(docId: string): Promise<DocumentRec> {
    const doc = await this.getDocument(docId);
    if (!doc.caseId) return doc;
    const input = await this.currentInput(doc);
    const next: DocumentRec = { ...this.bump(doc), caseId: null, head: { ...doc.head, input } };
    await this.write([{ kind: "put", store: "documents", key: docId, value: next }], [this.revGuard("documents", doc)]);
    return next;
  }

  // ---------- template per dokumen ----------

  private async detachTemplate(doc: DocumentRec, resetStructure: boolean): Promise<{ ops: Op[]; guards: Guard[] }> {
    const ops: Op[] = [];
    const guards: Guard[] = [this.revGuard("documents", doc)];
    let head = doc.head;
    if (resetStructure && doc.head.outline) {
      const v = await this.versionOps(doc, "sebelum-ganti-template");
      ops.push(...v.ops);
      guards.push(...v.guards);
      head = { ...doc.head, outline: null, texts: dropDynamicTexts(doc.head.texts) };
    }
    ops.push({ kind: "put", store: "documents", key: doc.id, value: { ...this.bump(doc), templateId: null, head } });
    return { ops, guards };
  }

  /**
   * Ganti template dokumen. Bila struktur dikosongkan (perilaku yang sudah ada di formulir), Version
   * "sebelum-ganti-template" dibuat lebih dulu supaya pengguna bisa memulihkan.
   */
  async changeTemplate(docId: string, templateId: string | null, o: { resetStructure: boolean }, expectedRev?: number): Promise<DocumentRec> {
    const doc = await this.getDocument(docId);
    this.expect(doc, expectedRev, "Dokumen");
    if (templateId) await this.templateIn(doc.workspaceId, templateId, doc.type);
    const ops: Op[] = [];
    const guards: Guard[] = [this.revGuard("documents", doc)];
    let head = doc.head;
    if (o.resetStructure && doc.head.outline) {
      const v = await this.versionOps(doc, "sebelum-ganti-template");
      ops.push(...v.ops);
      guards.push(...v.guards);
      head = { ...doc.head, outline: null, texts: dropDynamicTexts(doc.head.texts) };
    }
    const next: DocumentRec = { ...this.bump(doc), templateId, head };
    ops.push({ kind: "put", store: "documents", key: docId, value: next });
    await this.write(ops, guards);
    return next;
  }

  // ---------- versi ----------

  async listVersions(docId: string): Promise<VersionRec[]> {
    const doc = await this.getDocument(docId);
    return (await this.inWorkspace<VersionRec>("versions", doc.workspaceId)).filter((v) => v.documentId === docId).sort((a, b) => a.seq - b.seq);
  }

  private async snapshotInputs(doc: DocumentRec): Promise<Pick<BuildVersionArgs, "sources" | "template">> {
    const sources: SourceRec[] = [];
    for (const r of doc.head.sourceRefs) {
      const s = await this.backend.get<SourceRec>("sources", r.sourceId);
      if (s) sources.push(s);
    }
    const template = doc.templateId ? ((await this.backend.get<TemplateRec>("templates", doc.templateId)) ?? null) : null;
    return { sources, template };
  }

  /** Operasi untuk membuat satu Version (plus pemangkasan). Nomor urut berasal dari Version terakhir; guard "absent" menjaga tabrakan antar tab. */
  private async versionOps(doc: DocumentRec, reason: VersionReason): Promise<{ version: VersionRec; ops: Op[]; guards: Guard[] }> {
    const versions = await this.listVersions(doc.id);
    const seq = (versions[versions.length - 1]?.seq ?? 0) + 1;
    const version = await buildVersion(this.deps, { doc, reason, seq, ...(await this.snapshotInputs(doc)) });
    return {
      version,
      ops: [{ kind: "put", store: "versions", key: version.id, value: version }, ...pruneOps([...versions, version])],
      guards: [{ store: "versions", key: version.id, absent: true }],
    };
  }

  async createVersion(docId: string, reason: VersionReason = "manual"): Promise<VersionRec> {
    for (let attempt = 0; ; attempt++) {
      const doc = await this.getDocument(docId);
      const v = await this.versionOps(doc, reason);
      try {
        await this.write(v.ops, [...v.guards, this.existsGuard("documents", docId)]);
        return v.version;
      } catch (e) {
        if (e instanceof StoreError && e.code === "conflict" && attempt < 2) continue; // tab lain memakai nomor yang sama
        throw e;
      }
    }
  }

  /**
   * Pulihkan: Version "sebelum-pulihkan" dari keadaan sekarang dibuat lebih dulu, lalu isi Version disalin ke dokumen.
   * Rujukan ke sumber yang sudah dihapus dilepas (dilaporkan di `dropped`); citeSeq tidak pernah turun.
   */
  async restoreVersion(docId: string, versionId: string, expectedRev?: number): Promise<{ doc: DocumentRec; dropped: SourceRef[] }> {
    const doc = await this.getDocument(docId);
    this.expect(doc, expectedRev, "Dokumen");
    const v = await this.need<VersionRec>("versions", versionId, "Versi");
    if (v.documentId !== docId) throw new StoreError("not-found", "Versi tidak ditemukan.");
    if ((await contentHash(v.content, this.deps)) !== v.contentSha256) throw new StoreError("integrity", "Isi versi ini rusak (hash tidak cocok); tidak dipulihkan.");
    const kept: SourceRef[] = [];
    const dropped: SourceRef[] = [];
    for (const r of v.content.sourceRefs) {
      const s = await this.backend.get<SourceRec>("sources", r.sourceId);
      if (s && s.workspaceId === doc.workspaceId) kept.push(r);
      else dropped.push(r);
    }
    const before = await this.versionOps(doc, "sebelum-pulihkan");
    // Version yang sedang dipulihkan tidak boleh ikut terpangkas oleh pemangkasan yang menyertainya.
    const beforeOps = before.ops.filter((o) => !(o.kind === "delete" && o.key === versionId));
    const next: DocumentRec = {
      ...this.bump(doc),
      head: { ...doc.head, input: v.content.input, texts: v.content.texts, outline: v.content.outline, sourceRefs: kept },
      citeSeq: Math.max(doc.citeSeq, maxCite(v.content.sourceRefs)),
    };
    await this.write([...beforeOps, { kind: "put", store: "documents", key: docId, value: next }], [...before.guards, this.revGuard("documents", doc)]);
    return { doc: next, dropped };
  }

  // ---------- bahan untuk generator ----------

  /**
   * Semua yang dibutuhkan generator, dan hanya itu (ADR I2): isian efektif (identitas < usulan kasus < isian dokumen < kasus
   * bila terhubung), sumber dengan id = citeKey, gaya rujukan, dan template. Format `input` dan `sources` sama persis dengan
   * yang dikirim klien ke /api/generate dan /api/docx hari ini (I8).
   */
  async resolveForGeneration(docId: string): Promise<{
    doc: DocumentRec;
    input: Input;
    sources: Source[];
    citeStyle: CiteStyle;
    template: TemplateRec | null;
    caseRec: CaseRec | null;
  }> {
    const doc = await this.getDocument(docId);
    const ws = await this.getWorkspace(doc.workspaceId);
    const profile = await this.getProfile();
    const caseRec = doc.caseId ? await this.caseIn(doc.workspaceId, doc.caseId) : null;
    const sources: Source[] = [];
    for (const r of doc.head.sourceRefs) {
      const s = await this.backend.get<SourceRec>("sources", r.sourceId);
      if (s) sources.push(toApiSource(s, r.citeKey));
    }
    const template = doc.templateId ? await this.templateIn(doc.workspaceId, doc.templateId, doc.type) : null;
    return {
      doc,
      input: buildInput(doc.type, doc.head.input, profile.identity, sharedCaseFor(doc.type, caseRec)),
      sources,
      citeStyle: ws.citeStyle,
      template,
      caseRec,
    };
  }
}
