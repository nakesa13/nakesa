import { DRAFT_PREFIX, LIBRARY_KEY, SETTINGS_KEY } from "../client";
import { CASE_KEY } from "../kasus";
import type { DocType } from "../types";
import type { LegacySnapshot, LegacyTemplate } from "./migrate";
import { MIGRATION_KEY, type WorkspaceStore } from "./store";
import { DOC_TYPES, StoreError } from "./types";

/**
 * T06: akses ke data v1 (hanya peramban). Membaca saja; satu-satunya yang menghapus adalah removeLegacyData(),
 * yang butuh migrasi selesai dan konfirmasi eksplisit. Tidak diuji di Node (tidak ada localStorage/IndexedDB di sana);
 * logika migrasinya sendiri diuji lewat LegacySnapshot di migrate.test.ts.
 */

/** Rahasia perangkat (kode akses). Terpisah dari data yang bisa diekspor atau disinkronkan. */
export const DEVICE_KEY = "nakesa.device";
const LEGACY_DB = "nakesa";

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Buka database lama TANPA membuatnya. open() tanpa versi pada database yang belum ada akan membuatnya (versi 1, tanpa
 * store) dan itu merusak templateStore lama, yang tidak lagi menjalankan onupgradeneeded. Maka pembuatan dibatalkan.
 */
function openLegacyDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(LEGACY_DB);
    req.onupgradeneeded = () => req.transaction?.abort(); // belum ada: batalkan pembuatannya
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function readLegacyTemplates(): Promise<Partial<Record<DocType, LegacyTemplate | null>>> {
  const out: Partial<Record<DocType, LegacyTemplate | null>> = {};
  const db = await openLegacyDb();
  if (!db) return out;
  try {
    if (!db.objectStoreNames.contains("templates")) return out;
    for (const type of DOC_TYPES) {
      out[type] = await new Promise<LegacyTemplate | null>((resolve) => {
        const tx = db.transaction("templates", "readonly");
        const req = tx.objectStore("templates").get(type);
        tx.oncomplete = () => resolve((req.result as LegacyTemplate | undefined) ?? null);
        tx.onerror = tx.onabort = () => resolve(null);
      });
    }
  } finally {
    db.close();
  }
  return out;
}

export async function readLegacy(): Promise<LegacySnapshot> {
  const drafts: LegacySnapshot["drafts"] = {};
  for (const t of DOC_TYPES) drafts[t] = lsGet(DRAFT_PREFIX + t);
  return { settings: lsGet(SETTINGS_KEY), case: lsGet(CASE_KEY), library: lsGet(LIBRARY_KEY), drafts, templates: await readLegacyTemplates() };
}

/** Simpan kode akses ke kunci perangkat, tanpa menimpa yang sudah ada. */
export function writeDeviceAccessCode(accessCode: string): void {
  if (!accessCode) return;
  try {
    if (localStorage.getItem(DEVICE_KEY) === null) localStorage.setItem(DEVICE_KEY, JSON.stringify({ accessCode }));
  } catch {
    // penyimpanan penuh atau diblokir: kode akses tetap ada di data lama
  }
}

/**
 * Hapus data v1 (localStorage dan database lama). Hanya setelah migrasi selesai dan dengan konfirmasi eksplisit,
 * karena inilah satu-satunya salinan data bila v2 bermasalah.
 */
export async function removeLegacyData(store: WorkspaceStore, confirm: { confirmed?: boolean }): Promise<void> {
  if (confirm?.confirmed !== true) throw new StoreError("confirm", "Menghapus data lama butuh konfirmasi eksplisit.");
  if (!(await store.backend.get("meta", MIGRATION_KEY))) throw new StoreError("invalid", "Data lama baru boleh dihapus setelah migrasi selesai.");
  try {
    for (const k of [SETTINGS_KEY, CASE_KEY, LIBRARY_KEY, ...DOC_TYPES.map((t) => DRAFT_PREFIX + t)]) localStorage.removeItem(k);
  } catch {
    // diblokir: tidak ada yang bisa dihapus
  }
  if (typeof indexedDB !== "undefined") {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(LEGACY_DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }
}
