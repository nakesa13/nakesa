import { describe, expect, it } from "vitest";
import { POST as extractPOST } from "@/app/api/extract-source/route";
import { extractSourceText } from "../extract";
import { parseSources } from "../guard";
import { sha256Hex } from "../hash";
import { DOI_CHECK_HEAD_CHARS, cleanFileName, doiContentCheck, parseProvenance } from "../provenance";
import { importUrlSource, type FetchDeps } from "../urlimport";
import { makePdf, wrapLines } from "./pdf-fixture";

/**
 * T04: provenance sumber dan pemeriksaan "DOI sah != isi cocok". Semua tanpa jaringan.
 */

const TITLE = "Anemia pada Kehamilan dan Hubungannya dengan Berat Badan Lahir Rendah";
// Kata judul yang dihitung (bukan kata henti, >= 3 huruf): anemia, kehamilan, hubungannya, berat, badan, lahir, rendah = 7.

describe("doiContentCheck: DOI yang sah di Crossref belum tentu isinya cocok", () => {
  it("judul muncul di awal isi -> cocok", () => {
    expect(doiContentCheck(TITLE, `${TITLE}\nAbstrak. Penelitian ini membahas anemia.`)).toBe("cocok");
  });

  it("batas bawah 'cocok' adalah 80%: 6 dari 7 kata cocok, 5 dari 7 belum pasti", () => {
    expect(doiContentCheck(TITLE, "anemia kehamilan hubungannya berat badan lahir")).toBe("cocok"); // 6/7 = 86%
    expect(doiContentCheck(TITLE, "anemia kehamilan hubungannya berat badan")).toBe("tidak-dapat-dinilai"); // 5/7 = 71%
  });

  it("batas 'tidak cocok' adalah di bawah 50%: 4 dari 7 belum pasti, 3 dari 7 tidak cocok", () => {
    expect(doiContentCheck(TITLE, "anemia kehamilan hubungannya berat")).toBe("tidak-dapat-dinilai"); // 4/7 = 57%
    expect(doiContentCheck(TITLE, "anemia kehamilan hubungannya")).toBe("tidak-cocok"); // 3/7 = 43%
  });

  it("halaman depan yang hanya mengutip DOI artikel lain -> tidak cocok", () => {
    const text = "Halaman depan. Rujukan terkait: https://doi.org/10.1234/lain. Pengaruh kompres hangat terhadap nyeri persalinan kala I.";
    expect(doiContentCheck(TITLE, text)).toBe("tidak-cocok");
    expect(doiContentCheck(TITLE, "")).toBe("tidak-cocok");
  });

  it("hanya bagian awal isi yang dibandingkan: judul di luar batas tidak dihitung", () => {
    const filler = "lorem ipsum ".repeat(Math.ceil(DOI_CHECK_HEAD_CHARS / 12) + 1); // lebih panjang dari batas awal
    expect(filler.length).toBeGreaterThan(DOI_CHECK_HEAD_CHARS);
    expect(doiContentCheck(TITLE, `${filler}${TITLE}`)).toBe("tidak-cocok");
    expect(doiContentCheck(TITLE, `${TITLE} ${filler}`)).toBe("cocok");
  });

  it("huruf besar/kecil dan tanda aksen tidak membedakan", () => {
    expect(doiContentCheck("Étude sur l'anémie gravidique", "ETUDE SUR L'ANEMIE GRAVIDIQUE. Résumé.")).toBe("cocok");
  });

  it("judul terlalu pendek, hanya kata henti, kata berulang, atau bukan huruf Latin -> tidak dapat dinilai (tidak pernah 'cocok')", () => {
    expect(doiContentCheck("Anemia ibu", "Anemia ibu hamil")).toBe("tidak-dapat-dinilai");
    expect(doiContentCheck("the and for with from that", "the and for with from that")).toBe("tidak-dapat-dinilai");
    expect(doiContentCheck("anemia anemia anemia anemia", "anemia anemia")).toBe("tidak-dapat-dinilai");
    expect(doiContentCheck("贫血与妊娠", "贫血与妊娠")).toBe("tidak-dapat-dinilai");
    expect(doiContentCheck("", "apa saja")).toBe("tidak-dapat-dinilai");
  });
});

describe("cleanFileName: nama berkas dari pengguna", () => {
  it("membuang path (Windows dan Unix), karakter kontrol, dan spasi tepi", () => {
    expect(cleanFileName("C:\\fakultas\\jurnal anemia.pdf")).toBe("jurnal anemia.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("..\\..\\x.docx")).toBe("x.docx");
    expect(cleanFileName("a\u0000b\r\nc.pdf")).toBe("abc.pdf");
    expect(cleanFileName("  spasi.pdf  ")).toBe("spasi.pdf");
    expect(cleanFileName("folder/")).toBe("");
  });

  it("dibatasi 120 karakter", () => {
    expect(cleanFileName(`${"x".repeat(300)}.pdf`)).toHaveLength(120);
  });
});

describe("parseProvenance: data dari klien tidak dipercaya", () => {
  const valid = {
    method: "url",
    url: "https://a.example/x",
    finalUrl: "https://a.example/y",
    fileName: "f.pdf",
    fetchedAt: "2026-11-24T00:00:00.000Z",
    contentType: "text/html",
    bytes: 1234,
    sha256: "a".repeat(64),
    doiInText: "10.1234/x",
    doiCheck: "cocok",
  };

  it("bentuk sah diterima apa adanya; bytes pecahan dibulatkan ke bawah", () => {
    expect(parseProvenance(valid)).toEqual(valid);
    expect(parseProvenance({ ...valid, bytes: 1234.9 })).toEqual(valid);
  });

  it("bukan objek, method asing, atau waktu tidak sah -> undefined", () => {
    for (const v of [null, undefined, "x", 1, true, []]) expect(parseProvenance(v), JSON.stringify(v)).toBeUndefined();
    for (const m of ["ftp", "", undefined, 1]) expect(parseProvenance({ ...valid, method: m }), String(m)).toBeUndefined();
    for (const t of [undefined, "", "bukan tanggal", 123, null]) expect(parseProvenance({ ...valid, fetchedAt: t }), String(t)).toBeUndefined();
  });

  it("teks panjang dipotong ke batas", () => {
    const p = parseProvenance({ ...valid, url: "u".repeat(5000), finalUrl: "f".repeat(5000), fileName: "n".repeat(500), contentType: "c".repeat(300), doiInText: "d".repeat(1000) })!;
    expect(p.url).toHaveLength(2048);
    expect(p.finalUrl).toHaveLength(2048);
    expect(p.fileName).toHaveLength(120);
    expect(p.contentType).toHaveLength(100);
    expect(p.doiInText).toHaveLength(200);
  });

  it("sha256, bytes, dan doiCheck yang tidak sah dibuang, bukan dipercaya", () => {
    for (const sha of ["A".repeat(64), "a".repeat(63), "zz".repeat(32), 5]) expect(parseProvenance({ ...valid, sha256: sha })!.sha256, String(sha)).toBeUndefined();
    for (const b of [-1, Number.NaN, Number.POSITIVE_INFINITY, "5", null]) expect(parseProvenance({ ...valid, bytes: b })!.bytes, String(b)).toBeUndefined();
    expect(parseProvenance({ ...valid, bytes: 0 })!.bytes).toBe(0);
    expect(parseProvenance({ ...valid, doiCheck: "pasti-cocok" })!.doiCheck).toBeUndefined();
  });

  it("kunci tak dikenal (termasuk __proto__) tidak ikut terbawa", () => {
    const evil = JSON.parse('{"method":"file","fetchedAt":"2026-11-24T00:00:00Z","isAdmin":true,"__proto__":{"polluted":1}}');
    const p = parseProvenance(evil)!;
    expect(p).toEqual({ method: "file", fetchedAt: "2026-11-24T00:00:00Z" });
    expect((p as unknown as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("parseSources membawa provenance yang sah saja", () => {
  const base = { id: "S1", type: "web", title: "Judul", authors: [], year: "2026" };
  const prov = { method: "url", url: "https://a.example/", fetchedAt: "2026-11-24T00:00:00.000Z", sha256: "b".repeat(64), doiCheck: "tidak-cocok" };

  it("provenance sah dipertahankan; yang rusak atau tidak ada tidak menambah kunci", () => {
    expect(parseSources([{ ...base, provenance: prov }])![0].provenance).toEqual(prov);
    expect("provenance" in parseSources([{ ...base, provenance: { method: "x" } }])![0]).toBe(false);
    expect("provenance" in parseSources([base])![0]).toBe(false);
  });
});

describe("integritas provenance PDF: ukuran dan sha256 dihitung dari byte asli, bukan dari buffer yang sudah dipindah pdf.js", () => {
  const TEXT = "Anemia pada ibu hamil didefinisikan sebagai kadar hemoglobin rendah. ".repeat(6);
  const pdf = makePdf(wrapLines(TEXT));

  it("extractSourceText tidak merusak byte milik pemanggil", async () => {
    const mine = pdf.slice();
    const r = await extractSourceText(mine, "jurnal.pdf");
    expect(r.kind).toBe("pdf");
    expect(mine.length).toBe(pdf.length);
    expect(sha256Hex(mine)).toBe(sha256Hex(pdf));
  });

  it("POST /api/extract-source: provenance file memuat ukuran dan hash file yang diunggah", async () => {
    const f = new FormData();
    f.set("file", new File([new Uint8Array(pdf)], "jurnal.pdf"));
    const res = await extractPOST(new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": "198.51.100.10" }, body: f }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provenance: Record<string, unknown> };
    expect(body.provenance).toMatchObject({ method: "file", fileName: "jurnal.pdf", bytes: pdf.length, sha256: sha256Hex(pdf) });
  });

  it("importUrlSource: provenance URL memuat ukuran dan hash PDF yang diunduh", async () => {
    const deps: FetchDeps = {
      resolve: async () => ["93.184.216.34"],
      request: async () => ({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: (async function* () {
          yield pdf;
        })(),
        destroy: () => {},
      }),
    };
    const r = await importUrlSource("https://a.example/j.pdf", deps, () => new Date("2026-11-24T00:00:00Z"));
    expect(r.kind).toBe("pdf");
    expect(r.pages).toBe(1);
    expect(r.text).toContain("hemoglobin");
    expect(r.provenance).toMatchObject({ method: "url", contentType: "application/pdf", bytes: pdf.length, sha256: sha256Hex(pdf), fetchedAt: "2026-11-24T00:00:00.000Z" });
  });
});
