import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultDeps, fetchPublicUrl, htmlToText } from "../urlimport";

/**
 * T04: transport nyata (node:http) terhadap server lokal di 127.0.0.1. Server ini hanya dijangkau lewat
 * defaultDeps.request secara langsung (lapisan yang sengaja tidak memeriksa alamat; pemeriksaan ada di fetchPublicUrl).
 * Test lain di folder ini memakai transport tiruan.
 */

interface Seen {
  host?: string;
  url?: string;
  method?: string;
  acceptEncoding?: string;
  userAgent?: string;
}
const seen: Seen[] = [];
let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({
      host: req.headers.host,
      url: req.url,
      method: req.method,
      acceptEncoding: String(req.headers["accept-encoding"]),
      userAgent: String(req.headers["user-agent"]),
    });
    if (req.url?.startsWith("/hang")) return; // sengaja tidak menjawab
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("halo");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("defaultDeps.request: transport nyata", () => {
  it("terhubung ke IP yang sudah diperiksa (bukan me-resolve nama host) dan membawa Host asli, tanpa kompresi", async () => {
    const i = seen.length;
    // Nama host ini tidak ada di DNS. Permintaan hanya bisa sampai jika koneksi dibuat ke `address`.
    const res = await defaultDeps.request({
      url: new URL(`http://nama-situs.example:${port}/p/a?q=1&r=2#fragmen`),
      address: "127.0.0.1",
      signal: new AbortController().signal,
    });
    const chunks: Uint8Array[] = [];
    for await (const c of res.body) chunks.push(c);
    expect(res.status).toBe(200);
    expect(Buffer.concat(chunks).toString()).toBe("halo");

    expect(seen).toHaveLength(i + 1);
    expect(seen[i]).toMatchObject({ host: `nama-situs.example:${port}`, url: "/p/a?q=1&r=2", method: "GET", acceptEncoding: "identity" });
    expect(seen[i].userAgent).toMatch(/^NAKESA/);
  });

  it("sinyal batal memutus permintaan yang tidak dijawab server", async () => {
    const ctrl = new AbortController();
    const p = defaultDeps.request({ url: new URL(`http://lambat.example:${port}/hang`), address: "127.0.0.1", signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 30);
    await expect(p).rejects.toThrow();
  });
});

describe("fetchPublicUrl dengan transport asli: loopback tidak pernah dihubungi", () => {
  it("server lokal yang sedang hidup tetap ditolak 400 dan tidak menerima satu permintaan pun", async () => {
    const before = seen.length;
    for (const u of [`http://127.0.0.1:${port}/`, `http://[::1]:${port}/`, `http://localhost:${port}/`]) {
      await expect(fetchPublicUrl(u), u).rejects.toMatchObject({ status: 400 });
    }
    expect(seen).toHaveLength(before);
  });
});

describe("htmlToText: entitas ekstrem", () => {
  it("angka sangat besar, di luar Unicode, pengganti (surrogate), dan NUL tidak melempar galat atau menyisakan karakter kontrol", () => {
    const html = `<p>&#99999999999999999999; &#x110000; &#xD800; &#0; &#x0; teks aman &#${"9".repeat(400)};</p>`;
    let text = "";
    expect(() => {
      text = htmlToText(html).text;
    }).not.toThrow();
    expect(text).toContain("teks aman");
    expect(text).not.toContain("\u0000");
  });
});
