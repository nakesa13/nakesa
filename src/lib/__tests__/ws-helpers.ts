import { expect } from "vitest";
import { MemoryBackend } from "../workspace/backend";
import type { StoreDeps } from "../workspace/deps";
import { sha256Hex } from "../workspace/hash";
import { WorkspaceStore } from "../workspace/store";
import { StoreError, type SourceDraft, type StoreCode } from "../workspace/types";

/** Pembantu test T06. Id dan waktu deterministik: id-1, id-2, ...; waktu naik 1 detik setiap dipanggil. */
export function testDeps(): StoreDeps {
  let n = 0;
  let t = Date.parse("2026-11-24T00:00:00.000Z");
  return { newId: () => `id-${++n}`, now: () => new Date((t += 1000)).toISOString(), sha256: sha256Hex, ownerId: "local" };
}

export async function makeStore() {
  const backend = new MemoryBackend();
  const deps = testDeps();
  const store = new WorkspaceStore(backend, deps);
  await store.open();
  return { backend, deps, store };
}

export function src(o: Partial<SourceDraft> = {}): SourceDraft {
  return {
    type: "jurnal",
    title: "Anemia pada Kehamilan",
    authors: [{ family: "Rahma", given: "S" }],
    year: "2022",
    journal: "Jurnal Kebidanan",
    doi: "10.1234/abc",
    content: "Anemia adalah kadar hemoglobin yang rendah.",
    origin: "crossref",
    verified: true,
    ...o,
  };
}

export function buf(bytes: number[]): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.length);
  new Uint8Array(ab).set(bytes);
  return ab;
}

/** Janji harus ditolak dengan StoreError berkode tertentu. */
export async function expectCode(p: Promise<unknown>, code: StoreCode): Promise<void> {
  const e = await p.then(
    () => null,
    (x: unknown) => x
  );
  expect(e, `seharusnya ditolak dengan kode ${code}`).toBeInstanceOf(StoreError);
  expect((e as StoreError).code).toBe(code);
}
