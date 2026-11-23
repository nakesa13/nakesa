import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/import-url/route";
import { ExtractError } from "@/lib/extract";
import { UrlImportError } from "@/lib/netguard";
import { importUrlSource, type ImportedUrlSource } from "@/lib/urlimport";

/**
 * T04: route /api/import-url. importUrlSource dibungkus: bawaannya memanggil yang asli (validasi URL nyata, tanpa
 * jaringan karena semua kasus berbahaya ditolak sebelum DNS/koneksi), dan test tertentu menggantinya sekali pakai
 * untuk memeriksa pemetaan galat dan keluaran.
 */
vi.mock("@/lib/urlimport", async (orig) => {
  const actual = await orig<typeof import("@/lib/urlimport")>();
  return { ...actual, importUrlSource: vi.fn(actual.importUrlSource) };
});

let n = 0;
const ip = () => ({ "x-forwarded-for": `203.0.113.${(++n % 250) + 1}` });

const post = (body: unknown, headers: Record<string, string> = ip()) =>
  new Request("http://localhost/api/import-url", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const errorOf = async (r: Response) => ((await r.json()) as { error: string }).error;

const RESULT: ImportedUrlSource = {
  text: "Anemia pada kehamilan adalah masalah kesehatan masyarakat yang penting.",
  pages: null,
  truncated: false,
  chars: 70,
  kind: "html",
  title: "Anemia pada Ibu Hamil",
  provenance: { method: "url", url: "https://a.example/x", finalUrl: "https://a.example/x", fetchedAt: "2026-11-24T00:00:00.000Z", bytes: 70, sha256: "a".repeat(64), contentType: "text/html" },
};

// Blok { } disengaja: mockClear() mengembalikan fungsi, dan vitest memanggil fungsi yang dikembalikan beforeEach sebagai pembersih.
beforeEach(() => {
  vi.mocked(importUrlSource).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/import-url: input berbahaya ditolak 400 sebelum ada koneksi", () => {
  const BAD = [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "javascript:alert(1)",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:8080/admin",
    "http://[::1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://2130706433/",
    "http://user:pw@example.com/",
    "http://example.com:6379/",
  ];
  it.each(BAD)("%s", async (u) => {
    const res = await POST(post({ url: u }));
    expect(res.status).toBe(400);
    const msg = await errorOf(res);
    expect(msg).toBeTruthy();
    expect(msg).not.toContain("169.254"); // pesan galat tidak memantulkan input
  });

  it("badan bukan JSON, null, tanpa url, url bukan string, atau terlalu panjang -> 400", async () => {
    const r1 = await POST(post("bukan json"));
    expect(r1.status).toBe(400);
    expect(await errorOf(r1)).toBe("Permintaan tidak valid.");
    expect((await POST(post("null"))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ url: 123 }))).status).toBe(400);
    expect((await POST(post({ url: ["https://example.com/"] }))).status).toBe(400);
    expect((await POST(post({ url: `https://example.com/${"a".repeat(5000)}` }))).status).toBe(400);
  });
});

describe("POST /api/import-url: kode akses dan batas laju", () => {
  it("dengan ACCESS_CODE: tanpa header -> 401, dengan header yang benar lolos ke validasi", async () => {
    vi.stubEnv("ACCESS_CODE", "rahasia");
    const none = await POST(post({ url: "https://example.com/" }));
    expect(none.status).toBe(401);
    expect(importUrlSource).not.toHaveBeenCalled();
    const ok = await POST(post({ url: "" }, { ...ip(), "x-access-code": "rahasia" }));
    expect(ok.status).toBe(400); // lolos guard, ditolak validator karena URL kosong
  });

  it("30 permintaan per jam per IP; yang ke-31 -> 429", async () => {
    const fixed = { "x-forwarded-for": "198.51.100.200" };
    for (let i = 0; i < 30; i++) expect((await POST(post({ url: "" }, fixed))).status, `ke-${i + 1}`).toBe(400);
    expect((await POST(post({ url: "" }, fixed))).status).toBe(429);
  });
});

describe("POST /api/import-url: keluaran dan pemetaan galat", () => {
  it("sukses -> 200 + no-store; URL diteruskan apa adanya ke importUrlSource", async () => {
    vi.mocked(importUrlSource).mockResolvedValueOnce(RESULT);
    const res = await POST(post({ url: "https://a.example/x" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(RESULT);
    expect(importUrlSource).toHaveBeenCalledTimes(1);
    expect(importUrlSource).toHaveBeenCalledWith("https://a.example/x");
  });

  it("ExtractError dan UrlImportError meneruskan status dan pesannya", async () => {
    vi.mocked(importUrlSource).mockRejectedValueOnce(new ExtractError("Halaman tidak memuat teks yang cukup.", 422));
    const a = await POST(post({ url: "https://a.example/x" }));
    expect(a.status).toBe(422);
    expect(await errorOf(a)).toBe("Halaman tidak memuat teks yang cukup.");

    vi.mocked(importUrlSource).mockRejectedValueOnce(new UrlImportError("Ukuran file melebihi batas 10 MB.", 413));
    const b = await POST(post({ url: "https://a.example/y" }));
    expect(b.status).toBe(413);
    expect(await errorOf(b)).toBe("Ukuran file melebihi batas 10 MB.");
  });

  it("galat tak terduga -> 500 generik: detail internal dan URL tidak bocor ke klien maupun log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(importUrlSource).mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:6379 token=rahasia-internal"));
    const res = await POST(post({ url: "https://a.example/pribadi?token=abc123" }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("URL tidak dapat diproses.");
    expect(text).not.toMatch(/10\.0\.0\.5|rahasia-internal|abc123/);
    expect(log).toHaveBeenCalledWith("import-url gagal tak terduga");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/10\.0\.0\.5|rahasia-internal|abc123/);
    log.mockRestore();
  });
});
