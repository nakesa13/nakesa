import { StoreError } from "./types";

/**
 * Antarmuka penyimpanan. Seluruh aturan (rev, kaskade, konfirmasi, migrasi) ada di lapisan di atasnya
 * dan diuji dengan MemoryBackend; IdbBackend (idb.ts) hanya memetakan tiga operasi ini ke IndexedDB.
 */

export type StoreName = "meta" | "workspaces" | "cases" | "documents" | "versions" | "sources" | "templates";
export const STORE_NAMES: readonly StoreName[] = ["meta", "workspaces", "cases", "documents", "versions", "sources", "templates"];

export type Op = { kind: "put"; store: StoreName; key: string; value: unknown } | { kind: "delete"; store: StoreName; key: string };

/** Syarat yang diperiksa DI DALAM transaksi yang sama dengan penulisan. */
export interface Guard {
  store: StoreName;
  key: string;
  /** Rekaman harus ada dengan rev ini. */
  rev?: number;
  /** Rekaman harus belum ada. */
  absent?: boolean;
}

export interface Backend {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  /** Atomik: semua `ops` tertulis atau tidak satu pun. Bila ada guard yang gagal: StoreError("conflict"). */
  batch(ops: Op[], guards?: Guard[]): Promise<void>;
}

/** Pesan galat bila guard gagal, atau null bila lolos. */
export function guardFailure(g: Guard, current: { rev?: number } | undefined): string | null {
  if (g.absent) return current === undefined ? null : `${g.store}/${g.key} sudah ada.`;
  if (current === undefined) return `${g.store}/${g.key} tidak ditemukan.`;
  if (g.rev !== undefined && current.rev !== g.rev) return `${g.store}/${g.key} sudah berubah (rev ${current.rev}, diharapkan ${g.rev}).`;
  return null;
}

/** Penyimpanan di memori dengan semantik yang sama (salinan dalam, atomik). Dipakai test. */
export class MemoryBackend implements Backend {
  private data = new Map<StoreName, Map<string, unknown>>();

  constructor() {
    for (const s of STORE_NAMES) this.data.set(s, new Map());
  }

  private table(s: StoreName): Map<string, unknown> {
    const t = this.data.get(s);
    if (!t) throw new StoreError("invalid", `Store tidak dikenal: ${s}`);
    return t;
  }

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const v = this.table(store).get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    return Array.from(this.table(store).values(), (v) => structuredClone(v) as T);
  }

  async batch(ops: Op[], guards: Guard[] = []): Promise<void> {
    for (const g of guards) {
      const msg = guardFailure(g, this.table(g.store).get(g.key) as { rev?: number } | undefined);
      if (msg) throw new StoreError("conflict", msg);
    }
    // Salin semua nilai lebih dulu: bila ada yang tak bisa disalin, belum ada yang tertulis.
    const staged = ops.map((o) => (o.kind === "put" ? { ...o, value: structuredClone(o.value) } : o));
    for (const o of staged) {
      const t = this.table(o.store);
      if (o.kind === "put") t.set(o.key, o.value);
      else t.delete(o.key);
    }
  }
}
