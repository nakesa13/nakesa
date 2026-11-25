import { ApiError, apiFail, apiHeaders } from "./client";
import type { SectionWarnings } from "./types";

/**
 * T38: generate per subbab yang tahan lama/gagal.
 *  - Satu `jobId` per penulisan satu bagian, dipakai ulang di setiap percobaan ulang, sehingga server memotong kuota SEKALI
 *    dan tidak memanggil AI dua kali untuk pekerjaan yang sama (lihat src/lib/jobs.ts).
 *  - Aliran progres (NDJSON) dari /api/generate: status, penanda hidup, hasil/galat.
 *  - Batas waktu sisi klien, percobaan ulang otomatis hanya untuk galat yang aman diulang, dan pembatalan oleh pengguna.
 */

/** Total percobaan (pertama + ulang) per pekerjaan. Sama dengan MAX_ATTEMPTS di server: semuanya berbagi satu potongan kuota. */
export const MAX_CLIENT_ATTEMPTS = 3;
/** Sedikit di atas anggaran server (50 detik) agar galat "waktu habis" dari server sempat tiba lebih dulu. */
export const CLIENT_TIMEOUT_MS = 70_000;
/** Jeda sebelum percobaan ke-2 dan ke-3 (ms). */
export const RETRY_DELAYS_MS = [2_000, 6_000];

export interface GenerateResult {
  text: string;
  stripped: string[];
  warnings?: SectionWarnings;
}

export interface GenStatus {
  stage: "sending" | "writing" | "cached" | "waiting-retry";
  attempt: number;
  maxAttempts: number;
  /** Lama menulis menurut penanda hidup server. */
  elapsedMs?: number;
  /** Untuk "waiting-retry": jeda sebelum percobaan berikutnya. */
  retryInMs?: number;
}

export function statusLabel(s: GenStatus): string {
  const tail = s.attempt > 1 ? ` (percobaan ${s.attempt}/${s.maxAttempts})` : "";
  switch (s.stage) {
    case "sending":
      return `Mengirim…${tail}`;
    case "writing":
      return s.elapsedMs && s.elapsedMs >= 1_000 ? `Menulis… ${Math.round(s.elapsedMs / 1_000)} dtk${tail}` : `Menulis…${tail}`;
    case "cached":
      return "Mengambil hasil yang sudah selesai…";
    case "waiting-retry":
      return `Gagal sementara. Mencoba lagi dalam ${Math.max(1, Math.ceil((s.retryInMs ?? 0) / 1_000))} dtk (percobaan ${s.attempt}/${s.maxAttempts})…`;
  }
}

/** ID pekerjaan acak; cocok dengan JOB_ID_RE di server. */
export function newJobId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return (rnd() + rnd() + rnd() + rnd()).padEnd(16, "0");
}

// ---------- percobaan ulang ----------

/** Aman diulang dengan jobId yang sama: galat yang ditandai server `retryable`, atau jaringan/waktu habis di klien. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof ApiError) return e.retryable;
  return e instanceof TypeError; // fetch gagal menghubungi server
}

/**
 * Galat yang akan sama untuk bagian berikutnya (kode akses salah, kuota habis, layanan belum dikonfigurasi, sumber terlalu besar):
 * antrean "Tulis semua" berhenti alih-alih menembak sisa bagian dengan hasil yang sama.
 */
export function isQueueFatal(e: unknown): boolean {
  return e instanceof ApiError && !e.retryable && [401, 413, 429, 503].includes(e.status);
}

const abortError = () => new DOMException("Dibatalkan.", "AbortError");

export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    function onAbort() {
      clearTimeout(t);
      reject(abortError());
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RetryOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  delaysMs?: number[];
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Dipanggil sebelum menunggu percobaan berikutnya. */
  onRetry?: (info: { nextAttempt: number; maxAttempts: number; retryInMs: number; error: unknown }) => void;
}

/** Menjalankan `send` sampai berhasil, galatnya tidak aman diulang, percobaan habis, atau pengguna membatalkan. */
export async function retryJob<T>(send: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const max = Math.max(1, opts.maxAttempts ?? MAX_CLIENT_ATTEMPTS);
  const delays = opts.delaysMs ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? sleepAbortable;
  for (let attempt = 1; ; attempt++) {
    try {
      return await send(attempt);
    } catch (e) {
      if (opts.signal?.aborted) throw e; // pengguna menghentikan: jangan diulang
      if (attempt >= max || !isRetryable(e)) throw e;
      const wait = delays.length ? delays[Math.min(attempt - 1, delays.length - 1)] : 0;
      opts.onRetry?.({ nextAttempt: attempt + 1, maxAttempts: max, retryInMs: wait, error: e });
      await sleep(wait, opts.signal);
    }
  }
}

// ---------- aliran NDJSON ----------

/** Memecah penyangga teks menjadi baris utuh dan sisa (baris yang belum lengkap). */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim()), rest };
}

export function parseEvent(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface SendOptions {
  signal?: AbortSignal;
  onStatus?: (s: GenStatus) => void;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Untuk test. */
  fetchImpl?: typeof fetch;
}

/** Satu percobaan: kirim, baca aliran, kembalikan hasil atau lempar ApiError. */
export async function sendGenerateOnce(body: Record<string, unknown>, accessCode: string, jobId: string, attempt: number, opts: SendOptions = {}): Promise<GenerateResult> {
  const maxAttempts = opts.maxAttempts ?? MAX_CLIENT_ATTEMPTS;
  const status = (s: Omit<GenStatus, "attempt" | "maxAttempts">) => opts.onStatus?.({ ...s, attempt, maxAttempts });
  status({ stage: "sending" });

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? CLIENT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const doFetch = opts.fetchImpl ?? fetch;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const res = await doFetch("/api/generate", {
      method: "POST",
      headers: { ...(apiHeaders(accessCode, true) as Record<string, string>), Accept: "application/x-ndjson" },
      body: JSON.stringify({ ...body, jobId }),
      signal,
    });
    if (!res.ok) return await apiFail(res);

    // Server lama/proxy yang tidak mengalirkan: jawaban JSON biasa.
    if (!(res.headers.get("content-type") ?? "").includes("ndjson") || !res.body) {
      const j = (await res.json()) as GenerateResult;
      return { text: String(j.text ?? ""), stripped: Array.isArray(j.stripped) ? j.stripped : [], warnings: j.warnings };
    }

    reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    // Penampung objek: penugasan di dalam closure `handle` tidak dilacak oleh penyempitan tipe variabel biasa.
    const out: { result: GenerateResult | null } = { result: null };

    const handle = (line: string) => {
      const ev = parseEvent(line);
      if (!ev) return;
      switch (ev.type) {
        case "status":
          status(ev.stage === "cached" ? { stage: "cached" } : { stage: "writing", elapsedMs: 0 });
          break;
        case "heartbeat":
          status({ stage: "writing", elapsedMs: Number(ev.elapsedMs) || 0 });
          break;
        case "result":
          out.result = {
            text: String(ev.text ?? ""),
            stripped: Array.isArray(ev.stripped) ? ev.stripped.filter((x): x is string => typeof x === "string") : [],
            warnings: ev.warnings as SectionWarnings | undefined,
          };
          break;
        case "error":
          throw new ApiError(String(ev.error ?? "Gagal menulis bagian ini."), Number(ev.status) || 502, ev.retryable === true);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      buf += done ? dec.decode() : dec.decode(value, { stream: true });
      const { lines, rest } = splitNdjson(buf);
      buf = rest;
      lines.forEach(handle);
      if (done) {
        if (buf.trim()) handle(buf);
        break;
      }
    }
    if (!out.result) throw new ApiError("Koneksi terputus sebelum hasil diterima. Coba lagi.", 0, true);
    return out.result;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (opts.signal?.aborted) throw e; // dibatalkan pengguna
    if (timeout.aborted) throw new ApiError("Server terlalu lama merespons. Coba lagi.", 0, true);
    throw new ApiError("Koneksi ke server terputus. Periksa internet Anda lalu coba lagi.", 0, true);
  } finally {
    reader?.cancel().catch(() => {});
  }
}

/**
 * Menulis satu bagian lewat /api/generate: aliran progres, batas waktu, dan percobaan ulang dengan jobId yang sama.
 * Pemanggil membuat `jobId` sekali per pekerjaan (newJobId) dan menyimpannya selama pekerjaan belum berhasil.
 */
export function apiGenerate(body: Record<string, unknown>, accessCode: string, jobId: string, opts: SendOptions & Pick<RetryOptions, "delaysMs" | "sleep"> = {}): Promise<GenerateResult> {
  const maxAttempts = opts.maxAttempts ?? MAX_CLIENT_ATTEMPTS;
  return retryJob((attempt) => sendGenerateOnce(body, accessCode, jobId, attempt, { ...opts, maxAttempts }), {
    signal: opts.signal,
    maxAttempts,
    delaysMs: opts.delaysMs,
    sleep: opts.sleep,
    onRetry: ({ nextAttempt, retryInMs }) => opts.onStatus?.({ stage: "waiting-retry", attempt: nextAttempt, maxAttempts, retryInMs }),
  });
}
