import { lookupDoi } from "@/lib/crossref";
import { guard } from "@/lib/guard";
import { stampChecks } from "@/lib/refs";

export async function POST(req: Request) {
  const blocked = guard(req, 60);
  if (blocked) return blocked;

  let doi = "";
  try {
    const body = (await req.json()) as { doi?: unknown };
    doi = typeof body.doi === "string" ? body.doi.slice(0, 300) : "";
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  try {
    // T13: metadata (dan abstrak) dicatat sebagai keadaan yang diverifikasi; bila diubah kemudian, status turun.
    return Response.json({ source: stampChecks(await lookupDoi(doi)) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal mengambil data DOI.";
    return Response.json({ error: msg }, { status: 422 });
  }
}
