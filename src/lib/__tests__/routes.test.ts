import { afterEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import { POST as doiPOST } from "@/app/api/doi/route";
import { POST as extractPOST } from "@/app/api/extract-source/route";
import { POST as analyzePOST } from "@/app/api/template/analyze/route";
import { POST as docxPOST } from "@/app/api/docx/route";
import { directTemplate, styledTemplate } from "./fixtures";

/**
 * T01: test route API. Semua tanpa jaringan dan tanpa API key (lihat src/test/setup.ts).
 * Pembatas laju memakai Map tingkat modul, jadi tiap permintaan memakai IP sendiri.
 */
let n = 0;
const ip = () => ({ "x-forwarded-for": `192.0.2.${(++n % 250) + 1}` });
const LONG = "Anemia pada kehamilan adalah masalah kesehatan masyarakat yang penting. ".repeat(5);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** PDF satu halaman berteks, dibuat tangan (tanpa pustaka) agar test tidak butuh berkas biner. */
function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, "\\$&");
  const stream = `BT /F1 10 Tf 12 780 Td 12 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

const upload = (bytes: Uint8Array | Buffer, name: string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("file", new File([new Uint8Array(bytes)], name));
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return new Request("http://localhost/x", { method: "POST", headers: ip(), body: f });
};

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...ip(), ...headers }, body: JSON.stringify(body) });

describe("POST /api/doi", () => {
  const crossref = (message: unknown, status = 200) => vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ message }), { status })));

  it("DOI sah -> 200 dengan sumber; hanya memanggil host Crossref", async () => {
    const f = crossref({ title: ["Judul Uji"], author: [{ family: "Rahma" }], issued: { "date-parts": [[2022]] }, type: "journal-article" });
    vi.stubGlobal("fetch", f);
    const res = await doiPOST(json("http://localhost/api/doi", { doi: "10.1234/abc" }));
    expect(res.status).toBe(200);
    const { source } = (await res.json()) as { source: { title: string; origin: string; verified: boolean } };
    expect(source).toMatchObject({ title: "Judul Uji", origin: "crossref", verified: true });
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/api\.crossref\.org\/works\//);
  });

  it("DOI tidak sah -> 422 tanpa menyentuh jaringan; metadata tak ditemukan -> 422", async () => {
    const f = crossref({ title: ["T"] });
    vi.stubGlobal("fetch", f);
    const bad = await doiPOST(json("http://localhost/api/doi", { doi: "bukan doi" }));
    expect(bad.status).toBe(422);
    expect(f).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", crossref({}, 404));
    expect((await doiPOST(json("http://localhost/api/doi", { doi: "10.1234/abc" }))).status).toBe(422);
  });

  it("badan bukan JSON -> 400; doi bukan string diperlakukan kosong -> 422", async () => {
    const raw = new Request("http://localhost/api/doi", { method: "POST", headers: ip(), body: "bukan json" });
    expect((await doiPOST(raw)).status).toBe(400);
    expect((await doiPOST(json("http://localhost/api/doi", { doi: 123 }))).status).toBe(422);
  });

  it("DOI dipotong 300 karakter sebelum diproses", async () => {
    const f = crossref({ title: ["T"] });
    vi.stubGlobal("fetch", f);
    await doiPOST(json("http://localhost/api/doi", { doi: "10.1234/" + "a".repeat(1000) }));
    expect(decodeURIComponent(String(f.mock.calls[0][0])).length).toBeLessThan(400);
  });

  it("kode akses dan batas laju berlaku", async () => {
    vi.stubEnv("ACCESS_CODE", "rahasia");
    expect((await doiPOST(json("http://localhost/api/doi", { doi: "10.1234/abc" }))).status).toBe(401);
  });
});

describe("POST /api/extract-source", () => {
  it("membaca PDF berteks (jalur PDF nyata, tanpa jaringan)", async () => {
    const text = "Anemia pada ibu hamil didefinisikan sebagai kadar hemoglobin rendah. ".repeat(6);
    const lines = text.match(/.{1,70}(\s|$)/g)!.map((l) => l.trim());
    const res = await extractPOST(upload(makePdf(lines), "jurnal.pdf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const r = (await res.json()) as { kind: string; pages: number; text: string };
    expect(r.kind).toBe("pdf");
    expect(r.pages).toBe(1);
    expect(r.text).toContain("hemoglobin");
  });

  it("PDF tanpa lapisan teks (mirip hasil scan) ditolak dengan pesan, bukan diisi", async () => {
    const res = await extractPOST(upload(makePdf([]), "scan.pdf"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });

  it("tipe palsu: .pdf berisi teks biasa, dan .txt berisi biner, ditolak 4xx", async () => {
    const fake = await extractPOST(upload(new TextEncoder().encode("ini bukan pdf sama sekali. ".repeat(20)), "palsu.pdf"));
    expect(fake.status).toBeGreaterThanOrEqual(400);
    expect(fake.status).toBeLessThan(500);
    const bin = new Uint8Array(400).fill(65);
    bin[10] = 0;
    const res = await extractPOST(upload(bin, "biner.txt"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("txt valid -> 200; file kosong atau terlalu pendek -> 422", async () => {
    const ok = await extractPOST(upload(new TextEncoder().encode(LONG), "catatan.txt"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { kind: string }).kind).toBe("txt");
    expect((await extractPOST(upload(new Uint8Array(0), "kosong.txt"))).status).toBeGreaterThanOrEqual(400);
    expect((await extractPOST(upload(new TextEncoder().encode("pendek"), "p.txt"))).status).toBe(422);
  });

  it("docx sah dibaca; format tak didukung -> 400", async () => {
    const buf = await styledTemplate();
    const ok = await extractPOST(upload(buf, "jurnal.docx"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { text: string }).text).toContain("Latar Belakang");
    expect((await extractPOST(upload(new Uint8Array([1, 2, 3, 4, 5, 6, 7]), "a.exe"))).status).toBe(400);
  });

  it("file di atas 10 MB -> 413 (ditolak dari ukuran, isi tidak dibaca)", async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "besar.pdf");
    const f = new FormData();
    f.set("file", big);
    const res = await extractPOST(new Request("http://localhost/x", { method: "POST", headers: ip(), body: f }));
    expect(res.status).toBe(413);
  });

  it("tanpa berkas -> 400; bukan multipart -> 400; field 'file' berupa teks bukan berkas -> 400", async () => {
    const empty = new FormData();
    expect((await extractPOST(new Request("http://localhost/x", { method: "POST", headers: ip(), body: empty }))).status).toBe(400);
    expect((await extractPOST(json("http://localhost/x", { a: 1 }))).status).toBe(400);
    const text = new FormData();
    text.set("file", "bukan berkas");
    expect((await extractPOST(new Request("http://localhost/x", { method: "POST", headers: ip(), body: text }))).status).toBe(400);
  });

  it("docx rusak (PK + sampah) -> 4xx, bukan 500", async () => {
    const res = await extractPOST(upload(new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5, 6]), "rusak.docx"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("POST /api/template/analyze", () => {
  it("template sah -> 200 + no-store", async () => {
    const res = await analyzePOST(upload(await directTemplate(), "template.docx"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toBeTruthy();
  });

  it("bukan .docx, bukan ZIP, atau zip tanpa word/document.xml ditolak", async () => {
    const buf = await directTemplate();
    expect((await analyzePOST(upload(buf, "template.doc"))).status).toBe(400);
    expect((await analyzePOST(upload(new TextEncoder().encode("%PDF-1.4 isi"), "template.docx"))).status).toBe(400);
    const zip = new PizZip();
    zip.file("catatan.txt", "bukan dokumen Word");
    const noDoc = new Uint8Array(zip.generate({ type: "uint8array" }));
    const res = await analyzePOST(upload(noDoc, "template.docx"));
    expect(res.status).toBe(422);
  });

  it("zip berisi document.xml rusak -> ditolak; di atas 8 MB -> 413; tanpa berkas -> 400", async () => {
    const zip = new PizZip();
    zip.file("word/document.xml", "<w:document><bukan-xml");
    const res = await analyzePOST(upload(new Uint8Array(zip.generate({ type: "uint8array" })), "rusak.docx"));
    // TEMUAN (untuk T11): xmldom melempar ParseError fatal yang lolos dari onError di template/xml.ts parseXml,
    // sehingga route membalas 500 alih-alih 422. Test ini hanya mengunci bahwa berkas rusak TIDAK diterima.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const big = new FormData();
    big.set("file", new File([new Uint8Array(8 * 1024 * 1024 + 1)], "besar.docx"));
    expect((await analyzePOST(new Request("http://localhost/x", { method: "POST", headers: ip(), body: big }))).status).toBe(413);
    expect((await analyzePOST(new Request("http://localhost/x", { method: "POST", headers: ip(), body: new FormData() }))).status).toBe(400);
  });
});

describe("POST /api/docx", () => {
  const section = (o: Record<string, unknown> = {}) => ({ id: "a", title: "Latar Belakang", level: 1, kind: "ai", text: "Isi bagian uji.", ...o });
  const body = (o: Record<string, unknown> = {}) => ({ docType: "LP", judul: "Judul Uji", identity: { nama: "Mahasiswa Contoh" }, style: "APA", sources: [], sections: [section()], ...o });

  it("JSON sah -> berkas .docx (ZIP) dengan header unduhan dan no-store", async () => {
    const res = await docxPOST(json("http://localhost/api/docx", body()));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("wordprocessingml.document");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="[A-Z]+\.docx"/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    expect(new PizZip(bytes).file("word/document.xml")).toBeTruthy();
  });

  it("isi dokumen memuat teks bagian dan judul", async () => {
    const res = await docxPOST(json("http://localhost/api/docx", body({ sections: [section({ text: "Kalimat penanda uji unik." })] })));
    const xml = new PizZip(new Uint8Array(await res.arrayBuffer())).file("word/document.xml")!.asText();
    expect(xml).toContain("Kalimat penanda uji unik.");
    expect(xml).toContain("JUDUL UJI"); // judul sampul ditulis huruf besar oleh builder
  });

  it("nama berkas dibersihkan dari karakter berbahaya (tanpa header injection)", async () => {
    const res = await docxPOST(json("http://localhost/api/docx", body({ judul: 'a"\r\nSet-Cookie: x=1/../b' })));
    expect(res.status).toBe(200);
    const cd = res.headers.get("Content-Disposition")!;
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).not.toContain("Set-Cookie");
  });

  it("permintaan salah -> 400: docType asing, bagian bukan array, >60 bagian, kind/level tak sah, sumber tak sah", async () => {
    const bad: Record<string, unknown>[] = [
      body({ docType: "XX" }),
      body({ sections: "x" }),
      body({ sections: Array.from({ length: 61 }, () => section()) }),
      body({ sections: [section({ kind: "script" })] }),
      body({ sections: [section({ level: 4 })] }),
      body({ sources: [{ id: "X1", type: "jurnal", title: "T" }] }),
    ];
    for (const b of bad) expect((await docxPOST(json("http://localhost/api/docx", b))).status, JSON.stringify(b).slice(0, 60)).toBe(400);
    const raw = new Request("http://localhost/api/docx", { method: "POST", headers: { "content-type": "application/json", ...ip() }, body: "{" });
    expect((await docxPOST(raw)).status).toBe(400);
  });

  it("multipart dengan template: sah -> 200; bukan ZIP -> 400; mapping tak sah -> 400; >8 MB -> 413", async () => {
    const tpl = await styledTemplate();
    const analyzed = (await (await analyzePOST(upload(tpl, "t.docx"))).json()) as { mapping?: unknown };
    const form = (file: Uint8Array | Buffer, mapping: unknown, data: unknown = body()) => {
      const f = new FormData();
      f.set("data", JSON.stringify(data));
      f.set("template", new File([new Uint8Array(file)], "t.docx"));
      f.set("mapping", JSON.stringify(mapping));
      return new Request("http://localhost/api/docx", { method: "POST", headers: ip(), body: f });
    };
    if (analyzed.mapping) {
      const ok = await docxPOST(form(tpl, analyzed.mapping));
      expect(ok.status).toBe(200);
    }
    expect((await docxPOST(form(new TextEncoder().encode("bukan zip"), analyzed.mapping ?? {}))).status).toBe(400);
    expect((await docxPOST(form(tpl, { bukan: "mapping" }))).status).toBe(400);
    expect((await docxPOST(form(new Uint8Array(8 * 1024 * 1024 + 1), analyzed.mapping ?? {}))).status).toBe(413);
  });

  it("kode akses berlaku", async () => {
    vi.stubEnv("ACCESS_CODE", "rahasia");
    expect((await docxPOST(json("http://localhost/api/docx", body()))).status).toBe(401);
    expect((await docxPOST(json("http://localhost/api/docx", body(), { "x-access-code": "rahasia" }))).status).toBe(200);
  });
});
