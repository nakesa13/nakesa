import { ExtractError } from "@/lib/extract";
import { guard } from "@/lib/guard";
import { UrlImportError } from "@/lib/netguard";
import { importUrlSource } from "@/lib/urlimport";

/**
 * T04: ambil teks sumber dari URL (halaman web, PDF, atau teks). Server hanya mengambil dari alamat publik
 * (lihat lib/netguard.ts dan lib/urlimport.ts). Hasil tidak disimpan di server.
 */
export async function POST(req: Request) {
  const blocked = guard(req, 30);
  if (blocked) return blocked;

  let url = "";
  try {
    const body = (await req.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url.slice(0, 4096) : "";
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  try {
    const r = await importUrlSource(url);
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof UrlImportError || e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    console.error("import-url gagal tak terduga");
    return Response.json({ error: "URL tidak dapat diproses." }, { status: 500 });
  }
}
