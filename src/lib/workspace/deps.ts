import { sha256Hex } from "./hash";
import { LOCAL_OWNER } from "./types";

/** Hal-hal yang non-deterministik (id, waktu, hash) disuntik supaya logika bisa diuji secara deterministik. */
export interface StoreDeps {
  newId(): string;
  now(): string;
  sha256(data: string | Uint8Array): Promise<string>;
  ownerId: string;
}

export const defaultDeps: StoreDeps = {
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  sha256: sha256Hex,
  ownerId: LOCAL_OWNER,
};
