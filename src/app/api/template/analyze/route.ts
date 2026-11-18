import { guard } from "@/lib/guard";
import { MAX_TEMPLATE_BYTES } from "@/lib/template/package";
import { analyzeTemplate } from "@/lib/template/analyze";
import { TemplateError } from "@/lib/template/xml";

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
  if (file.size > MAX_TEMPLATE_BYTES) return Response.json({ error: "Ukuran template maksimal 8 MB." }, { status: 413 });
  if (!/\.docx$/i.test(file.name)) return Response.json({ error: "Gunakan file Word berformat .docx (bukan .doc atau PDF)." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return Response.json({ error: "File bukan dokumen Word (.docx) yang valid." }, { status: 400 });

  try {
    return Response.json(analyzeTemplate(bytes), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof TemplateError) return Response.json({ error: e.message }, { status: 422 });
    console.error(e);
    return Response.json({ error: "Template tidak dapat dibaca." }, { status: 500 });
  }
}
