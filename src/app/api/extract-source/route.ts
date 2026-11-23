import { ExtractError, MAX_SOURCE_BYTES, extractSourceText } from "@/lib/extract";
import { guard } from "@/lib/guard";
import { sha256Hex } from "@/lib/hash";
import { cleanFileName } from "@/lib/provenance";
import type { Provenance } from "@/lib/types";

/** Baca teks dari file jurnal/referensi (PDF, Word .docx, .txt). File tidak disimpan di server. */
export async function POST(req: Request) {
  const blocked = guard(req, 60);
  if (blocked) return blocked;

  let file: File | null = null;
  try {
    const f = (await req.formData()).get("file");
    file = f instanceof File ? f : null;
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (!file) return Response.json({ error: "File tidak ditemukan." }, { status: 400 });
  if (file.size > MAX_SOURCE_BYTES) return Response.json({ error: "Ukuran file maksimal 10 MB." }, { status: 413 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await extractSourceText(bytes, file.name);
    const provenance: Provenance = { method: "file", fileName: cleanFileName(file.name), fetchedAt: new Date().toISOString(), bytes: bytes.length, sha256: sha256Hex(bytes) };
    return Response.json({ ...r, provenance }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "File tidak dapat dibaca." }, { status: 500 });
  }
}
