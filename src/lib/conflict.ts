import type { Draft } from "./draft";
import { canonical } from "./workspace/hash";

/**
 * T40: deteksi konflik edit dari tab/perangkat lain, tanpa menimpa diam-diam.
 *
 * Model: setiap dokumen punya nomor versi `rev` (seperti ETag) yang naik 1 setiap tulis. Penyunting memegang `base`
 * (keadaan yang ia lihat saat mulai mengubah). Saat menulis:
 *  - rev penyimpanan masih sama dengan rev `base`  -> tidak ada yang menulis di antaranya: tulis langsung.
 *  - rev sudah berbeda -> bandingkan per "slot" (satu bagian teks, satu isian, daftar sumber, struktur, template):
 *      * slot yang hanya saya ubah          -> diterapkan;
 *      * slot yang hanya pihak lain ubah    -> dipertahankan (tidak ditimpa);
 *      * slot yang sama-sama diubah berbeda -> KONFLIK: tidak ditulis, versi pihak lain tetap, dan pengguna memilih.
 * Perubahan di slot berbeda digabung otomatis karena tidak ada yang hilang. Perpindahan langkah (`step`) bukan isi dokumen
 * dan tidak pernah menjadi konflik.
 *
 * Murni (tanpa React/peramban): dipakai oleh formulir (penyimpanan v1, useGuardedDraft) dan oleh WorkspaceStore v2.
 * Untuk cloud (T24) `rev` dipetakan ke ETag di server; logika slot-nya sama.
 */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/** Bagian berupa peta id -> teks; setiap id adalah slot sendiri. */
const MAP_KEYS = ["input", "texts"] as const;
/** Bagian yang dibandingkan utuh sebagai satu slot. */
const WHOLE_KEYS = ["sources", "sourceRefs", "outline", "template"] as const;

export type Choice = "mine" | "theirs" | "both";

/** Satu perubahan yang ingin ditulis: `base` = nilai yang dilihat penyunting, `value` = nilai yang diinginkan. */
export interface SlotEdit {
  slot: string;
  base: unknown;
  value: unknown;
}

export interface Conflict {
  slot: string;
  /** Nilai saat penyunting mulai mengubah. */
  base: unknown;
  /** Nilai yang ingin ditulis penyunting ini. */
  mine: unknown;
  /** Nilai yang sekarang tersimpan (ditulis pihak lain). */
  theirs: unknown;
}

/** Sama nilainya? Kesamaan referensi dulu (murah); perbandingan isi hanya bila perlu. undefined (tidak ada) berbeda dari "". */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return canonical(a) === canonical(b);
}

export const revOf = (d: { rev?: number }): number => d.rev ?? 0;

const UNSAFE_ID = new Set(["__proto__", "constructor", "prototype"]);

/** Nilai satu slot. Slot utuh yang tidak ada dianggap null (null dan "tidak ada" sama). */
export function slotValue(x: object, slot: string): unknown {
  const o = x as Rec;
  const i = slot.indexOf(":");
  if (i < 0) return o[slot] ?? null;
  const m = o[slot.slice(0, i)];
  const id = slot.slice(i + 1);
  return isRec(m) && Object.prototype.hasOwnProperty.call(m, id) ? m[id] : undefined;
}

/** Semua nama slot yang ada di x. */
export function slotNames(x: object): string[] {
  const o = x as Rec;
  const out: string[] = [];
  for (const k of MAP_KEYS) {
    const m = o[k];
    if (isRec(m)) for (const id of Object.keys(m)) out.push(`${k}:${id}`);
  }
  for (const k of WHOLE_KEYS) if (k in o) out.push(k);
  return out;
}

/** Salinan x dengan satu slot diubah. value undefined pada slot peta = menghapus id itu. */
export function withSlot<T extends object>(x: T, slot: string, value: unknown): T {
  const o: Rec = { ...(x as Rec) };
  const i = slot.indexOf(":");
  if (i < 0) {
    o[slot] = value;
    return o as unknown as T;
  }
  const k = slot.slice(0, i);
  const id = slot.slice(i + 1);
  if (UNSAFE_ID.has(id)) return x; // id berbahaya tidak pernah ditulis
  const m: Rec = isRec(o[k]) ? { ...(o[k] as Rec) } : {};
  if (value === undefined) delete m[id];
  else m[id] = value;
  o[k] = m;
  return o as unknown as T;
}

/** Slot yang berbeda antara base dan next, sebagai daftar perubahan. */
export function diffSlots(base: object, next: object): SlotEdit[] {
  const names = new Set([...slotNames(base), ...slotNames(next)]);
  const out: SlotEdit[] = [];
  for (const slot of names) {
    const b = slotValue(base, slot);
    const n = slotValue(next, slot);
    if (!sameValue(b, n)) out.push({ slot, base: b, value: n });
  }
  return out;
}

export interface ApplyResult<T> {
  value: T;
  applied: number;
  conflicts: Conflict[];
}

/** Terapkan perubahan ke keadaan `current` (yang sekarang tersimpan), slot demi slot. Tidak pernah menimpa perubahan pihak lain. */
export function applyEdits<T extends object>(current: T, edits: SlotEdit[]): ApplyResult<T> {
  let value = current;
  let applied = 0;
  const conflicts: Conflict[] = [];
  for (const e of edits) {
    const cur = slotValue(current, e.slot);
    if (sameValue(cur, e.value)) continue; // sudah sama (mis. dua tab mengubah ke isi yang sama)
    if (sameValue(cur, e.base)) {
      value = withSlot(value, e.slot, e.value);
      applied++;
    } else {
      conflicts.push({ slot: e.slot, base: e.base, mine: e.value, theirs: cur });
    }
  }
  return { value, applied, conflicts };
}

// ---------- draf formulir (penyimpanan v1) ----------

export interface DraftStorage {
  read(): Draft;
  write(d: Draft): void;
}

export interface CommitResult {
  /** Keadaan tersimpan sesudah operasi (atau keadaan terbaru bila tidak ada yang ditulis). */
  draft: Draft;
  conflicts: Conflict[];
  wrote: boolean;
}

/**
 * Tulis perubahan dari `base` ke `next`. Pembacaan dan penulisan dilakukan berurutan tanpa jeda (satu blok sinkron).
 * Hasilnya tidak pernah menghilangkan isi pihak lain: lihat penjelasan di atas file.
 */
export function commitDraft(storage: DraftStorage, base: Draft, next: Draft): CommitResult {
  const stored = storage.read();
  const edits = diffSlots(base, next);
  const stepChanged = next.step !== base.step;
  if (!edits.length && !stepChanged) return { draft: stored, conflicts: [], wrote: false };

  if (revOf(stored) === revOf(base)) {
    const out: Draft = { ...next, rev: revOf(stored) + 1 };
    storage.write(out);
    return { draft: out, conflicts: [], wrote: true };
  }

  const r = applyEdits(stored, edits);
  if (!r.applied && !stepChanged) return { draft: stored, conflicts: r.conflicts, wrote: false };
  const out: Draft = { ...(stepChanged ? { ...r.value, step: next.step } : r.value), rev: revOf(stored) + 1 };
  storage.write(out);
  return { draft: out, conflicts: r.conflicts, wrote: true };
}

/** Tulis perubahan slot saja (tanpa jalur cepat rev). Dipakai untuk menerapkan pilihan pengguna. */
export function commitEdits(storage: DraftStorage, edits: SlotEdit[]): CommitResult {
  const stored = storage.read();
  const r = applyEdits(stored, edits);
  if (!r.applied) return { draft: stored, conflicts: r.conflicts, wrote: false };
  const out: Draft = { ...r.value, rev: revOf(stored) + 1 };
  storage.write(out);
  return { draft: out, conflicts: r.conflicts, wrote: true };
}

/** Gabungan dua teks untuk pilihan "simpan keduanya": versi pihak lain dulu, lalu versi saya. */
export function joinBoth(theirs: string, mine: string): string {
  if (!theirs.trim()) return mine;
  if (!mine.trim()) return theirs;
  return `${theirs}\n\n${mine}`;
}

/** Apakah pilihan "simpan keduanya" berlaku (kedua sisi teks tak kosong). */
export function canKeepBoth(c: Conflict): boolean {
  return typeof c.mine === "string" && typeof c.theirs === "string" && !!c.mine.trim() && !!c.theirs.trim();
}

/**
 * Pilihan pengguna -> perubahan yang harus ditulis. "theirs" (atau tanpa pilihan) tidak menulis apa pun: versi pihak lain sudah
 * tersimpan. Basisnya adalah nilai pihak lain yang dilihat pengguna, jadi bila nilai itu berubah lagi, muncul konflik baru.
 */
export function choiceEdits(conflicts: Conflict[], choices: Record<string, Choice | undefined>): SlotEdit[] {
  const edits: SlotEdit[] = [];
  for (const c of conflicts) {
    const ch = choices[c.slot];
    if (ch === "mine") edits.push({ slot: c.slot, base: c.theirs, value: c.mine });
    else if (ch === "both" && canKeepBoth(c)) edits.push({ slot: c.slot, base: c.theirs, value: joinBoth(c.theirs as string, c.mine as string) });
  }
  return edits;
}

export function resolveConflicts(storage: DraftStorage, conflicts: Conflict[], choices: Record<string, Choice | undefined>): CommitResult {
  return commitEdits(storage, choiceEdits(conflicts, choices));
}

/** Konflik baru menggantikan konflik lama di slot yang sama: nilai terbaru yang ingin ditulis penyunting yang berlaku, `base` tetap yang paling awal. */
export function mergeConflicts(existing: Conflict[], incoming: Conflict[]): Conflict[] {
  const bySlot = new Map(existing.map((c) => [c.slot, c] as const));
  for (const c of incoming) {
    const old = bySlot.get(c.slot);
    bySlot.set(c.slot, old ? { ...c, base: old.base } : c);
  }
  return Array.from(bySlot.values());
}

/** Ringkasan nilai slot untuk ditampilkan di dialog. */
export function previewValue(v: unknown, max = 600): string {
  if (v === undefined || v === null) return "(kosong)";
  if (typeof v === "string") {
    if (!v.trim()) return "(kosong)";
    return v.length > max ? `${v.slice(0, max)}…` : v;
  }
  if (Array.isArray(v)) return v.length ? `${v.length} butir` : "(kosong)";
  return "(berubah)";
}
