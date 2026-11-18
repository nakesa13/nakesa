import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiConfigError, ProviderError, callGroq, currentProvider, groqModel, limitsFor } from "../ai";

const ok = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const err = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message } }), { status, headers });

beforeEach(() => {
  process.env.GROQ_API_KEY = "gsk_test";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GROQ_MODEL;
  delete process.env.GROQ_MODEL_LONG;
});

describe("Groq", () => {
  it("mengirim permintaan yang benar dan mengembalikan teks", async () => {
    const f = vi.fn().mockResolvedValue(ok("  Halo  "));
    vi.stubGlobal("fetch", f);
    expect(await callGroq("SYS", "USER", 500, "m1")).toBe("Halo");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer gsk_test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("m1");
    expect(body.max_completion_tokens).toBe(500);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });

  it("model penalaran gpt-oss: usaha rendah dan anggaran token ditambah; model lain tidak diubah", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(ok("ok")));
    vi.stubGlobal("fetch", f);
    await callGroq("s", "u", 500, "openai/gpt-oss-120b");
    const b1 = JSON.parse(f.mock.calls[0][1].body);
    expect(b1.reasoning_effort).toBe("low");
    expect(b1.max_completion_tokens).toBe(1500);
    await callGroq("s", "u", 500, "qwen/qwen3.8-27b");
    const b2 = JSON.parse(f.mock.calls[1][1].body);
    expect(b2.reasoning_effort).toBeUndefined();
    expect(b2.max_completion_tokens).toBe(500);
  });

  it("mengulang setelah 429 lalu berhasil", async () => {
    const f = vi.fn().mockResolvedValueOnce(err(429, "Rate limit reached", { "retry-after": "0" })).mockResolvedValueOnce(ok("berhasil"));
    vi.stubGlobal("fetch", f);
    expect(await callGroq("s", "u", 100, "m")).toBe("berhasil");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("menyerah dengan pesan ramah bila 429 terus-menerus", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(err(429, "Rate limit reached", { "retry-after": "0" })));
    vi.stubGlobal("fetch", f);
    await expect(callGroq("s", "u", 100, "m")).rejects.toMatchObject({ status: 429 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("413 / request too large -> pesan agar sumber diperpendek", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(413, "Request too large for model on tokens per minute (TPM)")));
    await expect(callGroq("s", "u", 100, "m")).rejects.toThrow(/terlalu besar/);
  });

  it("401 -> AiConfigError; tanpa kunci -> AiConfigError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(401, "Invalid API Key")));
    await expect(callGroq("s", "u", 100, "m")).rejects.toBeInstanceOf(AiConfigError);
    delete process.env.GROQ_API_KEY;
    await expect(callGroq("s", "u", 100, "m")).rejects.toBeInstanceOf(AiConfigError);
  });

  it("model tidak ada -> pesan menyebut nama model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(404, "The model `xyz` does not exist")));
    await expect(callGroq("s", "u", 100, "xyz")).rejects.toThrow(/Model "xyz"/);
  });

  it("gagal jaringan -> ProviderError 502; balasan kosong -> ProviderError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(callGroq("s", "u", 100, "m")).rejects.toBeInstanceOf(ProviderError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok("   ")));
    await expect(callGroq("s", "u", 100, "m")).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("pemilihan penyedia dan model", () => {
  it("AI_PROVIDER eksplisit menang; tanpa itu, Groq dipakai bila hanya kunci Groq ada", () => {
    process.env.AI_PROVIDER = "anthropic";
    expect(currentProvider()).toBe("anthropic");
    delete process.env.AI_PROVIDER;
    expect(currentProvider()).toBe("groq");
    process.env.ANTHROPIC_API_KEY = "x";
    expect(currentProvider()).toBe("anthropic");
  });
  it("bawaan memakai pengganti resmi Groq; bisa diganti lewat env", () => {
    expect(groqModel("LP")).toBe("openai/gpt-oss-120b");
    expect(groqModel("RJ")).toBe("openai/gpt-oss-120b");
    process.env.GROQ_MODEL = "a";
    process.env.GROQ_MODEL_LONG = "b";
    expect([groqModel("LK"), groqModel("RJ")]).toEqual(["a", "b"]);
  });
  it("batas sumber Groq lebih kecil dari Claude; teks jurnal muat di 8.000 token/menit dan bisa dinaikkan", () => {
    expect(limitsFor("groq").total).toBeLessThan(limitsFor("anthropic").total);
    expect(limitsFor("groq").journal).toBeLessThan(limitsFor("anthropic").journal);
    process.env.GROQ_JOURNAL_CHARS = "60000";
    expect(limitsFor("groq").journal).toBe(60000);
    delete process.env.GROQ_JOURNAL_CHARS;
  });
});
