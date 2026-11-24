import type { CiteStyle, DocType, Identity, Input } from "../types";
import { lpTitleFor } from "../kasus";
import type { OutlineItem } from "../outline";
import type { Analysis, Mapping } from "../template/types";
import type { Backend, Op } from "./backend";
import type { StoreDeps } from "./deps";
import { canonical } from "./hash";
import { buildVersion, isCiteKey, maxCite } from "./snapshot";
import { DEFAULT_TITLE, DEFAULT_WORKSPACE_NAME, MIGRATION_KEY, PROFILE_ID, normalizeSource } from "./store";
import {
  DOC_TYPES,
  MAX_REFS,
  StoreError,
  type Base,
  type CaseRec,
  type DocumentRec,
  type ProfileRec,
  type SourceDraft,
  type SourceRec,
  type SourceRef,
  type TemplateRec,
  type VersionRec,
  type WorkspaceRec,
} from "./types";

/**
 * T06: migrasi key lokal v1 (localStorage `nakesa.*` + IndexedDB `nakesa`) ke v2 (IndexedDB `nakesa-v2`).
 * Aturan (ADR bagian 9):
 *  - Hanya MEMBACA data lama (snapshot di memori). Tidak ada yang ditulis, diubah, atau dihapus di v1.
 *  - Satu batch atomik + penanda `migration:v1->v2` di batch yang sama: idempoten dan tidak pernah setengah jadi.
 *  - JSON rusak tidak ditimpa nilai awal: string mentahnya disimpan di `meta` (quarantine:*) dan bagian itu dimulai kosong.
 *  - Sumber hanya disatukan bila isinya identik persis; selain itu keduanya dipertahankan.
 */

/** Isi mentah data lama. Pembacaan dari peramban ada di legacy.ts; di sini hanya data, supaya mudah diuji. */
export interface LegacyTemplate {
  name: unknown;
  size: unknown;
  data: unknown;
  analysis: unknown;
  mapping: unknown;
  savedAt: unknown;
}

export interface LegacySnapshot {
  /** String JSON mentah dari `nakesa.settings`, dst. null = kunci tidak ada. */
  settings: string | null;
  case: string | null;
  library: string | null;
  drafts: Partial<Record<DocType, string | null>>;
  templates: Partial<Record<DocType, LegacyTemplate | null>>;
}

export interface MigrationSummary {
  workspaceId: string;
  documents: number;
  skippedEmptyDrafts: number;
  cases: number;
  sources: number;
  sourcesMerged: number;
  templates: number;
  versions: number;
  quarantined: string[];
  warnings: string[];
  /** Jenis dokumen yang di v1 bertanda "terhubung" tetapi tidak punya draf, jadi tidak ada dokumen untuk ditautkan. */
  linkedWithoutDocument: DocType[];
}

export interface MigrationPlan {
  ops: Op[];
  summary: MigrationSummary;
  /** Kode akses perangkat; TIDAK ditulis ke nakesa-v2. Pemanggil menyimpannya ke kunci perangkat. */
  accessCode: string;
}

export type MigrationResult = { status: "migrated"; summary: MigrationSummary; accessCode: string } | { status: "skipped"; reason: "sudah-selesai" };

interface Quarantine {
  key: string;
  raw: string;
  reason: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isArrayBuffer = (v: unknown): v is ArrayBuffer => Object.prototype.toString.call(v) === "[object ArrayBuffer]";
const strOr = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

function parseJson(key: string, raw: string | null | undefined, q: Quarantine[]): unknown {
  if (raw === null || raw === undefined || raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    q.push({ key, raw, reason: "JSON rusak" });
    return undefined;
  }
}

interface LegacyDraft {
  input: Input;
  texts: Record<string, string>;
  outline: OutlineItem[] | null;
  step: number;
  sources: { legacyId: string; draft: SourceDraft }[];
}

function stringsOnly(v: unknown): { out: Record<string, string>; dropped: number } {
  const out: Record<string, string> = {};
  let dropped = 0;
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string") out[k] = x;
      else dropped += 1;
    }
  }
  return { out, dropped };
}

function parseLegacySource(v: unknown): { legacyId: string; draft: SourceDraft } | null {
  if (!isObj(v)) return null;
  try {
    return { legacyId: typeof v.id === "string" ? v.id : "", draft: normalizeSource(v as unknown as SourceDraft) };
  } catch (e) {
    if (e instanceof StoreError) return null;
    throw e;
  }
}

function parseDraft(type: DocType, raw: string | null | undefined, q: Quarantine[], warnings: string[]): LegacyDraft | null {
  const key = `nakesa.draft.${type}`;
  const v = parseJson(key, raw, q);
  if (v === undefined) return null;
  if (!isObj(v)) {
    q.push({ key, raw: raw ?? "", reason: "bentuk tidak dikenal" });
    return null;
  }
  const input = stringsOnly(v.input);
  const texts = stringsOnly(v.texts);
  if (input.dropped + texts.dropped) warnings.push(`${key}: ${input.dropped + texts.dropped} isian bukan teks tidak dibawa.`);
  const sources: LegacyDraft["sources"] = [];
  if (Array.isArray(v.sources)) {
    for (const s of v.sources) {
      const p = parseLegacySource(s);
      if (p) sources.push(p);
      else q.push({ key: `${key}#sources`, raw: JSON.stringify(s) ?? "", reason: "sumber tidak sah" });
    }
  }
  const outline = Array.isArray(v.outline) ? (v.outline.filter(isObj) as unknown as OutlineItem[]) : null;
  const step = typeof v.step === "number" && Number.isInteger(v.step) && v.step >= 0 && v.step <= 100 ? v.step : 0;
  return { input: input.out, texts: texts.out, outline, step, sources };
}

const isEmptyDraft = (d: LegacyDraft): boolean =>
  d.sources.length === 0 && !d.outline?.length && Object.values(d.input).every((x) => !x.trim()) && Object.values(d.texts).every((x) => !x.trim());

/** Judul tampilan: judul isian > judul jurnal (RJ) > judul LP dari kasus > nama bawaan. */
function titleFor(type: DocType, input: Input, c: CaseRec | null): string {
  const own = (input.judul ?? "").trim();
  if (own) return own.slice(0, 300);
  if (type === "RJ" && (input.j_title ?? "").trim()) return input.j_title.trim().slice(0, 300);
  if (type === "LP") {
    const t = lpTitleFor(c ? (c.jenisAsuhan ?? "") : (input.jenis_asuhan ?? ""), c ? (c.kasus ?? "") : (input.kasus ?? ""));
    if (t) return t.slice(0, 300);
  }
  return DEFAULT_TITLE[type];
}

export async function planMigration(legacy: LegacySnapshot, deps: StoreDeps, o: { skipProfile?: boolean } = {}): Promise<MigrationPlan> {
  const q: Quarantine[] = [];
  const warnings: string[] = [];
  const t0 = Number.isNaN(Date.parse(deps.now())) ? Date.now() : Date.parse(deps.now());
  let tick = 0;
  const stamp = () => new Date(t0 + tick++).toISOString(); // urutan tampil yang tetap
  const nowIso = deps.now();
  const owner = deps.ownerId;
  const base = (): Base => {
    const t = stamp();
    return { id: deps.newId(), ownerId: owner, createdAt: t, updatedAt: t, rev: 1 };
  };

  // ---- pengaturan ----
  const sv = parseJson("nakesa.settings", legacy.settings, q);
  const sObj = isObj(sv) ? sv : {};
  if (sv !== undefined && !isObj(sv)) q.push({ key: "nakesa.settings", raw: legacy.settings ?? "", reason: "bentuk tidak dikenal" });
  const identity: Identity = {
    nama: strOr(sObj.nama, ""),
    nim: strOr(sObj.nim, ""),
    prodi: strOr(sObj.prodi, ""),
    kampus: strOr(sObj.kampus, ""),
    pembimbing: strOr(sObj.pembimbing, ""),
    tahun: strOr(sObj.tahun, String(new Date(t0).getUTCFullYear())),
  };
  const citeStyle: CiteStyle = sObj.style === "Vancouver" ? "Vancouver" : "APA";
  const accessCode = strOr(sObj.accessCode, "");

  // ---- kasus bersama ----
  const cv = parseJson("nakesa.case", legacy.case, q);
  const cObj = isObj(cv) ? cv : null;
  if (cv !== undefined && !cObj) q.push({ key: "nakesa.case", raw: legacy.case ?? "", reason: "bentuk tidak dikenal" });
  const linkedMap: Record<string, unknown> = cObj && isObj(cObj.linked) ? cObj.linked : {};
  const linkedTypes = DOC_TYPES.filter((t) => linkedMap[t] === true);
  const jenis = cObj ? strOr(cObj.jenis_asuhan, "").trim() : "";
  const kasus = cObj ? strOr(cObj.kasus, "").trim() : "";

  // ---- rekaman ----
  const ws: WorkspaceRec = { ...base(), name: DEFAULT_WORKSPACE_NAME, citeStyle, defaultTemplateIds: {} };
  const ops: Op[] = [];
  const put = (store: Op["store"], rec: { id: string }) => ops.push({ kind: "put", store, key: rec.id, value: rec });

  let caseRec: CaseRec | null = null;
  if (cObj && (jenis || kasus || linkedTypes.length)) {
    caseRec = { ...base(), workspaceId: ws.id, jenisAsuhan: jenis || undefined, kasus: kasus || undefined };
  }

  // ---- template ----
  const templates: Partial<Record<DocType, TemplateRec>> = {};
  const templateFingerprint: Record<string, unknown> = {};
  for (const type of DOC_TYPES) {
    const lt = legacy.templates[type];
    if (!lt) continue;
    const ok = isArrayBuffer(lt.data) && lt.data.byteLength > 0 && isObj(lt.analysis) && isObj(lt.mapping);
    if (!ok) {
      warnings.push(`Template ${type} di data lama tidak sah dan tidak dibawa (data lama tetap utuh).`);
      continue;
    }
    const data = lt.data as ArrayBuffer;
    const rec: TemplateRec = {
      ...base(),
      workspaceId: ws.id,
      docType: type,
      name: strOr(lt.name, "").trim().slice(0, 200) || "template.docx",
      size: data.byteLength,
      savedAt: typeof lt.savedAt === "number" ? lt.savedAt : t0,
      data,
      analysis: lt.analysis as Analysis,
      mapping: lt.mapping as Mapping,
      dataSha256: await deps.sha256(new Uint8Array(data)),
      mappingSha256: await deps.sha256(canonical(lt.mapping)),
    };
    templates[type] = rec;
    ws.defaultTemplateIds[type] = rec.id;
    templateFingerprint[type] = { name: rec.name, size: rec.size, data: rec.dataSha256, mapping: rec.mappingSha256 };
  }

  // ---- sumber & dokumen ----
  const sourceByKey = new Map<string, SourceRec>(); // isi identik -> satu Source
  const sourceRecs: SourceRec[] = [];
  let merged = 0;
  const makeSource = async (draft: SourceDraft, avoid?: Set<string>): Promise<SourceRec> => {
    const key = canonical(draft);
    const hit = sourceByKey.get(key);
    if (hit && !avoid?.has(hit.id)) {
      merged += 1;
      return hit;
    }
    const rec: SourceRec = { ...base(), ...draft, workspaceId: ws.id, contentSha256: draft.content ? await deps.sha256(draft.content) : null };
    if (!hit) sourceByKey.set(key, rec);
    sourceRecs.push(rec);
    return rec;
  };

  const docs: DocumentRec[] = [];
  const versions: VersionRec[] = [];
  let skipped = 0;
  const docTypesWithDraft = new Set<DocType>();

  for (const type of DOC_TYPES) {
    const d = parseDraft(type, legacy.drafts[type], q, warnings);
    if (!d) continue;
    if (isEmptyDraft(d)) {
      skipped += 1;
      continue;
    }
    docTypesWithDraft.add(type);
    const refs: SourceRef[] = [];
    const usedIds = new Set<string>();
    const usedKeys = new Set<string>();
    let seq = 0;
    for (const s of d.sources) if (isCiteKey(s.legacyId)) seq = Math.max(seq, Number(s.legacyId.slice(1)));
    for (const s of d.sources) {
      const rec = await makeSource(s.draft, usedIds);
      let citeKey = s.legacyId;
      if (!isCiteKey(citeKey) || usedKeys.has(citeKey)) {
        citeKey = `S${++seq}`;
        warnings.push(`${type}: sumber "${rec.title.slice(0, 60)}" mendapat penanda baru ${citeKey} (penanda lama tidak sah atau ganda).`);
      }
      if (seq > 999 || refs.length >= MAX_REFS) {
        warnings.push(`${type}: sumber "${rec.title.slice(0, 60)}" tidak dirujuk dari dokumen (melebihi batas), tetap ada di pustaka.`);
        continue;
      }
      usedIds.add(rec.id);
      usedKeys.add(citeKey);
      refs.push({ citeKey, sourceId: rec.id });
    }
    const template = templates[type] ?? null;
    const doc: DocumentRec = {
      ...base(),
      workspaceId: ws.id,
      type,
      title: titleFor(type, d.input, linkedTypes.includes(type) ? caseRec : null),
      caseId: linkedTypes.includes(type) && caseRec ? caseRec.id : null,
      templateId: template?.id ?? null,
      head: { input: d.input, texts: d.texts, outline: d.outline, step: d.step, sourceRefs: refs },
      citeSeq: Math.max(seq, maxCite(refs)),
    };
    docs.push(doc);
    const refSources = refs.map((r) => sourceRecs.find((s) => s.id === r.sourceId)).filter((s): s is SourceRec => !!s);
    versions.push(await buildVersion(deps, { doc, reason: "migrasi", seq: 1, sources: refSources, template }));
  }

  // ---- pustaka ----
  const lv = parseJson("nakesa.library", legacy.library, q);
  if (lv !== undefined && !Array.isArray(lv)) q.push({ key: "nakesa.library", raw: legacy.library ?? "", reason: "bentuk tidak dikenal" });
  if (Array.isArray(lv)) {
    for (const s of lv) {
      const p = parseLegacySource(s);
      if (p) await makeSource(p.draft);
      else q.push({ key: "nakesa.library#item", raw: JSON.stringify(s) ?? "", reason: "sumber tidak sah" });
    }
  }

  // ---- susun operasi ----
  put("workspaces", ws);
  if (caseRec) put("cases", caseRec);
  for (const t of Object.values(templates)) if (t) put("templates", t);
  for (const s of sourceRecs) put("sources", s);
  for (const d of docs) put("documents", d);
  for (const v of versions) put("versions", v);
  if (!o.skipProfile) {
    const t = nowIso;
    const profile: ProfileRec = { id: PROFILE_ID, ownerId: owner, createdAt: t, updatedAt: t, rev: 1, identity };
    ops.push({ kind: "put", store: "meta", key: PROFILE_ID, value: profile });
  }
  q.forEach((x, i) => ops.push({ kind: "put", store: "meta", key: `quarantine:${i + 1}`, value: { ...x, at: nowIso } }));

  const summary: MigrationSummary = {
    workspaceId: ws.id,
    documents: docs.length,
    skippedEmptyDrafts: skipped,
    cases: caseRec ? 1 : 0,
    sources: sourceRecs.length,
    sourcesMerged: merged,
    templates: Object.keys(templates).length,
    versions: versions.length,
    quarantined: q.map((x) => `${x.key}: ${x.reason}`),
    warnings,
    linkedWithoutDocument: linkedTypes.filter((t) => !docTypesWithDraft.has(t)),
  };

  const legacySha256 = await deps.sha256(canonical({ settings: legacy.settings, case: legacy.case, library: legacy.library, drafts: legacy.drafts, templates: templateFingerprint }));
  ops.push({ kind: "put", store: "meta", key: MIGRATION_KEY, value: { done: true, at: nowIso, legacySha256, summary } });
  return { ops, summary, accessCode };
}

/**
 * Jalankan migrasi. Aman dipanggil berulang dan dari beberapa tab: penanda diperiksa di dalam batch yang sama
 * dengan penulisan data, jadi hanya satu pemanggil yang menang dan tidak ada keadaan setengah jadi.
 */
export async function migrateV1ToV2(backend: Backend, legacy: LegacySnapshot, deps: StoreDeps): Promise<MigrationResult> {
  if (await backend.get("meta", MIGRATION_KEY)) return { status: "skipped", reason: "sudah-selesai" };
  const plan = await planMigration(legacy, deps, { skipProfile: !!(await backend.get("meta", PROFILE_ID)) });
  try {
    await backend.batch(plan.ops, [{ store: "meta", key: MIGRATION_KEY, absent: true }]);
  } catch (e) {
    if (e instanceof StoreError && e.code === "conflict") return { status: "skipped", reason: "sudah-selesai" };
    throw e;
  }
  return { status: "migrated", summary: plan.summary, accessCode: plan.accessCode };
}
