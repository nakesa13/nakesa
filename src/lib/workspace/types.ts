import type { CiteStyle, DocType, Identity, Input, Source } from "../types";
import type { OutlineItem } from "../outline";
import type { Analysis, Mapping } from "../template/types";

/**
 * T06: model data penyimpanan lokal v2 (lihat docs/architecture/ADR-workspace-case-documents.md, bagian 3).
 * Tanpa React dan tanpa API peramban: dipakai bersama oleh penyimpanan lokal sekarang dan skema cloud nanti.
 */

export const SCHEMA_VERSION = 1;
export const LOCAL_OWNER = "local";
/** Batas rujukan per dokumen; sama dengan batas parseSources di server. */
export const MAX_REFS = 40;
export const MAX_VERSIONS = 20;

export type StoreCode = "conflict" | "not-found" | "invalid" | "confirm" | "integrity" | "read-only" | "limit";

export class StoreError extends Error {
  constructor(
    public code: StoreCode,
    message: string
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export interface Base {
  /** UUID (kecuali Version: `${documentId}:${seq}`). */
  id: string;
  /** Lokal: "local". Cloud: id pengguna dari sesi (server yang menetapkan). */
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /** Naik 1 setiap tulis; dipakai untuk mendeteksi tulis yang bertabrakan. */
  rev: number;
}

/** Identitas pengguna (bukan milik workspace). id selalu "profile". */
export interface ProfileRec extends Base {
  identity: Identity;
}

export interface WorkspaceRec extends Base {
  name: string;
  citeStyle: CiteStyle;
  defaultTemplateIds: Partial<Record<DocType, string>>;
  archivedAt?: string;
}

/** Kasus bersama. Hanya metadata topik; TIDAK PERNAH data pasien (ADR I6). */
export interface CaseRec extends Base {
  workspaceId: string;
  jenisAsuhan?: string;
  kasus?: string;
}

export interface SourceRef {
  /** "S1", "S2", ...: penanda [S#] di teks dan id yang dikirim ke server. Tidak pernah dipakai ulang di satu dokumen. */
  citeKey: string;
  sourceId: string;
}

export interface DocHead {
  input: Input;
  texts: Record<string, string>;
  outline: OutlineItem[] | null;
  step: number;
  sourceRefs: SourceRef[];
}

export interface DocumentRec extends Base {
  workspaceId: string;
  type: DocType;
  title: string;
  caseId: string | null;
  templateId: string | null;
  head: DocHead;
  /** Angka tertinggi yang pernah dipakai untuk citeKey. Tidak turun saat rujukan dihapus atau versi dipulihkan. */
  citeSeq: number;
  archivedAt?: string;
}

export type VersionReason = "manual" | "ekspor" | "sebelum-pulihkan" | "sebelum-ganti-template" | "migrasi";
export const PROTECTED_REASONS: readonly VersionReason[] = ["manual", "migrasi"];

/** Metadata sumber tanpa isi (isi besar tetap di SourceRec; hash-nya dicatat). */
export type SourceMeta = Omit<Source, "id" | "content">;

export interface VersionContent {
  input: Input;
  texts: Record<string, string>;
  outline: OutlineItem[] | null;
  sourceRefs: SourceRef[];
}

/** Snapshot tak berubah. id = `${documentId}:${seq}` supaya dua tab tidak bisa membuat nomor yang sama. */
export interface VersionRec {
  id: string;
  ownerId: string;
  workspaceId: string;
  documentId: string;
  seq: number;
  reason: VersionReason;
  createdAt: string;
  content: VersionContent;
  sourceSnapshot: Record<string, { source: SourceMeta; contentSha256: string | null }>;
  templateRef: { templateId: string; dataSha256: string; mappingSha256: string } | null;
  contentSha256: string;
  schemaVersion: number;
}

export type SourceDraft = Omit<Source, "id">;

export interface SourceRec extends Base, SourceDraft {
  workspaceId: string;
  contentSha256: string | null;
  archivedAt?: string;
}

export interface TemplateRec extends Base {
  workspaceId: string;
  docType: DocType;
  name: string;
  size: number;
  savedAt: number;
  data: ArrayBuffer;
  analysis: Analysis;
  mapping: Mapping;
  dataSha256: string;
  mappingSha256: string;
}

export const DOC_TYPES: readonly DocType[] = ["LP", "LK", "RJ"];
