import { afterEach, describe, expect, it, vi } from "vitest";
import { DOI_RE, lookupDoi, normalizeDoi } from "../crossref";

const reply = (message: unknown, status = 200) => vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ message }), { status })));
const LONG = "Anemia pada kehamilan adalah masalah kesehatan masyarakat yang penting. ".repeat(5);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("DOI: normalisasi dan format", () => {
  it("membuang awalan URL dan 'doi:'", () => {
    expect(normalizeDoi("  https://doi.org/10.1234/ABC ")).toBe("10.1234/ABC");
    expect(normalizeDoi("http://dx.doi.org/10.1234/x")).toBe("10.1234/x");
    expect(normalizeDoi("doi: 10.1234/x")).toBe("10.1234/x");
  });
  it("hanya DOI berbentuk 10.<4-9 digit>/<tanpa spasi> yang sah", () => {
    expect(DOI_RE.test("10.1234/abc")).toBe(true);
    for (const bad of ["10.12/abc", "abc", "10.1234/a b", "10.1234/"]) expect(DOI_RE.test(bad), bad).toBe(false);
  });
});

describe("lookupDoi (Crossref di-stub)", () => {
  it("memetakan metadata, memakai host tetap, meng-encode path, dan membersihkan abstrak", async () => {
    const f = reply({
      title: ["  Judul   Uji "],
      author: [{ family: "Rahma", given: "Sari" }, { name: "Lembaga X" }, { given: "Tanpa" }],
      issued: { "date-parts": [[2022, 3]] },
      "container-title": ["Jurnal Uji"],
      volume: "10",
      issue: "2",
      page: "45-52",
      publisher: "P",
      type: "journal-article",
      abstract: `<jats:title>Abstract</jats:title><jats:p>${LONG}</jats:p>`,
      URL: "https://doi.org/10.1234/abc#1",
    });
    vi.stubGlobal("fetch", f);
    vi.stubEnv("CROSSREF_MAILTO", "a@b.id");

    const s = await lookupDoi("https://doi.org/10.1234/abc#1");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.crossref.org/works/10.1234/abc%231");
    expect(init.headers["User-Agent"]).toBe("NAKESA/0.1 (mailto:a@b.id)");
    expect(s).toMatchObject({ title: "Judul Uji", year: "2022", type: "jurnal", journal: "Jurnal Uji", volume: "10", issue: "2", pages: "45-52", doi: "10.1234/abc#1", origin: "crossref", verified: true });
    expect(s.authors).toEqual([{ family: "Rahma", given: "Sari" }, { family: "Lembaga X" }]); // penulis tanpa nama belakang/lembaga dibuang
    expect(s.content?.startsWith("Anemia")).toBe(true);
    expect(s.content).not.toMatch(/<|Abstract/);
  });

  it("abstrak pendek tidak dijadikan isi sumber; buku -> 'buku'; tahun kosong bila tidak ada", async () => {
    vi.stubGlobal("fetch", reply({ title: ["T"], type: "book", abstract: "<p>pendek</p>" }));
    const s = await lookupDoi("10.1234/abc");
    expect(s.type).toBe("buku");
    expect(s.content).toBeUndefined();
    expect(s.year).toBe("");
    expect(s.authors).toEqual([]);
  });

  it("tanpa CROSSREF_MAILTO, User-Agent tidak memuat mailto", async () => {
    const f = reply({ title: ["T"] });
    vi.stubGlobal("fetch", f);
    await lookupDoi("10.1234/abc");
    expect(f.mock.calls[0][1].headers["User-Agent"]).toBe("NAKESA/0.1");
  });

  it("DOI tidak valid ditolak sebelum menghubungi jaringan", async () => {
    const f = reply({ title: ["T"] });
    vi.stubGlobal("fetch", f);
    await expect(lookupDoi("bukan doi")).rejects.toThrow(/Format DOI/);
    expect(f).not.toHaveBeenCalled();
  });

  it("404, galat server, jaringan putus, dan metadata tanpa judul", async () => {
    vi.stubGlobal("fetch", reply({}, 404));
    await expect(lookupDoi("10.1234/abc")).rejects.toThrow(/tidak ditemukan/);
    vi.stubGlobal("fetch", reply({}, 500));
    await expect(lookupDoi("10.1234/abc")).rejects.toThrow(/status 500/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("putus")));
    await expect(lookupDoi("10.1234/abc")).rejects.toThrow(/Tidak dapat menghubungi/);
    vi.stubGlobal("fetch", reply({}));
    await expect(lookupDoi("10.1234/abc")).rejects.toThrow(/tidak lengkap/);
  });
});
