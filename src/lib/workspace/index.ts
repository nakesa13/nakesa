import { defaultDeps } from "./deps";
import { IdbBackend } from "./idb";
import { readLegacy, writeDeviceAccessCode } from "./legacy";
import { migrateV1ToV2, type MigrationResult } from "./migrate";
import { WorkspaceStore } from "./store";
import type { WorkspaceRec } from "./types";

export { WorkspaceStore, sharedCaseFor, emptyHead } from "./store";
export type * from "./types";

/**
 * T06: pintu masuk untuk UI (peramban). Membuka penyimpanan v2, memigrasikan data v1 sekali (idempoten), dan menjamin
 * ada satu ruang kerja. Belum dipanggil dari komponen mana pun: penyambungan UI (Wizard, pemilih ruang kerja, dialog
 * konfirmasi) adalah pekerjaan terpisah, karena Wizard sekarang masih memakai penyimpanan v1.
 */
export async function openLocalStore(): Promise<{ store: WorkspaceStore; readOnly: boolean; migration: MigrationResult | null; workspace: WorkspaceRec | null }> {
  const store = new WorkspaceStore(new IdbBackend(), defaultDeps);
  const { readOnly } = await store.open();
  if (readOnly) return { store, readOnly, migration: null, workspace: null };
  const migration = await migrateV1ToV2(store.backend, await readLegacy(), defaultDeps);
  if (migration.status === "migrated") writeDeviceAccessCode(migration.accessCode);
  return { store, readOnly, migration, workspace: await store.ensureDefaultWorkspace() };
}
