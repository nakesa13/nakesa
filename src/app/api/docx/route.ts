import { buildDocx } from "@/lib/docx-builder";
import { inspectDocx } from "@/lib/docx-check";
import { buildDocxFromTemplate } from "@/lib/template/build";
import { parseMapping } from "@/lib/template/mapping";
import { MAX_TEMPLATE_BYTES } from "@/lib/template/package";
import type { Mapping } from "@/lib/template/types";
import { TemplateError } from "@/lib/template/xml";
import { guard, parseSources } from "@/lib/guard";
import { getTemplate } from "@/templates";
import type { CiteStyle, DocSection, Identity } from "@/lib/types";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(req: Request) {
  const blocked = guard(req, 100);
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  let template: Uint8Array | null = null;
  let mapping: Mapping | null = null;
  try {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData();
      body = JSON.parse(String(form.get("data") ?? "null"));
      const f = form.get("template");
      if (f instanceof File) {
        if (f.size > MAX_TEMPLATE_BYTES) return Response.json({ error: "Ukuran template maksimal 8 MB." }, { status: 413 });
        template = new Uint8Array(await f.arrayBuffer());
        mapping = parseMapping(JSON.parse(String(form.get("mapping") ?? "null")));
        if (template[0] !== 0x50 || template[1] !== 0x4b || !mapping) return Response.json({ error: "Template tidak valid. Unggah ulang template Anda." }, { status: 400 });
      }
    } else {
      body = await req.json();
    }
    if (!body || typeof body !== "object") throw new Error("bad");
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const tpl = getTemplate(String(body.docType));
  const sources = parseSources(body.sources ?? []);
  if (!tpl || !sources || !Array.isArray(body.sections) || body.sections.length > 60) {
    return Response.json({ error: "Data permintaan tidak valid." }, { status: 400 });
  }

  const sections: DocSection[] = [];
  for (const raw of body.sections) {
    const s = raw as Record<string, unknown>;
    const kind = s.kind === "ai" || s.kind === "data" || s.kind === "heading" ? s.kind : null;
    const level = s.level === 1 || s.level === 2 || s.level === 3 ? s.level : null;
    if (!kind || !level) return Response.json({ error: "Struktur bagian tidak valid." }, { status: 400 });
    sections.push({ id: str(s.id, 40), title: str(s.title, 300), level, kind, text: str(s.text, 80_000) });
  }

  const idn = (body.identity ?? {}) as Record<string, unknown>;
  const identity: Identity = {
    nama: str(idn.nama, 120),
    nim: str(idn.nim, 40),
    prodi: str(idn.prodi, 120),
    kampus: str(idn.kampus, 160),
    pembimbing: str(idn.pembimbing, 160),
    tahun: str(idn.tahun, 12),
  };
  const style: CiteStyle = body.style === "Vancouver" ? "Vancouver" : "APA";
  const judul = str(body.judul, 300).trim() || tpl.name;

  try {
    const input = { coverTitle: tpl.coverTitle, judul, identity, sections, sources, style, chapterStyle: tpl.chapterStyle };
    const built = template && mapping ? await buildDocxFromTemplate(input, template, mapping) : await buildDocx(input);
    const { buffer } = built;
    // T12: periksa struktur sebelum dikirim. File rusak, atau sitasi tanpa entri daftar pustaka, tidak boleh sampai ke pengguna.
    // Gaya sitasi efektif: koreksi/deteksi dari template menggantikan Pengaturan (sama dengan yang dipakai pembuat dokumen).
    const report = inspectDocx(buffer, { cited: sources.filter((s) => built.citedIds.includes(s.id)), style: mapping?.citeStyle ?? style });
    if (!report.ok) {
      console.error("docx tidak lolos pemeriksaan:", report.problems.map((p) => p.code).join(","));
      const first = report.problems.find((p) => p.level === "error");
      return Response.json({ error: `File Word hasil tidak lolos pemeriksaan: ${first?.message ?? "struktur tidak valid."} Coba lagi; bila berulang, laporkan agar diperbaiki.` }, { status: 500 });
    }
    const warnings = [...new Set([...(built.warnings ?? []), ...report.problems.filter((p) => p.level === "warning").map((p) => p.code)])];
    const fileName = (judul.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || tpl.short) + ".docx";
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${tpl.short}.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
        ...(warnings.length ? { "X-Nakesa-Warnings": warnings.join(",") } : {}),
      },
    });
  } catch (e) {
    if (e instanceof TemplateError) return Response.json({ error: e.message }, { status: 422 });
    console.error(e);
    return Response.json({ error: "Gagal membuat file Word." }, { status: 500 });
  }
}
