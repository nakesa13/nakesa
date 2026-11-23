import Anthropic from "@anthropic-ai/sdk";
import { AiConfigError, ProviderError, generateSection } from "@/lib/ai";
import { analyzeSection, renderDataSection } from "@/lib/case";
import { guard, isInput, parseSources } from "@/lib/guard";
import { withoutPatientFields } from "@/lib/kasus";
import { parseOutlineItem, resolveSection } from "@/lib/outline";
import { getTemplate } from "@/templates";
import type { SectionDef } from "@/templates/types";

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const tpl = getTemplate(String(body.docType));
  // Tahap B: bagian dari struktur template mahasiswa. Instruksi AI dibangun ulang di server, bukan diterima dari klien.
  let section: SectionDef | undefined;
  if (tpl && body.item !== undefined) {
    const it = parseOutlineItem(body.item);
    section = it && it.id === body.sectionId ? resolveSection(tpl.type, it) : undefined;
  } else {
    section = tpl?.sections.find((s) => s.id === body.sectionId);
  }
  const sources = parseSources(body.sources ?? []);
  if (!tpl || !section || !isInput(body.input) || !sources) {
    return Response.json({ error: "Data permintaan tidak valid." }, { status: 400 });
  }
  // T07: Reading Journal tidak pernah menerima kolom data pasien, juga bila klien mengirimnya.
  const input = tpl.type === "RJ" ? withoutPatientFields(body.input) : body.input;

  try {
    let text = "";
    let stripped: string[] = [];

    if (section.kind === "data") {
      text = renderDataSection(tpl.type, section.ref ?? section.id, input);
    } else if (section.kind === "ai") {
      if (tpl.type === "RJ" && !sources.some((s) => (s.content ?? "").length >= 500)) {
        return Response.json({ error: "Teks jurnal belum ada. Unggah PDF jurnal atau tempel teksnya di langkah 'Jurnal'." }, { status: 400 });
      }
      const r = await generateSection(tpl.type, section.id, input, sources, section);
      text = r.text;
      stripped = r.stripped;
    }

    return Response.json({ text, stripped, warnings: analyzeSection(tpl.type, section, text, input, sources) });
  } catch (e) {
    if (e instanceof AiConfigError) return Response.json({ error: e.message }, { status: 503 });
    if (e instanceof ProviderError) return Response.json({ error: e.message }, { status: e.status === 429 ? 429 : e.status === 413 ? 413 : 502 });
    if (e instanceof Anthropic.APIError) {
      console.error("Anthropic API error", e.status, e.message);
      const msg = e.status === 429 ? "Layanan AI sedang padat. Coba lagi sebentar." : "Layanan AI bermasalah. Coba lagi.";
      return Response.json({ error: msg }, { status: 502 });
    }
    console.error(e);
    return Response.json({ error: "Terjadi kesalahan di server." }, { status: 500 });
  }
}
