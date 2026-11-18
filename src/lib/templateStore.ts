import type { Analysis, Mapping } from "./template/types";

/** Template unggahan disimpan di IndexedDB peramban (muat file besar, tidak ikut terkirim ke server kecuali saat memproses). */
export interface StoredTemplate {
  name: string;
  size: number;
  data: ArrayBuffer;
  analysis: Analysis;
  mapping: Mapping;
  savedAt: number;
}

const DB_NAME = "nakesa";
const STORE = "templates";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB tidak tersedia"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB diblokir"));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Penyimpanan dibatalkan"));
    });
  } finally {
    db.close();
  }
}

export async function loadTemplate(key: string): Promise<StoredTemplate | null> {
  try {
    return ((await run("readonly", (s) => s.get(key))) as StoredTemplate | undefined) ?? null;
  } catch {
    return null;
  }
}

/** true bila tersimpan; false bila peramban menolak (mode privat, kuota penuh, dll). */
export async function saveTemplate(key: string, rec: StoredTemplate): Promise<boolean> {
  try {
    await run("readwrite", (s) => s.put(rec, key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteTemplate(key: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(key));
  } catch {
    /* abaikan */
  }
}
