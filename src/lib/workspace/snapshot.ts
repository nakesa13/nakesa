import type { Source } from "../types";
import type { Op } from "./backend";
import type { StoreDeps } from "./deps";
import { canonical } from "./hash";
import {
  MAX_VERSIONS,
  PROTECTED_REASONS,
  SCHEMA_VERSION,
  type DocumentRec,
  type SourceDraft,
  type SourceMeta,
  type SourceRec,
  type SourceRef,
  type TemplateRec,
  type VersionContent,
  type VersionReason,
  type VersionRec,
} from "./types";

const CITE_RE = /^S(\d{1,3})$/;

export const isCiteKey = (k: string): boolean => CITE_RE.test(k);
export const citeNum = (k: string): number => Number(CITE_RE.exec(k)?.[1] ?? 0);
export const maxCite = (refs: readonly SourceRef[]): number => refs.reduce((m, r) => Math.max(m, citeNum(r.citeKey)), 0);

/** Metadata sumber tanpa isi. Daftar field ditulis eksplisit agar field baru di Source tidak terbawa tanpa disengaja. */
export function pickSourceMeta(s: SourceDraft): SourceMeta {
  return {
    type: s.type,
    title: s.title,
    authors: s.authors,
    year: s.year,
    publisher: s.publisher,
    edition: s.edition,
    journal: s.journal,
    volume: s.volume,
    issue: s.issue,
    pages: s.pages,
    doi: s.doi,
    url: s.url,
    origin: s.origin,
    verified: s.verified,
    provenance: s.provenance,
  };
}

/** Bentuk yang dikirim ke server: id = citeKey (S1...), persis format parseSources. */
export function toApiSource(rec: SourceRec, citeKey: string): Source {
  return { id: citeKey, ...pickSourceMeta(rec), content: rec.content };
}

/** Salinan isi dokumen yang masuk Version. */
export function contentOf(doc: DocumentRec): VersionContent {
  return {
    input: doc.head.input,
    texts: doc.head.texts,
    outline: doc.head.outline,
    sourceRefs: doc.head.sourceRefs,
  };
}

export async function contentHash(content: VersionContent, deps: StoreDeps): Promise<string> {
  return deps.sha256(canonical(content));
}

export interface BuildVersionArgs {
  doc: DocumentRec;
  reason: VersionReason;
  seq: number;
  /** Sumber yang dirujuk dokumen (yang tidak ditemukan dilewati). */
  sources: SourceRec[];
  template: TemplateRec | null;
}

export async function buildVersion(deps: StoreDeps, a: BuildVersionArgs): Promise<VersionRec> {
  const { doc } = a;
  const byId = new Map(a.sources.map((s) => [s.id, s]));
  const sourceSnapshot: VersionRec["sourceSnapshot"] = {};
  for (const ref of doc.head.sourceRefs) {
    const s = byId.get(ref.sourceId);
    if (s) sourceSnapshot[ref.citeKey] = { source: pickSourceMeta(s), contentSha256: s.contentSha256 };
  }
  const content = contentOf(doc);
  return {
    id: `${doc.id}:${a.seq}`,
    ownerId: doc.ownerId,
    workspaceId: doc.workspaceId,
    documentId: doc.id,
    seq: a.seq,
    reason: a.reason,
    createdAt: deps.now(),
    content,
    sourceSnapshot,
    templateRef: a.template ? { templateId: a.template.id, dataSha256: a.template.dataSha256, mappingSha256: a.template.mappingSha256 } : null,
    contentSha256: await contentHash(content, deps),
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * Operasi hapus untuk memangkas Version tertua yang tidak dilindungi sampai jumlahnya <= MAX_VERSIONS.
 * `versions` harus sudah memuat Version baru.
 */
export function pruneOps(versions: readonly VersionRec[]): Op[] {
  const sorted = [...versions].sort((a, b) => a.seq - b.seq);
  let excess = sorted.length - MAX_VERSIONS;
  const ops: Op[] = [];
  for (const v of sorted) {
    if (excess <= 0) break;
    if (PROTECTED_REASONS.includes(v.reason)) continue;
    ops.push({ kind: "delete", store: "versions", key: v.id });
    excess -= 1;
  }
  return ops;
}
