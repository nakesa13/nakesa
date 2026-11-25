import type { Input, Source } from "./types";
import { parseProvenance } from "./provenance";

/**
 * Pelindung sederhana selama belum ada login:
 *  - ACCESS_CODE (opsional): bila diatur, semua API butuh header x-access-code yang cocok.
 *  - Batas permintaan per IP per jam (di memori; cukup untuk satu server).
 *  - Batas ukuran input.
 */
const buckets = new Map<string, { count: number; reset: number }>();

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** Hanya memeriksa kode akses (tidak menghitung kuota). */
export function checkAccess(req: Request): Response | null {
  const code = process.env.ACCESS_CODE;
  if (code && req.headers.get("x-access-code") !== code) {
    return Response.json({ error: "Kode akses salah atau belum diisi. Isi di menu Pengaturan." }, { status: 401 });
  }
  return null;
}

/** Menghitung satu permintaan ke kuota per IP per jam; 429 bila batas terlampaui. */
export function chargeQuota(req: Request, limitPerHour = Number(process.env.RATE_LIMIT_PER_HOUR) || 200): Response | null {
  const ip = clientIp(req);
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.reset < now) {
    buckets.set(ip, { count: 1, reset: now + 3_600_000 });
  } else if (++b.count > limitPerHour) {
    return Response.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, { status: 429 });
  }
  return null;
}

export function guard(req: Request, limitPerHour = Number(process.env.RATE_LIMIT_PER_HOUR) || 200): Response | null {
  return checkAccess(req) ?? chargeQuota(req, limitPerHour);
}

export function isInput(v: unknown): v is Input {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const e = Object.entries(v as Record<string, unknown>);
  return e.length <= 120 && e.every(([k, x]) => typeof x === "string" && k.length <= 40 && x.length <= 80_000);
}

const SOURCE_TYPES = ["jurnal", "buku", "pedoman", "web"];

export function parseSources(v: unknown): Source[] | null {
  if (!Array.isArray(v) || v.length > 40) return null;
  const out: Source[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const s = x as Record<string, unknown>;
    if (typeof s.id !== "string" || !/^S\d{1,3}$/.test(s.id)) return null;
    if (typeof s.title !== "string" || !s.title.trim() || s.title.length > 500) return null;
    if (typeof s.type !== "string" || !SOURCE_TYPES.includes(s.type)) return null;
    const authors = Array.isArray(s.authors)
      ? s.authors
          .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
          .map((a) => ({
            family: String(a.family ?? "").slice(0, 120),
            given: a.given ? String(a.given).slice(0, 120) : undefined,
          }))
          .filter((a) => a.family)
          .slice(0, 40)
      : [];
    const str = (k: string, max = 300) => (typeof s[k] === "string" && s[k] ? (s[k] as string).slice(0, max) : undefined);
    const provenance = parseProvenance(s.provenance);
    out.push({
      id: s.id,
      type: s.type as Source["type"],
      title: s.title.trim(),
      authors,
      year: (str("year", 12) ?? "").trim(),
      publisher: str("publisher"),
      edition: str("edition", 60),
      journal: str("journal"),
      volume: str("volume", 30),
      issue: str("issue", 30),
      pages: str("pages", 40),
      doi: str("doi", 200),
      url: str("url", 500),
      content: str("content", 80_000),
      origin: s.origin === "crossref" ? "crossref" : "manual",
      verified: s.verified === true,
      ...(provenance ? { provenance } : {}),
    });
  }
  return out;
}
