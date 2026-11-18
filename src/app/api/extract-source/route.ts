import { ExtractError, MAX_SOURCE_BYTES, extractSourceText } from "@/lib/extract";
import { guard } from "@/lib/guard";

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
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "File tidak dapat dibaca." }, { status: 500 });
  }
}
