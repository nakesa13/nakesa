import { STORE_NAMES, guardFailure, type Backend, type Guard, type Op, type StoreName } from "./backend";
import { StoreError } from "./types";

/**
 * Backend IndexedDB untuk peramban: database BARU "nakesa-v2". Database lama "nakesa" tidak disentuh (ADR bagian 8).
 * Sengaja tipis; semua aturan ada di WorkspaceStore dan diuji dengan MemoryBackend.
 * Catatan: transaksi IndexedDB berakhir sendiri bila tidak ada permintaan tertunda, jadi di dalam batch() tidak boleh
 * ada `await` pada hal selain permintaan IndexedDB.
 */

export const DB_NAME = "nakesa-v2";
const DB_VERSION = 1;

export class IdbBackend implements Backend {
  private dbp: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
          reject(new StoreError("invalid", "IndexedDB tidak tersedia di peramban ini; data tidak dapat disimpan."));
          return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of STORE_NAMES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); // kunci di luar rekaman
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          this.dbp = null;
          reject(req.error ?? new Error("Gagal membuka IndexedDB."));
        };
      });
    }
    return this.dbp;
  }

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      tx.oncomplete = () => resolve(req.result as T | undefined);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Gagal membaca IndexedDB."));
    });
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    const db = await this.open();
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAll();
      tx.oncomplete = () => resolve(req.result as T[]);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Gagal membaca IndexedDB."));
    });
  }

  async batch(ops: Op[], guards: Guard[] = []): Promise<void> {
    const names = Array.from(new Set<StoreName>([...ops.map((o) => o.store), ...guards.map((g) => g.store)]));
    if (!names.length) return;
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(names, "readwrite");
      let failure: Error | null = null;
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        // Galat permintaan akan membatalkan transaksi; onabort yang menolak janji.
      };
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("Transaksi IndexedDB dibatalkan."));

      const apply = () => {
        try {
          for (const o of ops) {
            const s = tx.objectStore(o.store);
            if (o.kind === "put") s.put(o.value, o.key);
            else s.delete(o.key);
          }
        } catch (e) {
          failure = e instanceof Error ? e : new Error(String(e));
          tx.abort();
        }
      };

      if (!guards.length) {
        apply();
        return;
      }
      let left = guards.length;
      for (const g of guards) {
        const req = tx.objectStore(g.store).get(g.key);
        req.onsuccess = () => {
          if (failure) return;
          const msg = guardFailure(g, req.result as { rev?: number } | undefined);
          if (msg) {
            failure = new StoreError("conflict", msg);
            tx.abort();
            return;
          }
          left -= 1;
          if (left === 0) apply();
        };
      }
    });
  }
}
