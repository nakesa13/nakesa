import { afterEach, describe, expect, it, vi } from "vitest";
import { guard, isInput, parseSources } from "../guard";

// Pembatas laju memakai Map di tingkat modul, jadi tiap test memakai IP sendiri.
let n = 0;
const req = (headers: Record<string, string> = {}) => new Request("http://localhost/x", { method: "POST", headers });
const freshIp = () => ({ "x-forwarded-for": `198.51.100.${++n}` });

afterEach(() => vi.unstubAllEnvs());

describe("guard: kode akses", () => {
  it("tanpa ACCESS_CODE di server, permintaan diterima", () => {
    expect(guard(req(freshIp()))).toBeNull();
  });

  it("dengan ACCESS_CODE: header kosong atau salah ditolak 401, yang benar diterima", async () => {
    vi.stubEnv("ACCESS_CODE", "rahasia");
    const ip = freshIp();
    const none = guard(req(ip));
    expect(none?.status).toBe(401);
    expect(((await none!.json()) as { error: string }).error).toMatch(/Kode akses/);
    expect(guard(req({ ...ip, "x-access-code": "salah" }))?.status).toBe(401);
    expect(guard(req({ ...ip, "x-access-code": "rahasia" }))).toBeNull();
  });
});

describe("guard: batas permintaan per IP", () => {
  it("melewati batas -> 429; IP lain tidak terpengaruh", () => {
    const ip = { "x-forwarded-for": "203.0.113.1, 10.0.0.1" }; // hanya elemen pertama yang dipakai
    expect(guard(req(ip), 2)).toBeNull();
    expect(guard(req(ip), 2)).toBeNull();
    expect(guard(req(ip), 2)?.status).toBe(429);
    expect(guard(req(freshIp()), 2)).toBeNull();
    expect(guard(req({ "x-forwarded-for": "10.0.0.1" }), 2)).toBeNull();
  });

  it("batas bawaan dari RATE_LIMIT_PER_HOUR", () => {
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "1");
    const ip = freshIp();
    expect(guard(req(ip))).toBeNull();
    expect(guard(req(ip))?.status).toBe(429);
  });

  it("CATATAN T25: hitungan dibagi antar route (satu bucket per IP), batas terkecil yang berlaku", () => {
    const ip = freshIp();
    expect(guard(req(ip), 1)).toBeNull(); // route A, batas 1
    expect(guard(req(ip), 60)).toBeNull(); // route B, batas 60: masih lolos
    expect(guard(req(ip), 1)?.status).toBe(429); // route A lagi: sudah terhitung 3
  });
});

describe("isInput", () => {
  it("menerima objek string -> string dalam batas", () => {
    expect(isInput({})).toBe(true);
    expect(isInput({ a: "b" })).toBe(true);
    expect(isInput({ ["k".repeat(40)]: "x".repeat(80_000) })).toBe(true);
    expect(isInput(Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`k${i}`, "v"])))).toBe(true);
  });

  it("menolak bentuk lain dan yang melewati batas", () => {
    const bad: unknown[] = [
      null,
      undefined,
      [],
      "x",
      1,
      { a: 1 },
      { a: null },
      { ["k".repeat(41)]: "x" },
      { a: "x".repeat(80_001) },
      Object.fromEntries(Array.from({ length: 121 }, (_, i) => [`k${i}`, "v"])),
    ];
    for (const v of bad) expect(isInput(v), JSON.stringify(v)?.slice(0, 40)).toBe(false);
  });
});

describe("parseSources", () => {
  const src = { id: "S1", type: "jurnal", title: " Judul ", authors: [{ family: "A", given: "B" }], year: " 2022 ", origin: "crossref", verified: true, doi: "10.1/x" };

  it("membersihkan dan membatasi isian", () => {
    const out = parseSources([{ ...src, content: "x".repeat(90_000), authors: [{ family: "A", given: "B" }, { family: "" }, null, { family: "C".repeat(200) }] }])!;
    expect(out[0].title).toBe("Judul");
    expect(out[0].year).toBe("2022");
    expect(out[0].content).toHaveLength(80_000);
    expect(out[0].authors.map((a) => a.family.length)).toEqual([1, 120]);
    expect(out[0].origin).toBe("crossref");
    expect(out[0].verified).toBe(true);
  });

  it("verified hanya true bila benar-benar boolean true; origin tak dikenal menjadi manual", () => {
    expect(parseSources([{ ...src, verified: "true" }])![0].verified).toBe(false);
    expect(parseSources([{ ...src, origin: "x" }])![0].origin).toBe("manual");
    expect(parseSources([{ ...src, authors: "bukan daftar" }])![0].authors).toEqual([]);
  });

  it("daftar kosong sah; bentuk salah = null", () => {
    expect(parseSources([])).toEqual([]);
    const bad: unknown[] = [undefined, "x", {}, [null], [{ ...src, id: "X1" }], [{ ...src, id: "S1000" }], [{ ...src, title: "  " }], [{ ...src, title: "x".repeat(501) }], [{ ...src, type: "video" }]];
    for (const v of bad) expect(parseSources(v), JSON.stringify(v)?.slice(0, 40)).toBeNull();
  });

  it("maksimal 40 sumber", () => {
    const make = (k: number) => Array.from({ length: k }, (_, i) => ({ ...src, id: `S${i + 1}` }));
    expect(parseSources(make(40))).not.toBeNull();
    expect(parseSources(make(41))).toBeNull();
  });
});
