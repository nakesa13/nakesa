import { createHash } from "node:crypto";

/** SHA-256 heksadesimal dari byte asli (untuk provenance). Hanya di server. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
