import type { Mapping } from "./types";

/**
 * T11: identitas, versi, dan pemetaan template yang dipakai sebuah dokumen. Disimpan bersama dokumen (Draft.template),
 * bukan hanya di penyimpanan template, supaya dokumen tahu template mana yang dipakai dan apakah template itu berubah sesudahnya.
 * Sesuai ADR T05: id = hash isi template (dataSha256), pemetaan di-hash terpisah (mappingSha256).
 * Murni (memakai Web Crypto, tersedia di peramban dan Node), tanpa node:*.
 */
export interface TemplateRef {
  /** SHA-256 byte .docx (heksadesimal). Template yang sama persis = id yang sama. */
  templateId: string;
  name: string;
  size: number;
  /** Naik 1 setiap kali template diganti atau pemetaannya diubah pengguna. */
  version: number;
  /** SHA-256 dari pemetaan (JSON urut kunci). */
  mappingSha256: string;
  /** Salinan pemetaan yang dipakai dokumen ini. */
  mapping: Mapping;
}

/** Bentuk minimal yang dibutuhkan; StoredTemplate memenuhinya. */
export interface RefSource {
  name: string;
  size: number;
  data: ArrayBuffer;
  mapping: Mapping;
  templateId?: string;
  version?: number;
}

/** JSON dengan kunci objek berurutan, supaya hash tidak bergantung pada urutan penyusunan. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mappingSha256(m: Mapping): Promise<string> {
  return sha256Hex(new TextEncoder().encode(stableJson(m)).buffer as ArrayBuffer);
}

/** Rujukan template untuk disimpan di dokumen. Template lama tanpa id dihitung dari byte-nya; versi bawaan 1. */
export async function makeRef(rec: RefSource): Promise<TemplateRef> {
  return {
    templateId: rec.templateId || (await sha256Hex(rec.data)),
    name: rec.name,
    size: rec.size,
    version: rec.version && rec.version > 0 ? rec.version : 1,
    mappingSha256: await mappingSha256(rec.mapping),
    mapping: rec.mapping,
  };
}

/** Dua rujukan menunjuk template, versi, dan pemetaan yang sama (null/undefined sama-sama berarti "tanpa template"). */
export function sameRef(a: TemplateRef | null | undefined, b: TemplateRef | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.templateId === b.templateId && a.version === b.version && a.mappingSha256 === b.mappingSha256;
}
