import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../client";
import { MAX_CLIENT_ATTEMPTS, apiGenerate, isQueueFatal, isRetryable, newJobId, parseEvent, retryJob, splitNdjson, statusLabel, type GenStatus } from "../genjob";

/**
 * T38 (sisi klien): percobaan ulang dengan jobId yang sama, batas waktu klien, pembatalan, dan pembacaan aliran progres.
 * Semua tanpa jaringan: fetch diganti lewat opsi fetchImpl.
 */

const nd = (evs: unknown[], status = 200) =>
  new Response(evs.map((e) => JSON.stringify(e)).join("\n") + "\n", { status, headers: { "content-type": "application/x-ndjson" } });
const RESULT = { type: "result", text: "Isi bagian.", stripped: [], warnings: undefined };
const noSleep = () => Promise.resolve();

type Call = [RequestInfo | URL, RequestInit | undefined];
const fetchSeq = (...makers: (() => Response | Promise<Response>)[]) => {
  let i = 0;
  return vi.fn(async (...a: Call) => {
    void a;
    return makers[Math.min(i++, makers.length - 1)]();
  });
};
const asFetch = (f: unknown) => f as typeof fetch;
const sentBody = (f: ReturnType<typeof fetchSeq>, k: number) => JSON.parse(String(f.mock.calls[k][1]?.body)) as Record<string, unknown>;
/** fetch yang menggantung sampai sinyalnya menyala, lalu ditolak dengan alasan sinyal (seperti fetch sungguhan). */
const hang = (_u: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_res, rej) => {
    const sig = init?.signal;
    if (!sig) return;
    sig.addEventListener("abort", () => rej(sig.reason));
  });

describe("T38: pembantu", () => {
  it("newJobId: bentuk sah untuk server dan unik", () => {
    const a = newJobId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newJobId()).not.toBe(a);
  });

  it("splitNdjson memisahkan baris utuh dan menyisakan baris yang belum lengkap", () => {
    expect(splitNdjson('{"a":1}\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
    expect(splitNdjson("")).toEqual({ lines: [], rest: "" });
    expect(splitNdjson("\n\n")).toEqual({ lines: [], rest: "" });
  });

  it("parseEvent hanya menerima objek JSON", () => {
    expect(parseEvent('{"type":"x"}')).toEqual({ type: "x" });
    for (const bad of ["bukan json", "[1,2]", "42", "null", '"teks"']) expect(parseEvent(bad), bad).toBeNull();
  });

  it("statusLabel: teks progres yang dipahami mahasiswa", () => {
    const s = (o: Partial<GenStatus>): GenStatus => ({ stage: "writing", attempt: 1, maxAttempts: 3, ...o });
    expect(statusLabel(s({ stage: "sending" }))).toBe("Mengirim…");
    expect(statusLabel(s({ elapsedMs: 12_400 }))).toBe("Menulis… 12 dtk");
    expect(statusLabel(s({ elapsedMs: 500 }))).toBe("Menulis…");
    expect(statusLabel(s({ attempt: 2, elapsedMs: 3_000 }))).toBe("Menulis… 3 dtk (percobaan 2/3)");
    expect(statusLabel(s({ stage: "cached" }))).toMatch(/sudah selesai/);
    expect(statusLabel(s({ stage: "waiting-retry", attempt: 2, retryInMs: 2_000 }))).toBe("Gagal sementara. Mencoba lagi dalam 2 dtk (percobaan 2/3)…");
  });

  it("isRetryable / isQueueFatal", () => {
    expect(isRetryable(new ApiError("x", 504, true))).toBe(true);
    expect(isRetryable(new ApiError("x", 401, false))).toBe(false);
    expect(isRetryable(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryable(new Error("lain"))).toBe(false);
    for (const status of [401, 413, 429, 503]) expect(isQueueFatal(new ApiError("x", status, false)), String(status)).toBe(true);
    expect(isQueueFatal(new ApiError("x", 429, true))).toBe(false); // 429 dari penyedia AI: boleh dicoba lagi
    expect(isQueueFatal(new ApiError("x", 504, true))).toBe(false);
    expect(isQueueFatal(new ApiError("x", 500, false))).toBe(false);
    expect(isQueueFatal(new Error("x"))).toBe(false);
  });
});

describe("T38: retryJob", () => {
  it("mengulang galat yang aman diulang dengan jeda bertahap, lalu berhasil", async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError("waktu habis", 504, true)).mockRejectedValueOnce(new ApiError("padat", 502, true)).mockResolvedValueOnce("ok");
    const sleep = vi.fn(async (ms: number) => {
      void ms;
    });
    const onRetry = vi.fn();
    await expect(retryJob(send, { sleep, onRetry, delaysMs: [100, 300] })).resolves.toBe("ok");
    expect(send.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 300]);
    expect(onRetry.mock.calls.map((c) => c[0].nextAttempt)).toEqual([2, 3]);
  });

  it("galat yang tidak aman diulang (kode akses, data salah, sumber terlalu besar) langsung dilempar", async () => {
    for (const status of [400, 401, 413, 503]) {
      const send = vi.fn().mockRejectedValue(new ApiError("tolak", status, false));
      await expect(retryJob(send, { sleep: noSleep })).rejects.toMatchObject({ status });
      expect(send, String(status)).toHaveBeenCalledTimes(1);
    }
  });

  it(`berhenti setelah ${MAX_CLIENT_ATTEMPTS} percobaan dan melempar galat terakhir`, async () => {
    const send = vi.fn().mockRejectedValue(new ApiError("tetap gagal", 504, true));
    await expect(retryJob(send, { sleep: noSleep })).rejects.toThrow("tetap gagal");
    expect(send).toHaveBeenCalledTimes(MAX_CLIENT_ATTEMPTS);
  });

  it("pembatalan oleh pengguna tidak diulang, dan jeda tunggu ikut berhenti", async () => {
    const ctrl = new AbortController();
    const send = vi.fn().mockImplementation(() => {
      ctrl.abort();
      return Promise.reject(new ApiError("putus", 0, true));
    });
    await expect(retryJob(send, { signal: ctrl.signal, sleep: noSleep })).rejects.toThrow("putus");
    expect(send).toHaveBeenCalledTimes(1);

    const c2 = new AbortController();
    const s2 = vi.fn().mockRejectedValue(new ApiError("gagal", 504, true));
    const p = retryJob(s2, { signal: c2.signal, delaysMs: [60_000] }); // jeda panjang yang sungguhan
    await vi.waitFor(() => expect(s2).toHaveBeenCalledTimes(1));
    c2.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(s2).toHaveBeenCalledTimes(1);
  });
});

describe("T38: apiGenerate (aliran progres, jobId, timeout)", () => {
  const BODY = { docType: "LP", sectionId: "pengertian", input: {}, sources: [] };
  const run = (f: ReturnType<typeof fetchSeq>, o: Parameters<typeof apiGenerate>[3] = {}) =>
    apiGenerate(BODY, "kode-uji", "jobid12345678", { fetchImpl: asFetch(f), sleep: noSleep, ...o });

  it("mengirim jobId, kode akses, dan meminta NDJSON; hasil dikembalikan, status dilaporkan", async () => {
    const f = fetchSeq(() => nd([{ type: "status", stage: "accepted" }, { type: "heartbeat", elapsedMs: 8_000 }, RESULT]));
    const seen: GenStatus[] = [];
    const r = await run(f, { onStatus: (s) => seen.push(s) });
    expect(r).toMatchObject({ text: "Isi bagian.", stripped: [] });
    expect(sentBody(f, 0)).toMatchObject({ ...BODY, jobId: "jobid12345678" });
    const init = f.mock.calls[0][1]!;
    const h = init.headers as Record<string, string>;
    expect(h.Accept).toBe("application/x-ndjson");
    expect(h["x-access-code"]).toBe("kode-uji");
    expect(seen.map((s) => s.stage)).toEqual(["sending", "writing", "writing"]);
    expect(seen.at(-1)?.elapsedMs).toBe(8_000);
  });

  it("membaca aliran yang terpotong di tengah baris", async () => {
    const enc = new TextEncoder();
    const f = fetchSeq(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(enc.encode('{"type":"status","stage":"acc'));
              c.enqueue(enc.encode('epted"}\n{"type":"result","text":"Ha'));
              c.enqueue(enc.encode('lo","stripped":["S9"]}\n'));
              c.close();
            },
          }),
          { headers: { "content-type": "application/x-ndjson" } }
        )
    );
    expect(await run(f)).toMatchObject({ text: "Halo", stripped: ["S9"] });
  });

  it("timeout dari server (peristiwa error retryable) diulang dengan jobId YANG SAMA lalu berhasil", async () => {
    const f = fetchSeq(
      () => nd([{ type: "status", stage: "accepted" }, { type: "error", status: 504, error: "Melebihi batas waktu server.", retryable: true }]),
      () => nd([{ type: "status", stage: "accepted" }, RESULT])
    );
    const seen: GenStatus[] = [];
    const r = await run(f, { onStatus: (s) => seen.push(s) });
    expect(r.text).toBe("Isi bagian.");
    expect(f).toHaveBeenCalledTimes(2);
    expect(sentBody(f, 0).jobId).toBe("jobid12345678");
    expect(sentBody(f, 1).jobId).toBe("jobid12345678");
    expect(seen.some((s) => s.stage === "waiting-retry" && s.attempt === 2)).toBe(true);
    expect(seen.filter((s) => s.stage === "sending").map((s) => s.attempt)).toEqual([1, 2]);
  });

  it("galat HTTP yang tidak boleh diulang (kode akses salah) tidak diulang", async () => {
    const f = fetchSeq(() => Response.json({ error: "Kode akses salah." }, { status: 401 }));
    await expect(run(f)).rejects.toMatchObject({ status: 401, retryable: false, message: "Kode akses salah." });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("galat HTTP yang ditandai retryable (mis. 504 sebelum aliran) diulang", async () => {
    const f = fetchSeq(
      () => Response.json({ error: "Waktu habis.", retryable: true }, { status: 504 }),
      () => nd([RESULT])
    );
    expect((await run(f)).text).toBe("Isi bagian.");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("koneksi putus sebelum hasil (aliran selesai tanpa 'result') diulang; jaringan gagal (TypeError) diulang", async () => {
    const f = fetchSeq(
      () => nd([{ type: "status", stage: "accepted" }]),
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => nd([RESULT])
    );
    expect((await run(f)).text).toBe("Isi bagian.");
    expect(f).toHaveBeenCalledTimes(3);
    expect(new Set([0, 1, 2].map((k) => sentBody(f, k).jobId)).size).toBe(1);
  });

  it("gagal terus: berhenti di batas percobaan dengan pesan yang jelas", async () => {
    const f = fetchSeq(() => nd([{ type: "error", status: 502, error: "Layanan AI bermasalah. Coba lagi.", retryable: true }]));
    await expect(run(f)).rejects.toThrow("Layanan AI bermasalah. Coba lagi.");
    expect(f).toHaveBeenCalledTimes(MAX_CLIENT_ATTEMPTS);
  });

  it("batas waktu klien: permintaan yang menggantung dihentikan dan diulang", async () => {
    let i = 0;
    const f = vi.fn((u: RequestInfo | URL, init?: RequestInit) => (i++ === 0 ? hang(u, init) : Promise.resolve(nd([RESULT]))));
    const r = await apiGenerate(BODY, "", "jobid12345678", { fetchImpl: asFetch(f), sleep: noSleep, timeoutMs: 20 });
    expect(r.text).toBe("Isi bagian.");
    expect(f).toHaveBeenCalledTimes(2);

    const f2 = vi.fn(hang);
    await expect(apiGenerate(BODY, "", "jobid12345678", { fetchImpl: asFetch(f2), sleep: noSleep, timeoutMs: 20, maxAttempts: 1 })).rejects.toMatchObject({
      name: "ApiError",
      retryable: true,
      message: expect.stringMatching(/terlalu lama/),
    });
  });

  it("pengguna menekan Hentikan: permintaan dibatalkan dan TIDAK diulang", async () => {
    const ctrl = new AbortController();
    const f = vi.fn(hang);
    const p = apiGenerate(BODY, "", "jobid12345678", { fetchImpl: asFetch(f), sleep: noSleep, signal: ctrl.signal });
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("server tanpa aliran (JSON biasa) tetap didukung", async () => {
    const f = fetchSeq(() => Response.json({ text: "Dari JSON.", stripped: ["S2"] }));
    expect(await run(f)).toMatchObject({ text: "Dari JSON.", stripped: ["S2"] });
  });
});
