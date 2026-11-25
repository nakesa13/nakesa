import Anthropic from "@anthropic-ai/sdk";
import { AiConfigError, ProviderError, generateSection } from "@/lib/ai";
import { analyzeSection, renderDataSection } from "@/lib/case";
import { DeadlineError, makeDeadline, raceDeadline } from "@/lib/deadline";
import { chargeQuota, checkAccess, clientIp, isInput, parseSources } from "@/lib/guard";
import { JOB_ID_RE, jobKey, planJob, runJob, type JobOutcome } from "@/lib/jobs";
import { withoutPatientFields } from "@/lib/kasus";
import { markNeedsReference, needsReferenceMark } from "@/lib/lp";
import { parseOutlineItem, resolveSection } from "@/lib/outline";
import { getTemplate } from "@/templates";
import type { SectionDef } from "@/templates/types";
import type { DocType, Input, Source } from "@/lib/types";

// T38: batas durasi fungsi serverless (detik). Pekerjaan sendiri dibatasi lebih pendek (budgetMs) supaya galat
// "waktu habis" yang jelas sampai ke klien sebelum platform memutus koneksi.
export const maxDuration = 60;

/** Anggaran waktu satu pekerjaan (ms). Bisa diubah lewat NAKESA_GENERATE_BUDGET_MS, tetapi tidak melewati 55 detik. */
function budgetMs(): number {
  const n = Number(process.env.NAKESA_GENERATE_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 55_000) : 50_000;
}

/** Jeda penanda hidup pada aliran progres (ms), agar proxy/platform tidak menutup koneksi yang diam. */
const HEARTBEAT_MS = 8_000;

const fail = (status: number, error: string, retryable: boolean): JobOutcome => ({ status, body: { error, retryable } });

function toOutcome(e: unknown): JobOutcome {
  if (e instanceof DeadlineError) return fail(504, e.message, true);
  if (e instanceof AiConfigError) return fail(503, e.message, false);
  if (e instanceof ProviderError) {
    const status = e.status === 429 ? 429 : e.status === 413 ? 413 : 502;
    // 429 dari penyedia AI (bukan kuota NAKESA) dan 502 bisa dicoba lagi; 413 (sumber terlalu besar) tidak akan berubah.
    return fail(status, e.message, status !== 413);
  }
  if (e instanceof Anthropic.APIError) {
    console.error("Anthropic API error", e.status, e.message);
    const msg = e.status === 429 ? "Layanan AI sedang padat. Coba lagi sebentar." : "Layanan AI bermasalah. Coba lagi.";
    return fail(502, msg, true);
  }
  console.error(e);
  return fail(500, "Terjadi kesalahan di server.", false);
}

/** Satu pekerjaan: menyusun satu bagian (data atau AI) di bawah batas waktu. Tidak pernah melempar: galat menjadi JobOutcome. */
async function produce(type: DocType, section: SectionDef, input: Input, sources: Source[]): Promise<JobOutcome> {
  const deadline = makeDeadline(budgetMs());
  try {
    let text = "";
    let stripped: string[] = [];

    if (section.kind === "data") {
      text = renderDataSection(type, section.ref ?? section.id, input);
    } else if (section.kind === "ai") {
      if (type === "RJ" && !sources.some((s) => (s.content ?? "").length >= 500)) {
        return fail(400, "Teks jurnal belum ada. Unggah PDF jurnal atau tempel teksnya di langkah 'Jurnal'.", false);
      }
      const r = await raceDeadline(generateSection(type, section.id, input, sources, section, deadline), deadline);
      text = needsReferenceMark(type, section, sources) ? markNeedsReference(r.text) : r.text;
      stripped = r.stripped;
    }

    return { status: 200, body: { text, stripped, warnings: analyzeSection(type, section, text, input, sources) } };
  } catch (e) {
    return toOutcome(e);
  } finally {
    deadline.cancel();
  }
}

/**
 * Aliran progres (NDJSON), satu objek JSON per baris:
 *  {type:"status", stage:"accepted"|"cached"|"joined"}  pekerjaan diterima / hasil lama dipakai / ikut pekerjaan yang berjalan
 *  {type:"heartbeat", elapsedMs}                         masih menulis
 *  {type:"result", text, stripped, warnings}             selesai
 *  {type:"error", status, error, retryable}              gagal; `retryable` = aman dicoba ulang dengan jobId yang sama
 */
function ndjson(outcome: Promise<JobOutcome>, stage: "accepted" | "cached" | "joined"): Response {
  const enc = new TextEncoder();
  const t0 = Date.now();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    closed = true;
    if (timer) clearInterval(timer);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (o: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          stop();
        }
      };
      send({ type: "status", stage });
      timer = setInterval(() => send({ type: "heartbeat", elapsedMs: Date.now() - t0 }), HEARTBEAT_MS);
      void outcome
        .catch((): JobOutcome => fail(500, "Terjadi kesalahan di server.", false))
        .then((o) => {
          send(o.status === 200 ? { type: "result", ...o.body } : { type: "error", status: o.status, ...o.body });
          const wasOpen = !closed;
          stop();
          if (wasOpen) {
            try {
              controller.close();
            } catch {
              /* sudah ditutup klien */
            }
          }
        });
    },
    // Klien memutus koneksi: berhenti mengirim. Pekerjaan di server tetap selesai dan hasilnya disimpan untuk percobaan ulang.
    cancel: stop,
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}

export async function POST(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  // Permintaan yang ditolak karena bentuknya salah tetap dihitung ke kuota (perilaku lama); yang lolos dihitung setelah dicek jobId.
  const reject = (error: string, status = 400) => chargeQuota(req) ?? Response.json({ error }, { status });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reject("Permintaan tidak valid.");
    body = parsed as Record<string, unknown>;
  } catch {
    return reject("Permintaan tidak valid.");
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
  if (!tpl || !section || !isInput(body.input) || !sources) return reject("Data permintaan tidak valid.");

  // T38: jobId (opsional) membuat percobaan ulang idempoten. Tanpa jobId, setiap permintaan = satu pekerjaan berkuota.
  let jobId: string | undefined;
  if (body.jobId !== undefined) {
    if (typeof body.jobId !== "string" || !JOB_ID_RE.test(body.jobId)) return reject("ID pekerjaan tidak valid.");
    jobId = body.jobId;
  }

  // T07: Reading Journal tidak pernah menerima kolom data pasien, juga bila klien mengirimnya.
  const input = tpl.type === "RJ" ? withoutPatientFields(body.input) : body.input;

  // planJob -> (chargeQuota) -> runJob harus berjalan tanpa await di antaranya, supaya dua permintaan kembar tidak sama-sama memulai pekerjaan.
  const sec: SectionDef = section;
  const key = jobId ? jobKey(clientIp(req), jobId, { docType: tpl.type, sectionId: sec.id, item: body.item ?? null, input, sources }) : null;
  const plan = key ? planJob(key) : ({ kind: "run", needsCharge: true } as const);

  let outcome: Promise<JobOutcome>;
  let stage: "accepted" | "cached" | "joined" = "accepted";
  if (plan.kind === "replay") {
    outcome = Promise.resolve(plan.outcome);
    stage = "cached";
  } else if (plan.kind === "join") {
    outcome = plan.promise;
    stage = "joined";
  } else {
    if (plan.needsCharge) {
      const limited = chargeQuota(req);
      if (limited) return limited;
    }
    const work = () => produce(tpl.type, sec, input, sources);
    outcome = key ? runJob(key, work, plan.needsCharge) : work();
  }

  if ((req.headers.get("accept") ?? "").includes("application/x-ndjson")) return ndjson(outcome, stage);

  const o = await outcome;
  return Response.json(o.body, { status: o.status });
}
