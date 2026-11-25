import {
  approve,
  createDraft,
  submitForReview,
  type Done,
  type DraftInput,
  type GuidelineBank,
  type GuidelineMeta,
  type GuidelineRecord,
  type Result,
} from "../guidelines";

/**
 * T16: fixture dummy untuk bank pedoman. SELURUHNYA FIKTIF: penerbit, judul, dan kutipan dibuat untuk menguji kode dan
 * tidak memuat isi klinis, angka ambang, atau kutipan dari pedoman nyata. Berkas ini hanya dipakai test dan tidak
 * diimpor oleh kode aplikasi.
 */

export const T0 = new Date("2026-11-01T08:00:00.000Z");
/** Waktu uji: T0 ditambah sekian menit. */
export const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

/** Buka hasil; gagal dengan pesan galatnya bila langkah ditolak (supaya test tidak lanjut dengan data setengah jadi). */
export function ok(r: Result): Done {
  if (!r.ok) throw new Error(`Langkah ditolak: ${r.error}`);
  return r;
}

export const DUMMY_META: GuidelineMeta = {
  title: "Pedoman Uji Fiktif Alfa",
  issuer: "Penerbit Fiktif",
  year: 2024,
  versionLabel: "Edisi 1",
  topic: "uji",
  language: "id",
  scope: "Dokumen fiktif untuk menguji alur status bank pedoman.",
  rights: "Fiktif: dibuat untuk pengujian, bukan pedoman nyata.",
  pageCount: 40,
};

/** Masukan lengkap yang lolos validateForReview. `meta` digabung ke DUMMY_META. */
export function dummyInput(over: { meta?: Partial<GuidelineMeta>; passages?: DraftInput["passages"] } = {}): DraftInput {
  return {
    meta: { ...DUMMY_META, ...over.meta },
    passages: over.passages ?? [
      { page: 3, section: "Bagian A", text: "Kutipan fiktif nomor satu untuk pengujian kode, tanpa isi klinis." },
      { page: 12, text: "Kutipan fiktif nomor dua; juga tanpa isi klinis apa pun." },
    ],
  };
}

interface Opts {
  fixture?: boolean;
  input?: DraftInput;
  creator?: string;
  approver?: string;
  /** Menit sejak T0 untuk langkah pertama; tiap langkah berikutnya +1. */
  t?: number;
}

/** Tambahkan satu draf ke bank. */
export function addDraft(bank: GuidelineBank, o: Opts = {}): { bank: GuidelineBank; record: GuidelineRecord } {
  const r = ok(createDraft(bank, o.input ?? dummyInput(), o.creator ?? "penyusun", at(o.t ?? 0), { fixture: o.fixture }));
  return { bank: r.bank, record: r.record };
}

/** Tambahkan satu pedoman berstatus review (dibuat dan diajukan oleh orang yang sama). */
export function addInReview(bank: GuidelineBank, o: Opts = {}): { bank: GuidelineBank; record: GuidelineRecord } {
  const d = addDraft(bank, o);
  const r = ok(submitForReview(d.bank, d.record.id, o.creator ?? "penyusun", at((o.t ?? 0) + 1)));
  return { bank: r.bank, record: r.record };
}

/** Tambahkan satu pedoman berstatus approved lewat alur yang sah (pembuat dan penyetuju orang berbeda). */
export function addApproved(bank: GuidelineBank, o: Opts = {}): { bank: GuidelineBank; record: GuidelineRecord } {
  const v = addInReview(bank, o);
  const r = ok(approve(v.bank, v.record.id, o.approver ?? "peninjau", at((o.t ?? 0) + 2)));
  return { bank: r.bank, record: r.record };
}

/** Bekukan seluruh struktur: bila kode di bawah uji mengubah masukan, test langsung gagal dengan TypeError. */
export function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}
