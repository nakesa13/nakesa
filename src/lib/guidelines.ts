import { sha256Hex } from "./hash";

/**
 * T16: bank pedoman klinis. HANYA DI SERVER (memakai node:crypto lewat hash.ts); jangan diimpor dari komponen klien.
 * Ini daftar rujukan RESMI yang dikelola pengelola (bukan sumber referensi milik mahasiswa di types.ts).
 *
 * Alur status satu arah: draft -> review -> approved -> superseded.
 *   draft      bisa diubah. Boleh tidak lengkap.
 *   review     sudah diajukan dan dibekukan (hash isi dicatat). Dikembalikan ke draft (wajib catatan) atau disetujui.
 *   approved   satu-satunya status yang boleh dipakai (kutipan, telaah klinis). Isi tidak bisa diubah.
 *   superseded sudah digantikan atau ditarik. Final, tidak bisa kembali.
 * Mengubah pedoman yang sudah approved = membuat VERSI BARU (newVersionFrom) yang menempuh alur dari awal; saat versi
 * baru disetujui, versi lama otomatis superseded. Satu seri pedoman hanya boleh punya satu versi approved.
 *
 * Prinsip:
 *  - Hanya approved yang dipakai. Draft, review, superseded, pedoman uji (fixture), dan pedoman yang isinya tidak
 *    cocok dengan hash TIDAK PERNAH muncul di approvedGuidelines/resolveCitation.
 *  - Empat mata: pemberi persetujuan tidak boleh pembuat, pengubah, atau pengaju pedoman itu.
 *  - Tiap peralihan status tercatat (siapa, kapan, catatan). Fungsi murni: tidak mengubah masukan, waktu dioper dari luar.
 *  - Kode ini tidak berisi isi klinis apa pun. Isi pedoman datang dari pengelola; fixture di test sepenuhnya fiktif.
 *  - Penyimpanan (database, peran admin) BUKAN bagian T16: menunggu T21/T26. parseBank membaca data tidak tepercaya dari penyimpanan.
 */

export type GuidelineStatus = "draft" | "review" | "approved" | "superseded";
export const GUIDELINE_STATUSES: GuidelineStatus[] = ["draft", "review", "approved", "superseded"];

/** Peralihan yang sah. Selain ini ditolak. */
export const TRANSITIONS: Record<GuidelineStatus, GuidelineStatus[]> = {
  draft: ["review"],
  review: ["draft", "approved"],
  approved: ["superseded"],
  superseded: [],
};

export const LIMITS = {
  guidelines: 500,
  passages: 500,
  passageText: 2000,
  title: 200,
  issuer: 120,
  short: 120,
  scope: 1000,
  rights: 500,
  note: 500,
  audit: 100,
  actor: 80,
  url: 2048,
  contributors: 50,
} as const;

export interface GuidelineMeta {
  title: string;
  /** Penerbit atau organisasi penyusun. */
  issuer: string;
  year: number;
  /** Edisi atau revisi, teks bebas (mis. "Edisi 2"). */
  versionLabel: string;
  /** Kode topik huruf kecil, mis. "anc". */
  topic: string;
  language: "id" | "en";
  /** Apa yang diatur pedoman ini. */
  scope: string;
  /** Dasar izin menyimpan dan mengutip isinya (domain publik, lisensi, atau izin tertulis). */
  rights: string;
  /** Tautan sumber resmi. Hanya dicatat; tidak pernah diambil otomatis. */
  sourceUrl?: string;
  pageCount?: number;
}

/** Satu kutipan yang bisa dirujuk, lengkap dengan nomor halaman. */
export interface GuidelinePassage {
  id: string;
  page: number;
  section?: string;
  text: string;
}

export interface AuditEntry {
  at: string;
  by: string;
  from: GuidelineStatus | null;
  to: GuidelineStatus;
  note?: string;
}

/** Satu VERSI pedoman. */
export interface GuidelineRecord {
  id: string;
  /** Semua versi dari pedoman yang sama berbagi seriesId. */
  seriesId: string;
  version: number;
  status: GuidelineStatus;
  meta: GuidelineMeta;
  passages: GuidelinePassage[];
  /** Pedoman uji (fiktif). Tidak pernah dipakai kecuali includeFixtures. */
  fixture: boolean;
  createdBy: string;
  createdAt: string;
  /** Semua orang yang membuat, mengubah, atau mengajukan; tidak boleh menyetujui. */
  contributors: string[];
  submittedBy?: string;
  /** Diisi saat diajukan ke review; dicek ulang saat disetujui dan setiap kali dipakai. */
  contentHash?: string;
  approvedBy?: string;
  approvedAt?: string;
  supersededBy?: string;
  supersedes?: string;
  audit: AuditEntry[];
}

export interface GuidelineBank {
  guidelines: GuidelineRecord[];
}

export const emptyBank = (): GuidelineBank => ({ guidelines: [] });

export interface DraftInput {
  meta?: Partial<GuidelineMeta>;
  passages?: Partial<GuidelinePassage>[];
}

export type Fail = { ok: false; error: string };
export type Done = { ok: true; bank: GuidelineBank; record: GuidelineRecord };
export type Result = Done | Fail;

// ---------- pembersihan ----------

const clean = (v: unknown, max: number): string =>
  // eslint-disable-next-line no-control-regex
  typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
const posInt = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : null);

function sanitizeMeta(input: unknown): GuidelineMeta {
  const x = isObj(input) ? input : {};
  const year = typeof x.year === "number" && Number.isInteger(x.year) ? x.year : 0;
  const pageCount = posInt(x.pageCount, 5000);
  const sourceUrl = clean(x.sourceUrl, LIMITS.url);
  return {
    title: clean(x.title, LIMITS.title),
    issuer: clean(x.issuer, LIMITS.issuer),
    year,
    versionLabel: clean(x.versionLabel, 60),
    topic: clean(x.topic, 30).toLowerCase(),
    language: x.language === "en" ? "en" : "id",
    scope: clean(x.scope, LIMITS.scope),
    rights: clean(x.rights, LIMITS.rights),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(pageCount ? { pageCount } : {}),
  };
}

function sanitizePassages(input: unknown): GuidelinePassage[] {
  const src = Array.isArray(input) ? input.slice(0, LIMITS.passages) : [];
  const out: GuidelinePassage[] = [];
  const used = new Set<string>();
  let n = 1;
  for (const p of src) {
    if (!isObj(p)) continue;
    let id = typeof p.id === "string" && /^p\d{1,4}$/.test(p.id) && !used.has(p.id) ? p.id : "";
    if (!id) {
      while (used.has(`p${n}`)) n++;
      id = `p${n}`;
    }
    used.add(id);
    const section = clean(p.section, LIMITS.short);
    out.push({ id, page: posInt(p.page, 5000) ?? 0, ...(section ? { section } : {}), text: clean(p.text, LIMITS.passageText) });
  }
  return out;
}

// ---------- kelengkapan dan integritas ----------

/** Daftar kekurangan sebelum boleh diajukan ke review. Kosong = lengkap. */
export function validateForReview(rec: Pick<GuidelineRecord, "meta" | "passages">): string[] {
  const m = rec.meta;
  const out: string[] = [];
  if (m.title.length < 5) out.push("Judul pedoman wajib diisi (minimal 5 karakter).");
  if (m.issuer.length < 2) out.push("Penerbit atau penyusun wajib diisi.");
  if (!Number.isInteger(m.year) || m.year < 1950 || m.year > 2100) out.push("Tahun terbit harus antara 1950 dan 2100.");
  if (!m.versionLabel) out.push("Edisi atau revisi wajib diisi.");
  if (!/^[a-z0-9-]{2,30}$/.test(m.topic)) out.push("Kode topik wajib diisi (huruf kecil, angka, atau tanda hubung; 2 sampai 30 karakter).");
  if (m.scope.length < 10) out.push("Cakupan pedoman wajib dijelaskan (minimal 10 karakter).");
  if (m.rights.length < 10) out.push("Dasar izin penggunaan kutipan wajib dijelaskan (domain publik, lisensi, atau izin tertulis).");
  if (m.sourceUrl) {
    let ok = false;
    try {
      const u = new URL(m.sourceUrl);
      ok = u.protocol === "https:" || u.protocol === "http:";
    } catch {
      /* tidak sah */
    }
    if (!ok) out.push("Tautan sumber harus URL http(s) yang sah.");
  }
  if (rec.passages.length === 0) out.push("Minimal satu kutipan pedoman dengan nomor halaman.");
  for (const p of rec.passages) {
    if (p.page < 1) out.push(`Kutipan ${p.id}: nomor halaman wajib diisi.`);
    else if (m.pageCount && p.page > m.pageCount) out.push(`Kutipan ${p.id}: halaman ${p.page} melebihi jumlah halaman (${m.pageCount}).`);
    if (p.text.length < 20) out.push(`Kutipan ${p.id}: teks minimal 20 karakter.`);
  }
  return out;
}

/** Sidik jari isi (metadata + kutipan). Tidak memuat status, versi, atau jejak audit. */
export function contentHash(rec: Pick<GuidelineRecord, "meta" | "passages">): string {
  const m = rec.meta;
  const canon = JSON.stringify({
    m: [m.title, m.issuer, m.year, m.versionLabel, m.topic, m.language, m.scope, m.rights, m.sourceUrl ?? "", m.pageCount ?? 0],
    p: rec.passages.map((p) => [p.id, p.page, p.section ?? "", p.text]),
  });
  return sha256Hex(new TextEncoder().encode(canon));
}

/** Isi sama dengan yang dibekukan saat diajukan? Tanpa hash tercatat = tidak utuh. */
export const verifyIntegrity = (rec: GuidelineRecord): boolean => rec.contentHash !== undefined && rec.contentHash === contentHash(rec);

// ---------- alur status ----------

const fail = (error: string): Fail => ({ ok: false, error });
const find = (bank: GuidelineBank, id: string): GuidelineRecord | undefined => bank.guidelines.find((g) => g.id === id);
const actorOf = (a: string): string => clean(a, LIMITS.actor);
const noteOf = (n: string | undefined): string => clean(n ?? "", LIMITS.note);
const NOT_FOUND = "Pedoman tidak ditemukan.";
const NEED_ACTOR = "Identitas pelaku wajib diisi.";
const withContributor = (list: string[], by: string): string[] => (list.includes(by) ? list : [...list, by]);
/** Empat mata: dibandingkan tanpa membedakan huruf besar/kecil, agar "Budi" dan "budi" (atau e-mail berbeda kapitalisasi) tidak dianggap dua orang. */
const isContributor = (rec: GuidelineRecord, by: string): boolean => rec.contributors.some((c) => c.toLowerCase() === by.toLowerCase());

function moved(rec: GuidelineRecord, to: GuidelineStatus, by: string, now: Date, patch: Partial<GuidelineRecord>, note?: string): GuidelineRecord {
  const entry: AuditEntry = { at: now.toISOString(), by, from: rec.status, to, ...(note ? { note } : {}) };
  return { ...rec, ...patch, status: to, audit: [...rec.audit, entry].slice(-LIMITS.audit) };
}

function replaceAll(bank: GuidelineBank, changed: GuidelineRecord[]): GuidelineBank {
  const by = new Map(changed.map((c) => [c.id, c]));
  return { guidelines: bank.guidelines.map((g) => by.get(g.id) ?? g) };
}

const nextNumber = (bank: GuidelineBank): number => bank.guidelines.reduce((mx, g) => Math.max(mx, Number(g.id.slice(2)) || 0), 0) + 1;

/** Buat draf baru (versi 1 dari seri baru). Isian boleh belum lengkap. */
export function createDraft(bank: GuidelineBank, input: DraftInput, actor: string, now: Date, opts: { fixture?: boolean } = {}): Result {
  const by = actorOf(actor);
  if (!by) return fail(NEED_ACTOR);
  if (bank.guidelines.length >= LIMITS.guidelines) return fail(`Batas ${LIMITS.guidelines} pedoman tercapai.`);
  const n = nextNumber(bank);
  const record: GuidelineRecord = {
    id: `gl${n}`,
    seriesId: `gs${n}`,
    version: 1,
    status: "draft",
    meta: sanitizeMeta(input.meta),
    passages: sanitizePassages(input.passages),
    fixture: opts.fixture === true,
    createdBy: by,
    createdAt: now.toISOString(),
    contributors: [by],
    audit: [{ at: now.toISOString(), by, from: null, to: "draft" }],
  };
  return { ok: true, bank: { guidelines: [...bank.guidelines, record] }, record };
}

/** Ubah draf. Hanya status draft; yang lain dibekukan. Metadata digabung, daftar kutipan (bila diberikan) diganti utuh. */
export function updateDraft(bank: GuidelineBank, id: string, patch: DraftInput, actor: string): Result {
  const by = actorOf(actor);
  if (!by) return fail(NEED_ACTOR);
  const rec = find(bank, id);
  if (!rec) return fail(NOT_FOUND);
  if (rec.status !== "draft") return fail(`Pedoman berstatus ${rec.status} tidak bisa diubah. Hanya draft yang bisa diubah; untuk mengubah pedoman approved, buat versi baru.`);
  const next: GuidelineRecord = {
    ...rec,
    meta: patch.meta ? sanitizeMeta({ ...rec.meta, ...patch.meta }) : rec.meta,
    passages: patch.passages ? sanitizePassages(patch.passages) : rec.passages,
    contributors: withContributor(rec.contributors, by),
  };
  return { ok: true, bank: replaceAll(bank, [next]), record: next };
}

/** draft -> review. Harus lengkap. Isi dibekukan dengan hash. */
export function submitForReview(bank: GuidelineBank, id: string, actor: string, now: Date): Result {
  const by = actorOf(actor);
  if (!by) return fail(NEED_ACTOR);
  const rec = find(bank, id);
  if (!rec) return fail(NOT_FOUND);
  if (rec.status !== "draft") return fail(`Hanya draft yang bisa diajukan ke review (sekarang: ${rec.status}).`);
  const problems = validateForReview(rec);
  if (problems.length) return fail(`Belum lengkap: ${problems.join(" ")}`);
  const next = moved(rec, "review", by, now, { submittedBy: by, contentHash: contentHash(rec), contributors: withContributor(rec.contributors, by) });
  return { ok: true, bank: replaceAll(bank, [next]), record: next };
}

/** review -> draft. Catatan alasan wajib. Hash dan pengaju dihapus; harus diajukan ulang. */
export function returnToDraft(bank: GuidelineBank, id: string, actor: string, now: Date, note: string): Result {
  const by = actorOf(actor);
  if (!by) return fail(NEED_ACTOR);
  const rec = find(bank, id);
  if (!rec) return fail(NOT_FOUND);
  if (rec.status !== "review") return fail(`Hanya pedoman berstatus review yang bisa dikembalikan ke draft (sekarang: ${rec.status}).`);
  const n = noteOf(note);
  if (n.length < 5) return fail("Catatan alasan pengembalian wajib diisi (minimal 5 karakter).");
  const next = moved(rec, "draft", by, now, { submittedBy: undefined, contentHash: undefined }, n);
  delete next.submittedBy;
  delete next.contentHash;
  return { ok: true, bank: replaceAll(bank, [next]), record: next };
}

/**
 * review -> approved. Pemberi persetujuan tidak boleh pembuat, pengubah, atau pengaju. Isi dicek ulang terhadap hash.
 * Versi approved sebelumnya di seri yang sama otomatis menjadi superseded dalam satu langkah.
 */
export function approve(bank: GuidelineBank, id: string, actor: string, now: Date, note?: string): Result {
  const by = actorOf(actor);
  if (!by) return fail(NEED_ACTOR);
  const rec = find(bank, id);
  if (!rec) return fail(NOT_FOUND);
  if (rec.status !== "review") return fail(`Hanya pedoman berstatus review yang bisa disetujui (sekarang: ${rec.status}).`);
  if (isContributor(rec, by)) return fail("Pemberi persetujuan tidak boleh orang yang membuat, mengubah, atau mengajukan pedoman ini.");
  if (!verifyIntegrity(rec)) return fail("Isi pedoman berbeda dari saat diajukan. Kembalikan ke draft dan ajukan ulang.");
  const problems = validateForReview(rec);
  if (problems.length) return fail(`Belum lengkap: ${problems.join(" ")}`);
  const previous = bank.guidelines.filter((g) => g.seriesId === rec.seriesId && g.status === "approved" && g.id !== rec.id);
  if (previous.some((g) => g.version >= rec.version)) return fail("Sudah ada versi yang sama atau lebih baru yang disetujui di seri ini.");
  const next = moved(rec, "approved", by, now, { approvedBy: by, approvedAt: now.toISOString() }, noteOf(note) || undefined);
  const retired = previous.map((g) => moved(g, "superseded", by, now, { supersededBy: rec.id }, `Digantikan oleh ${rec.id}`));
  return { ok: true, bank: replaceAll(bank, [next, ...retired]), record: next };
}

/** approved -> superseded tanpa pengganti (ditarik). Catatan alasan wajib. */
export function supersede(bank: GuidelineBank, id: string, actor: string, now: Date, note: string): Result {
  const by = actorOf(actor);
  if (!by) return fail(NEED_ACTOR);
  const rec = find(bank, id);
  if (!rec) return fail(NOT_FOUND);
  if (rec.status !== "approved") return fail(`Hanya pedoman approved yang bisa ditarik (sekarang: ${rec.status}).`);
  const n = noteOf(note);
  if (n.length < 5) return fail("Catatan alasan penarikan wajib diisi (minimal 5 karakter).");
  const next = moved(rec, "superseded", by, now, {}, n);
  return { ok: true, bank: replaceAll(bank, [next]), record: next };
}

/** Versi baru dari pedoman approved: draf salinan yang menempuh alur dari awal. Satu versi terbuka per seri. */
export function newVersionFrom(bank: GuidelineBank, id: string, actor: string, now: Date): Result {
  const by = actorOf(actor);
  if (!by) return fail(NEED_ACTOR);
  const src = find(bank, id);
  if (!src) return fail(NOT_FOUND);
  if (src.status !== "approved") return fail(`Versi baru hanya dibuat dari pedoman approved (sekarang: ${src.status}).`);
  const series = bank.guidelines.filter((g) => g.seriesId === src.seriesId);
  if (series.some((g) => g.status === "draft" || g.status === "review")) return fail("Seri ini sudah punya versi yang masih draft atau review. Selesaikan dulu.");
  if (bank.guidelines.length >= LIMITS.guidelines) return fail(`Batas ${LIMITS.guidelines} pedoman tercapai.`);
  const record: GuidelineRecord = {
    id: `gl${nextNumber(bank)}`,
    seriesId: src.seriesId,
    version: Math.max(...series.map((g) => g.version)) + 1,
    status: "draft",
    meta: { ...src.meta },
    passages: src.passages.map((p) => ({ ...p })),
    fixture: src.fixture,
    createdBy: by,
    createdAt: now.toISOString(),
    contributors: [by],
    supersedes: src.id,
    audit: [{ at: now.toISOString(), by, from: null, to: "draft", note: `Versi baru dari ${src.id}` }],
  };
  return { ok: true, bank: { guidelines: [...bank.guidelines, record] }, record };
}

// ---------- pemakaian: hanya approved ----------

export interface UseOptions {
  /** Izinkan pedoman uji (fiktif). Hanya untuk test dan pengembangan. */
  includeFixtures?: boolean;
  topic?: string;
}

/**
 * Satu-satunya pintu untuk memakai pedoman. Hanya yang berstatus approved, utuh (hash cocok), bukan fixture
 * (kecuali diminta), dan satu-satunya approved di seri-nya. Seri dengan lebih dari satu approved dianggap rusak:
 * tidak ada yang dipakai.
 */
export function approvedGuidelines(bank: GuidelineBank, opts: UseOptions = {}): GuidelineRecord[] {
  const perSeries = new Map<string, number>();
  for (const g of bank.guidelines) if (g.status === "approved") perSeries.set(g.seriesId, (perSeries.get(g.seriesId) ?? 0) + 1);
  return bank.guidelines.filter(
    (g) =>
      g.status === "approved" &&
      perSeries.get(g.seriesId) === 1 &&
      verifyIntegrity(g) &&
      (opts.includeFixtures === true || !g.fixture) &&
      (opts.topic === undefined || g.meta.topic === opts.topic)
  );
}

export interface CitationRef {
  guidelineId: string;
  passageId: string;
}

export type CitationResult = { ok: true; guideline: GuidelineRecord; passage: GuidelinePassage; label: string } | { ok: false; reason: string };

/** Cari satu kutipan yang boleh dirujuk. Gagal dengan alasan bila pedoman bukan approved, tidak utuh, atau kutipan tidak ada. */
export function resolveCitation(bank: GuidelineBank, ref: CitationRef, opts: UseOptions = {}): CitationResult {
  const rec = find(bank, ref.guidelineId);
  if (!rec) return { ok: false, reason: "Pedoman tidak ditemukan." };
  if (rec.status !== "approved") return { ok: false, reason: `Pedoman berstatus ${rec.status}; hanya approved yang boleh dirujuk.` };
  if (rec.fixture && opts.includeFixtures !== true) return { ok: false, reason: "Pedoman uji (fixture) tidak boleh dipakai di luar pengujian." };
  if (!verifyIntegrity(rec)) return { ok: false, reason: "Isi pedoman tidak cocok dengan hash yang disetujui." };
  if (!approvedGuidelines(bank, { includeFixtures: opts.includeFixtures }).some((g) => g.id === rec.id)) return { ok: false, reason: "Seri pedoman ini memiliki lebih dari satu versi approved; data perlu diperiksa." };
  const passage = rec.passages.find((p) => p.id === ref.passageId);
  if (!passage) return { ok: false, reason: "Kutipan tidak ditemukan di pedoman ini." };
  return { ok: true, guideline: rec, passage, label: `${rec.meta.issuer}, ${rec.meta.title} (${rec.meta.year}), hlm. ${passage.page}` };
}

// ---------- membaca dari penyimpanan (data tidak tepercaya) ----------

const HEX64 = /^[0-9a-f]{64}$/;

function parseAudit(v: unknown): AuditEntry[] {
  if (!Array.isArray(v)) return [];
  const out: AuditEntry[] = [];
  for (const e of v.slice(-LIMITS.audit)) {
    if (!isObj(e)) continue;
    const at = isoOrNull(e.at);
    const by = clean(e.by, LIMITS.actor);
    const to = GUIDELINE_STATUSES.find((s) => s === e.to);
    const from = e.from === null ? null : (GUIDELINE_STATUSES.find((s) => s === e.from) ?? undefined);
    if (!at || !by || !to || from === undefined) continue;
    const note = clean(e.note, LIMITS.note);
    out.push({ at, by, from, to, ...(note ? { note } : {}) });
  }
  return out;
}

/** Baca satu versi pedoman; null bila bentuknya tidak sah. Tidak memeriksa hash (itu dilakukan saat dipakai). */
export function parseGuideline(raw: unknown): GuidelineRecord | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === "string" && /^gl\d{1,6}$/.test(raw.id) ? raw.id : null;
  const seriesId = typeof raw.seriesId === "string" && /^gs\d{1,6}$/.test(raw.seriesId) ? raw.seriesId : null;
  const status = GUIDELINE_STATUSES.find((s) => s === raw.status);
  const version = posInt(raw.version, 999);
  const createdBy = clean(raw.createdBy, LIMITS.actor);
  const createdAt = isoOrNull(raw.createdAt);
  if (!id || !seriesId || !status || !version || !createdBy || !createdAt) return null;

  const audit = parseAudit(raw.audit);
  if (audit.length === 0 || audit[audit.length - 1].to !== status) return null; // status harus sesuai jejak terakhir
  const hash = typeof raw.contentHash === "string" && HEX64.test(raw.contentHash) ? raw.contentHash : undefined;
  if (status !== "draft" && !hash) return null;
  const approvedBy = clean(raw.approvedBy, LIMITS.actor);
  const approvedAt = isoOrNull(raw.approvedAt);
  if (status === "approved" && (!approvedBy || !approvedAt)) return null;

  const contributors = Array.isArray(raw.contributors) ? raw.contributors.map((c) => clean(c, LIMITS.actor)).filter(Boolean).slice(0, LIMITS.contributors) : [];
  const submittedBy = clean(raw.submittedBy, LIMITS.actor);
  const supersededBy = typeof raw.supersededBy === "string" && /^gl\d{1,6}$/.test(raw.supersededBy) ? raw.supersededBy : undefined;
  const supersedes = typeof raw.supersedes === "string" && /^gl\d{1,6}$/.test(raw.supersedes) ? raw.supersedes : undefined;
  return {
    id,
    seriesId,
    version,
    status,
    meta: sanitizeMeta(raw.meta),
    passages: sanitizePassages(raw.passages),
    fixture: raw.fixture === true,
    createdBy,
    createdAt,
    contributors: contributors.includes(createdBy) ? contributors : [createdBy, ...contributors],
    ...(submittedBy ? { submittedBy } : {}),
    ...(hash && status !== "draft" ? { contentHash: hash } : {}),
    ...(status === "approved" || approvedBy ? { approvedBy: approvedBy || undefined, approvedAt: approvedAt ?? undefined } : {}),
    ...(supersededBy ? { supersededBy } : {}),
    ...(supersedes ? { supersedes } : {}),
    audit,
  };
}

/** Baca bank dari penyimpanan. Versi yang rusak dibuang dan dihitung; id ganda: yang pertama dipakai. */
export function parseBank(raw: unknown): { bank: GuidelineBank; dropped: number } {
  const list = isObj(raw) && Array.isArray(raw.guidelines) ? raw.guidelines : [];
  const out: GuidelineRecord[] = [];
  const seen = new Set<string>();
  let dropped = Math.max(0, list.length - LIMITS.guidelines);
  for (const item of list.slice(0, LIMITS.guidelines)) {
    const g = parseGuideline(item);
    if (!g || seen.has(g.id)) {
      dropped++;
      continue;
    }
    seen.add(g.id);
    out.push(g);
  }
  return { bank: { guidelines: out }, dropped };
}
