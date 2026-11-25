import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiConfigError, ProviderError, callGroq, generateSection, type AiResult } from "../ai";
import { DeadlineError, makeDeadline, raceDeadline, sleepOrAbort } from "../deadline";
import { MAX_ATTEMPTS, jobKey, planJob, runJob, type JobOutcome } from "../jobs";
import { POST } from "../../app/api/generate/route";

/**
 * T38: generate lama. Test timeout serverless, percobaan ulang yang tidak memotong kuota dua kali,
 * hasil yang dipakai ulang, pekerjaan kembar, dan aliran progres. Tanpa jaringan dan tanpa API key.
 */
vi.mock("../ai", async (importOriginal) => {
  const m = await importOriginal<typeof import("../ai")>();
  return { ...m, generateSection: vi.fn(m.generateSection) };
});
const actual = await vi.importActual<typeof import("../ai")>("../ai");

// Pembatas laju per IP bersifat tingkat modul: tiap test memakai IP sendiri.
let n = 0;
const freshIp = () => `198.18.0.${++n}`;
let m = 0;
const jobId = () => `job${String(++m).padStart(6, "0")}abcdef`;

const reqBody = (o: Record<string, unknown> = {}) => ({
  docType: "LP",
  sectionId: "pengertian",
  input: { kasus: "Anemia ringan", jenis_asuhan: "Kehamilan (ANC)" },
  sources: [],
  ...o,
});
const post = (b: unknown, ip: string, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/generate", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip, ...headers }, body: JSON.stringify(b) }));

const events = async (res: Response): Promise<Record<string, unknown>[]> =>
  (await res.text())
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);

const timeoutOnce = () => vi.mocked(generateSection).mockImplementationOnce(() => Promise.reject(new DeadlineError()));

beforeEach(() => {
  vi.stubEnv("NAKESA_MOCK_AI", "1");
  vi.mocked(generateSection).mockReset();
  vi.mocked(generateSection).mockImplementation(actual.generateSection);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("T38: batas waktu server (timeout serverless)", () => {
  it("pekerjaan yang menggantung dihentikan dengan 504, bisa dicoba ulang, dan tidak membuat server ikut menggantung", async () => {
    vi.stubEnv("NAKESA_GENERATE_BUDGET_MS", "30");
    vi.mocked(generateSection).mockImplementation(() => new Promise<AiResult>(() => {}));
    const res = await post(reqBody(), freshIp());
    expect(res.status).toBe(504);
    const j = (await res.json()) as { error: string; retryable: boolean };
    expect(j.retryable).toBe(true);
    expect(j.error).toMatch(/batas waktu/i);
  });

  it("sinyal batas waktu diteruskan ke penyedia AI dan menyala saat anggaran habis", async () => {
    vi.stubEnv("NAKESA_GENERATE_BUDGET_MS", "30");
    let seen: AbortSignal | undefined;
    vi.mocked(generateSection).mockImplementation((...args) => {
      seen = args[5]?.signal;
      return new Promise<AiResult>(() => {});
    });
    const res = await post(reqBody(), freshIp());
    expect(res.status).toBe(504);
    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(true);
  });

  it("anggaran bawaan 50 detik, dan env yang lebih besar dibatasi 55 detik (aman di bawah maxDuration 60)", async () => {
    const remaining: number[] = [];
    vi.mocked(generateSection).mockImplementation((...args) => {
      remaining.push(args[5]?.remainingMs() ?? -1);
      return actual.generateSection(...args);
    });
    expect((await post(reqBody(), freshIp())).status).toBe(200);
    vi.stubEnv("NAKESA_GENERATE_BUDGET_MS", "999999999");
    expect((await post(reqBody(), freshIp())).status).toBe(200);
    expect(remaining[0]).toBeGreaterThan(49_000);
    expect(remaining[0]).toBeLessThanOrEqual(50_000);
    expect(remaining[1]).toBeGreaterThan(54_000);
    expect(remaining[1]).toBeLessThanOrEqual(55_000);
  });

  it("galat penyedia dipetakan jelas: konfigurasi 503 (tidak diulang), sumber terlalu besar 413 (tidak diulang), padat 429 dan 502 (boleh diulang)", async () => {
    const cases: [Error, number, boolean][] = [
      [new AiConfigError("Kunci belum diatur"), 503, false],
      [new ProviderError("Sumber terlalu besar", 413), 413, false],
      [new ProviderError("Kuota per menit penuh", 429), 429, true],
      [new ProviderError("Layanan bermasalah", 502), 502, true],
    ];
    for (const [err, status, retryable] of cases) {
      vi.mocked(generateSection).mockImplementationOnce(() => Promise.reject(err));
      const res = await post(reqBody(), freshIp());
      expect(res.status, err.message).toBe(status);
      expect(((await res.json()) as { retryable: boolean }).retryable, err.message).toBe(retryable);
    }
  });
});

describe("T38: percobaan ulang tidak memotong kuota dua kali", () => {
  it("mengulang jobId yang sama setelah timeout dihitung SATU kali; permintaan lain tetap dihitung", async () => {
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "2");
    const ip = freshIp();
    const id = jobId();
    timeoutOnce();
    const first = await post(reqBody({ jobId: id }), ip);
    expect(first.status).toBe(504); // kuota terpakai: 1
    const retry = await post(reqBody({ jobId: id }), ip);
    expect(retry.status).toBe(200); // ulang gratis: kuota tetap 1
    expect((await post(reqBody(), ip)).status).toBe(200); // permintaan baru: kuota 2
    expect((await post(reqBody(), ip)).status).toBe(429); // permintaan berikutnya melewati batas
  });

  it("tanpa jobId perilaku lama berlaku: setiap permintaan dihitung", async () => {
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "1");
    const ip = freshIp();
    expect((await post(reqBody(), ip)).status).toBe(200);
    expect((await post(reqBody(), ip)).status).toBe(429);
  });

  it("hasil yang sudah sukses dipakai ulang: tanpa AI baru dan tanpa kuota", async () => {
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "1");
    const ip = freshIp();
    const id = jobId();
    const a = await post(reqBody({ jobId: id }), ip);
    expect(a.status).toBe(200);
    const first = (await a.json()) as { text: string };
    const b = await post(reqBody({ jobId: id }), ip); // kuota sudah penuh, tetapi ini bukan pekerjaan baru
    expect(b.status).toBe(200);
    expect(((await b.json()) as { text: string }).text).toBe(first.text);
    expect(vi.mocked(generateSection)).toHaveBeenCalledTimes(1);
    expect((await post(reqBody(), ip)).status).toBe(429); // bukti kuota memang penuh
  });

  it("permintaan kembar yang sedang berjalan menunggu pekerjaan yang sama (satu panggilan AI, satu potongan kuota)", async () => {
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "1");
    const ip = freshIp();
    const id = jobId();
    let release: () => void = () => {};
    vi.mocked(generateSection).mockImplementation(
      () =>
        new Promise<AiResult>((resolve) => {
          release = () => resolve({ text: "Hasil bersama untuk dua permintaan.", stripped: [] });
        })
    );
    const p1 = post(reqBody({ jobId: id }), ip);
    const p2 = post(reqBody({ jobId: id }), ip);
    await vi.waitFor(() => expect(vi.mocked(generateSection)).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20)); // beri waktu p2 bergabung
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(((await a.json()) as { text: string }).text).toBe(((await b.json()) as { text: string }).text);
    expect(vi.mocked(generateSection)).toHaveBeenCalledTimes(1);
  });

  it("jobId yang sama untuk isi permintaan berbeda = pekerjaan lain (tidak bisa mengambil hasil permintaan lain)", async () => {
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "2");
    const ip = freshIp();
    const id = jobId();
    const a = await post(reqBody({ jobId: id, sectionId: "pengertian" }), ip);
    const b = await post(reqBody({ jobId: id, sectionId: "etiologi" }), ip);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(vi.mocked(generateSection)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateSection).mock.calls.map((c) => c[1])).toEqual(["pengertian", "etiologi"]);
    // Ulang permintaan pertama: hasil lama, tanpa AI baru walau kuota sudah penuh.
    expect((await post(reqBody({ jobId: id, sectionId: "pengertian" }), ip)).status).toBe(200);
    expect(vi.mocked(generateSection)).toHaveBeenCalledTimes(2);
    expect((await post(reqBody(), ip)).status).toBe(429);
  });

  it("jobId milik IP lain tidak mengambil hasil orang lain", async () => {
    const id = jobId();
    await post(reqBody({ jobId: id }), freshIp());
    await post(reqBody({ jobId: id }), freshIp());
    expect(vi.mocked(generateSection)).toHaveBeenCalledTimes(2);
  });

  it(`percobaan ulang gratis dibatasi ${MAX_ATTEMPTS} kali per potongan kuota; sesudahnya dihitung sebagai pekerjaan baru`, async () => {
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "2");
    const ip = freshIp();
    const id = jobId();
    vi.mocked(generateSection).mockImplementation(() => Promise.reject(new DeadlineError()));
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect((await post(reqBody({ jobId: id }), ip)).status).toBe(504); // kuota: 1
    expect((await post(reqBody({ jobId: id }), ip)).status).toBe(504); // percobaan ke-4: potongan kuota baru (2)
    vi.mocked(generateSection).mockImplementation(actual.generateSection);
    expect((await post(reqBody(), ip)).status).toBe(429); // kuota memang sudah 2: tanpa batas ini, permintaan ini masih lolos
  });

  it("jobId tidak sah ditolak 400", async () => {
    for (const bad of ["x", "pendek", "ada spasi di sini ya", "a".repeat(65), 12345678, null, {}]) {
      const res = await post(reqBody({ jobId: bad }), freshIp());
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(vi.mocked(generateSection)).not.toHaveBeenCalled();
  });
});

describe("T38: aliran progres (NDJSON)", () => {
  const nd = { Accept: "application/x-ndjson" };

  it("sukses: status 'accepted' lalu hasil; tanpa header Accept tetap JSON biasa", async () => {
    const res = await post(reqBody({ jobId: jobId() }), freshIp(), nd);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const ev = await events(res);
    expect(ev[0]).toEqual({ type: "status", stage: "accepted" });
    const last = ev.at(-1)!;
    expect(last.type).toBe("result");
    expect(String(last.text)).toContain("[CONTOH MODE UJI]");
    expect(Array.isArray(last.stripped)).toBe(true);

    const plain = await post(reqBody(), freshIp());
    expect(plain.headers.get("content-type")).toContain("application/json");
  });

  it("timeout: peristiwa 'error' berstatus 504 dan retryable, koneksi tetap rapi", async () => {
    timeoutOnce();
    const res = await post(reqBody({ jobId: jobId() }), freshIp(), nd);
    expect(res.status).toBe(200); // aliran sudah dimulai; status sebenarnya ada di peristiwa
    const last = (await events(res)).at(-1)!;
    expect(last).toMatchObject({ type: "error", status: 504, retryable: true });
  });

  it("permintaan ulang yang sudah selesai: stage 'cached' dan hasil sama", async () => {
    const ip = freshIp();
    const id = jobId();
    const first = (await events(await post(reqBody({ jobId: id }), ip, nd))).at(-1)!;
    const ev = await events(await post(reqBody({ jobId: id }), ip, nd));
    expect(ev[0]).toEqual({ type: "status", stage: "cached" });
    expect(ev.at(-1)!.text).toBe(first.text);
    expect(vi.mocked(generateSection)).toHaveBeenCalledTimes(1);
  });

  it("galat sebelum aliran dimulai tetap berupa status HTTP biasa (kode akses, kuota, data salah)", async () => {
    vi.stubEnv("ACCESS_CODE", "rahasia");
    expect((await post(reqBody(), freshIp(), nd)).status).toBe(401);
    vi.stubEnv("ACCESS_CODE", "");
    expect((await post({ docType: "XX" }, freshIp(), nd)).status).toBe(400);
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "1");
    const ip = freshIp();
    expect((await post(reqBody(), ip, nd)).status).toBe(200);
    expect((await post(reqBody(), ip, nd)).status).toBe(429);
  });
});

describe("T38: pencatat pekerjaan (jobs.ts)", () => {
  const ok = (): Promise<JobOutcome> => Promise.resolve({ status: 200, body: { text: "ok" } });
  const bad = (): Promise<JobOutcome> => Promise.resolve({ status: 504, body: { error: "waktu habis", retryable: true } });
  const t0 = 1_000_000;

  it("kunci bergantung pada IP, jobId, dan isi permintaan", () => {
    const k = jobKey("1.1.1.1", "abcdefgh", { a: 1 });
    expect(jobKey("1.1.1.1", "abcdefgh", { a: 1 })).toBe(k);
    expect(jobKey("1.1.1.2", "abcdefgh", { a: 1 })).not.toBe(k);
    expect(jobKey("1.1.1.1", "abcdefgi", { a: 1 })).not.toBe(k);
    expect(jobKey("1.1.1.1", "abcdefgh", { a: 2 })).not.toBe(k);
  });

  it("pekerjaan baru butuh kuota; sukses disimpan lalu diputar ulang; kedaluwarsa menjadi pekerjaan baru", async () => {
    const key = jobKey("2.2.2.2", "jobsunit01", {});
    expect(planJob(key, t0)).toEqual({ kind: "run", needsCharge: true });
    await runJob(key, ok, true, t0);
    expect(planJob(key, t0 + 1_000)).toMatchObject({ kind: "replay" });
    expect(planJob(key, Date.now() + 11 * 60_000)).toEqual({ kind: "run", needsCharge: true });
  });

  it("gagal tidak disimpan: percobaan ulang jalan tanpa kuota baru sampai batas percobaan", async () => {
    const key = jobKey("2.2.2.3", "jobsunit02", {});
    await runJob(key, bad, true, t0);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(planJob(key, t0 + 1_000)).toEqual({ kind: "run", needsCharge: false });
      await runJob(key, bad, false, t0 + 1_000);
    }
    expect(planJob(key, t0 + 1_000)).toEqual({ kind: "run", needsCharge: true });
    // Catatan kuota habis bersama jendela kuota (1 jam).
    expect(planJob(key, t0 + 3_600_001)).toEqual({ kind: "run", needsCharge: true });
  });

  it("pekerjaan yang sedang berjalan dapat diikuti", async () => {
    const key = jobKey("2.2.2.4", "jobsunit03", {});
    let finish: (o: JobOutcome) => void = () => {};
    const running = runJob(key, () => new Promise<JobOutcome>((r) => (finish = r)), true, t0);
    const plan = planJob(key, t0 + 10);
    expect(plan.kind).toBe("join");
    finish({ status: 200, body: { text: "selesai" } });
    await running;
    expect(planJob(key, t0 + 20)).toMatchObject({ kind: "replay" });
  });
});

describe("T38: batas waktu (deadline.ts)", () => {
  it("raceDeadline menolak dengan DeadlineError saat batas habis, walau pekerjaan tidak peduli sinyal", async () => {
    const d = makeDeadline(20);
    await expect(raceDeadline(new Promise<never>(() => {}), d)).rejects.toBeInstanceOf(DeadlineError);
    d.cancel();
  });

  it("raceDeadline meneruskan hasil yang datang sebelum batas, dan sudah-habis langsung ditolak", async () => {
    const d = makeDeadline(5_000);
    await expect(raceDeadline(Promise.resolve(42), d)).resolves.toBe(42);
    d.cancel();
    const late = makeDeadline(1);
    await new Promise((r) => setTimeout(r, 15));
    await expect(raceDeadline(Promise.resolve(1), late)).rejects.toBeInstanceOf(DeadlineError);
    late.cancel();
  });

  it("sleepOrAbort berhenti saat sinyal menyala", async () => {
    const d = makeDeadline(15);
    await expect(sleepOrAbort(5_000, d.signal)).rejects.toBeInstanceOf(DeadlineError);
    d.cancel();
    await expect(sleepOrAbort(1)).resolves.toBeUndefined();
  });
});

describe("T38: Groq di bawah batas waktu server", () => {
  const err429 = (retryAfter: string) => new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "retry-after": retryAfter } });

  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("429 dengan jeda lebih panjang dari sisa waktu: gagal cepat (429, boleh diulang), tidak tidur", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(err429("30")));
    vi.stubGlobal("fetch", f);
    const d = makeDeadline(1_000);
    const t = Date.now();
    await expect(callGroq("s", "u", 100, "m", d)).rejects.toMatchObject({ status: 429 });
    expect(Date.now() - t).toBeLessThan(500);
    expect(f).toHaveBeenCalledTimes(1);
    d.cancel();
  });

  it("sinyal batas waktu memutus panggilan yang menggantung -> DeadlineError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("dibatalkan", "AbortError")))))
    );
    const d = makeDeadline(20);
    await expect(callGroq("s", "u", 100, "m", d)).rejects.toBeInstanceOf(DeadlineError);
    d.cancel();
  });

  it("tanpa deadline perilaku lama tidak berubah (mengulang setelah 429 lalu berhasil)", async () => {
    const ok = new Response(JSON.stringify({ choices: [{ message: { content: "berhasil" } }] }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(err429("0")).mockResolvedValueOnce(ok));
    expect(await callGroq("s", "u", 100, "m")).toBe("berhasil");
  });
});
