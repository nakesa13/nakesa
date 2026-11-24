import type { DoiCheck, Provenance } from "./types";

/**
 * T04: provenance sumber dan pemeriksaan kecocokan DOI dengan isi. Murni (tanpa node:*), aman dipakai di klien dan server.
 */

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "has", "have", "its", "into", "than", "between",
  "dan", "yang", "pada", "dengan", "untuk", "dari", "dalam", "oleh", "atau", "serta", "terhadap", "di", "ke", "ini", "itu",
]);

function tokens(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Seberapa awal isi file/halaman yang dibandingkan dengan judul dari metadata DOI. */
export const DOI_CHECK_HEAD_CHARS = 6000;

/**
 * DOI yang sah di Crossref belum berarti isi file itu adalah artikelnya (halaman depan bisa mengutip DOI artikel lain).
 * Dibandingkan: proporsi kata judul metadata yang muncul di bagian awal isi.
 * >= 80% = cocok; < 50% = tidak cocok; di antaranya, atau judul terlalu pendek/bukan huruf Latin = tidak dapat dinilai.
 * Hasil ini petunjuk untuk pengguna, bukan bukti; "cocok" tidak menjamin dan "tidak-dapat-dinilai" tidak boleh dianggap cocok.
 */
export function doiContentCheck(title: string, text: string): DoiCheck {
  const want = [...new Set(tokens(title))];
  if (want.length < 3) return "tidak-dapat-dinilai";
  const have = new Set(tokens(text.slice(0, DOI_CHECK_HEAD_CHARS)));
  const ratio = want.filter((t) => have.has(t)).length / want.length;
  if (ratio >= 0.8) return "cocok";
  if (ratio < 0.5) return "tidak-cocok";
  return "tidak-dapat-dinilai";
}

/** Nama berkas dari pengguna: buang path dan karakter kontrol, batasi panjang. */
export function cleanFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001F\u007F]/g, "").split(/[\\/]/).pop()!.trim().slice(0, 120);
}

const DOI_CHECKS: DoiCheck[] = ["cocok", "tidak-cocok", "tidak-dapat-dinilai"];

/** Baca provenance dari data tidak tepercaya (klien): hanya bentuk yang dikenal, dengan batas panjang. */
export function parseProvenance(v: unknown): Provenance | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const p = v as Record<string, unknown>;
  if (p.method !== "doi" && p.method !== "url" && p.method !== "file") return undefined;
  const str = (k: string, max: number) => (typeof p[k] === "string" && p[k] ? (p[k] as string).slice(0, max) : undefined);
  const fetchedAt = str("fetchedAt", 40);
  if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) return undefined;
  const out: Provenance = { method: p.method, fetchedAt };
  const url = str("url", 2048);
  if (url) out.url = url;
  const finalUrl = str("finalUrl", 2048);
  if (finalUrl) out.finalUrl = finalUrl;
  const fileName = str("fileName", 120);
  if (fileName) out.fileName = fileName;
  const contentType = str("contentType", 100);
  if (contentType) out.contentType = contentType;
  if (typeof p.bytes === "number" && Number.isFinite(p.bytes) && p.bytes >= 0) out.bytes = Math.floor(p.bytes);
  const sha = str("sha256", 64);
  if (sha && /^[0-9a-f]{64}$/.test(sha)) out.sha256 = sha;
  const doiInText = str("doiInText", 200);
  if (doiInText) out.doiInText = doiInText;
  if (typeof p.doiCheck === "string" && DOI_CHECKS.includes(p.doiCheck as DoiCheck)) out.doiCheck = p.doiCheck as DoiCheck;
  // T13: sidik jari perubahan, hanya bentuk heksadesimal pendek yang dikenal.
  for (const k of ["metaFp", "contentFp"] as const) {
    const fp = str(k, 17); // 17: nilai yang lebih panjang dari 16 gagal di regex, tidak terpotong diam-diam
    if (fp && /^[0-9a-f]{8,16}$/.test(fp)) out[k] = fp;
  }
  return out;
}
