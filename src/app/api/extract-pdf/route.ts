import { extractText, getDocumentProxy } from "unpdf";
import { guard } from "@/lib/guard";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CHARS = 60_000;

export async function POST(req: Request) {
  const blocked = guard(req, 60);
  if (blocked) return blocked;

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (!file) return Response.json({ error: "File tidak ditemukan." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Ukuran PDF maksimal 10 MB." }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    return Response.json({ error: "File bukan PDF yang valid." }, { status: 400 });
  }

  try {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (clean.length < 500) {
      return Response.json(
        { error: "Teks tidak terbaca. PDF mungkin hasil scan (gambar). Tempel teks jurnal secara manual." },
        { status: 422 }
      );
    }
    return Response.json({
      text: clean.slice(0, MAX_CHARS),
      pages: totalPages,
      truncated: clean.length > MAX_CHARS,
      chars: clean.length,
    });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "PDF tidak dapat dibaca." }, { status: 422 });
  }
}
