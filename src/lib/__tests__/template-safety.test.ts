import { beforeAll, describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { POST as analyzePOST } from "../../app/api/template/analyze/route";
import type { BuildInput } from "../docx-builder";
import { analyzeTemplate } from "../template/analyze";
import { buildDocxFromTemplate } from "../template/build";
import { mappingIssues } from "../template/mapping";
import { MAX_ENTRIES, openPackage } from "../template/package";
import { makeRef, mappingSha256, sameRef, stableJson } from "../template/ref";
import type { Mapping } from "../template/types";
import { TemplateError, child, elems, parseXml, serialize, textOf } from "../template/xml";
import { directTemplate, placeholderTemplate, styledTemplate } from "./fixtures";

// T11: template .docx adalah masukan tidak tepercaya. Semua berkas di sini dibuat oleh kode (anonim, tanpa data nyata).

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const BODY = "<w:p><w:r><w:t>Isi</w:t></w:r></w:p>";

function zipOf(docXml: string, extra: (zip: PizZip) => void = () => {}): Uint8Array {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", docXml);
  extra(zip);
  return new Uint8Array(zip.generate({ type: "uint8array", compression: "DEFLATE" }));
}
const docx = (extra?: (zip: PizZip) => void) => zipOf(`<w:document ${W}><w:body>${BODY}</w:body></w:document>`, extra);

const errMsg = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof TemplateError ? e.message : `BUKAN TemplateError: ${String(e)}`;
  }
  return "";
};

function editXml(buf: Buffer, part: string, fn: (xml: string) => string): Uint8Array {
  const zip = new PizZip(buf);
  zip.file(part, fn(zip.file(part)!.asText()));
  return new Uint8Array(zip.generate({ type: "uint8array" }));
}

const INPUT: BuildInput = {
  coverTitle: "LAPORAN",
  judul: "Judul Uji",
  identity: { nama: "Mahasiswa Uji", nim: "000", prodi: "Prodi Uji", kampus: "Kampus Uji", pembimbing: "Pembimbing Uji", tahun: "2026" },
  sections: [{ id: "a", title: "BAB I PENDAHULUAN", level: 1, kind: "ai", text: "Isi uji bagian satu." }],
  sources: [],
  style: "APA",
  chapterStyle: "center",
};

// Fixture dibuat sekali; diindeks dengan nama agar dapat dipakai dalam loop.
const fixtures: Record<string, Buffer> = {};
beforeAll(async () => {
  fixtures.styledTemplate = await styledTemplate();
  fixtures.directTemplate = await directTemplate();
  fixtures.placeholderTemplate = await placeholderTemplate();
});

describe("T11: paket zip tidak tepercaya", () => {
  it("nama entri dengan path traversal, jalur mutlak, backslash, atau huruf drive ditolak", () => {
    for (const name of ["../evil.xml", "word/../../evil.xml", "/abs/evil.xml", "word\\evil.xml", "C:/evil.xml"]) {
      expect(errMsg(() => openPackage(docx((z) => void z.file(name, "x")))), name).toContain("tidak aman");
    }
  });

  it("terlalu banyak entri ditolak", () => {
    const bytes = docx((z) => {
      for (let i = 0; i < MAX_ENTRIES + 5; i++) z.file(`word/media/f${i}.txt`, "x");
    });
    expect(errMsg(() => openPackage(bytes))).toContain("terlalu banyak");
  });

  it("zip bomb (isi sangat besar, terkompresi sangat kecil) ditolak sebelum dibaca", () => {
    const bytes = docx((z) => void z.file("word/media/bomb.bin", "0".repeat(6_000_000)));
    expect(bytes.length).toBeLessThan(200_000);
    expect(errMsg(() => openPackage(bytes))).toContain("tidak wajar");
  });

  it("paket berisi makro (vbaProject.bin) ditolak", () => {
    expect(errMsg(() => openPackage(docx((z) => void z.file("word/vbaProject.bin", "x"))))).toContain("makro");
  });

  it("deklarasi DOCTYPE/ENTITY (entity expansion, XXE) ditolak", () => {
    const evil = `<!DOCTYPE w:document [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><w:document ${W}><w:body>${BODY}</w:body></w:document>`;
    expect(errMsg(() => openPackage(zipOf(evil)))).toContain("tidak diizinkan");
  });

  it("XML rusak menjadi TemplateError (bukan galat lain yang berujung 500)", () => {
    expect(errMsg(() => openPackage(zipOf(`<w:document ${W}><w:body>`)))).toContain("tidak dapat dibaca");
    expect(errMsg(() => openPackage(zipOf("bukan xml sama sekali")))).toContain("tidak dapat dibaca");
  });

  it("template sah dari fixture tetap terbuka", () => {
    for (const k of ["styledTemplate", "directTemplate", "placeholderTemplate"]) {
      expect(() => openPackage(new Uint8Array(fixtures[k])), k).not.toThrow();
    }
  });
});

describe("T11: route analisis menjawab 422 untuk template berbahaya", () => {
  let n = 0;
  const post = (bytes: Uint8Array) => {
    const fd = new FormData();
    fd.set("file", new File([bytes], "template.docx"));
    return analyzePOST(new Request("http://localhost/api/template/analyze", { method: "POST", body: fd, headers: { "x-forwarded-for": `10.77.0.${++n}` } }));
  };

  it("XML rusak = 422 (sebelumnya 500)", async () => {
    expect((await post(zipOf(`<w:document ${W}><w:body>`))).status).toBe(422);
  });

  it("path traversal, zip bomb, dan makro = 422", async () => {
    expect((await post(docx((z) => void z.file("../evil.xml", "x")))).status).toBe(422);
    expect((await post(docx((z) => void z.file("word/media/bomb.bin", "0".repeat(6_000_000))))).status).toBe(422);
    expect((await post(docx((z) => void z.file("word/vbaProject.bin", "x")))).status).toBe(422);
  });
});

describe("T11: elemen yang tidak dikenal diberi peringatan, bukan dibuang diam-diam", () => {
  const TBL = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Sel contoh</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const IMG = "<w:p><w:r><w:drawing/></w:r></w:p>";
  const FN = '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>';

  // Sisipkan lewat DOM (bukan indeks string) agar elemen pasti berada langsung di bawah w:body, tepat sebelum judul Daftar Pustaka.
  const withExtras = (buf: Buffer) =>
    editXml(buf, "word/document.xml", (xml) => {
      const doc = parseXml(xml);
      const body = child(doc.documentElement, "body")!;
      const target = elems(body).find((e) => textOf(e).trim() === "DAFTAR PUSTAKA")!;
      const extras = parseXml(`<w:body ${W}>${TBL}${IMG}${FN}</w:body>`);
      for (const e of elems(extras.documentElement)) body.insertBefore(doc.importNode(e, true), target);
      return serialize(doc);
    });

  it("tabel, gambar, dan catatan kaki di area isi disebut dalam peringatan", () => {
    const a = analyzeTemplate(withExtras(fixtures.styledTemplate));
    // diagnosis: elemen sisipan harus terbaca sebagai blok tingkat atas dulu
    expect(a.blocks.some((b) => b.kind === "tbl")).toBe(true);
    expect(a.suggested.bibHeading, "judul Daftar Pustaka harus terdeteksi").not.toBeNull();
    const w = a.warnings.find((x) => x.includes("Area isi template memuat"));
    expect(w).toBeDefined();
    expect(w).toContain("1 tabel");
    expect(w).toContain("1 gambar");
    expect(w).toContain("1 catatan kaki");
  });

  it("template tanpa elemen seperti itu tidak diberi peringatan ini", () => {
    for (const k of ["styledTemplate", "directTemplate", "placeholderTemplate"]) {
      expect(analyzeTemplate(new Uint8Array(fixtures[k])).warnings.find((x) => x.includes("Area isi template memuat")), k).toBeUndefined();
    }
  });

  const linked = (buf: Buffer) =>
    editXml(buf, "word/settings.xml", (xml) =>
      xml.replace("</w:settings>", '<w:attachedTemplate xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId99"/></w:settings>')
    );

  it("tautan ke template luar diperingatkan saat analisis dan dibuang saat dokumen dibuat", async () => {
    const bytes = linked(fixtures.styledTemplate);
    const a = analyzeTemplate(bytes);
    expect(a.warnings.some((x) => x.includes("template Word lain"))).toBe(true);
    const out = await buildDocxFromTemplate(INPUT, bytes, a.suggested);
    const settings = new PizZip(out.buffer).file("word/settings.xml")!.asText();
    expect(settings).not.toContain("attachedTemplate");
    expect(settings).toContain("w:settings");
  });
});

describe("T11: pemetaan dikoreksi pengguna", () => {
  it("tebakan awal pada fixture tidak menghasilkan masalah pemetaan", () => {
    for (const k of ["styledTemplate", "directTemplate", "placeholderTemplate"]) {
      const a = analyzeTemplate(new Uint8Array(fixtures[k]));
      expect(mappingIssues(a.suggested, a.total), k).toEqual([]);
    }
  });

  it("pilihan yang akan diabaikan diberi tahu sebelum dokumen dibuat", () => {
    const a = analyzeTemplate(new Uint8Array(fixtures.styledTemplate));
    const m = a.suggested;
    const bad: Mapping = { ...m, bibHeading: m.bodyStart, tocMode: "replace", tocHeading: null, coverFields: { [String(m.bodyStart + 1)]: "nama" } };
    const text = mappingIssues(bad, a.total).join(" | ");
    expect(text).toContain("Judul Daftar Pustaka");
    expect(text).toContain("daftar isi");
    expect(text).toContain("Data sampul");
    expect(mappingIssues({ ...m, bibHeading: null, bibEnd: 5 }, a.total).join(" ")).toContain("Bagian setelah daftar pustaka");
    expect(mappingIssues({ ...m, bodyStart: a.total + 3 }, a.total).join(" ")).toContain("luar dokumen");
  });
});

describe("T11: id, versi, dan pemetaan template disimpan bersama dokumen", () => {
  const M: Mapping = { bodyStart: 5, bodyEnd: 20, bibHeading: 20, bibEnd: null, coverFields: { "1": "judul", "2": "nama" }, samples: { h1: 5, h2: 6, h3: null, body: 7 }, tocMode: "keep", tocHeading: null };
  const rec = (bytes: number[], mapping: Mapping = M, extra: { templateId?: string; version?: number } = {}) => ({
    name: "t.docx",
    size: bytes.length,
    data: new Uint8Array(bytes).buffer as ArrayBuffer,
    mapping,
    ...extra,
  });

  it("stableJson tidak bergantung pada urutan kunci", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(stableJson({ a: undefined, b: [1, { y: 1, x: 2 }] })).toBe('{"b":[1,{"x":2,"y":1}]}');
  });

  it("id = hash isi: berkas sama persis = id sama; berbeda = id beda", async () => {
    const a = await makeRef(rec([1, 2, 3]));
    const b = await makeRef(rec([1, 2, 3]));
    const c = await makeRef(rec([1, 2, 4]));
    expect(a.templateId).toMatch(/^[0-9a-f]{64}$/);
    expect(b.templateId).toBe(a.templateId);
    expect(c.templateId).not.toBe(a.templateId);
  });

  it("versi bawaan 1 untuk template lama; id yang tersimpan dipakai apa adanya", async () => {
    expect((await makeRef(rec([1]))).version).toBe(1);
    const r = await makeRef(rec([1], M, { templateId: "abc", version: 4 }));
    expect(r.version).toBe(4);
    expect(r.templateId).toBe("abc");
  });

  it("hash pemetaan stabil terhadap urutan kunci dan berubah bila pemetaan berubah", async () => {
    const reordered = { tocHeading: null, tocMode: "keep", samples: { body: 7, h3: null, h2: 6, h1: 5 }, coverFields: { "2": "nama", "1": "judul" }, bibEnd: null, bibHeading: 20, bodyEnd: 20, bodyStart: 5 } as Mapping;
    expect(await mappingSha256(reordered)).toBe(await mappingSha256(M));
    expect(await mappingSha256({ ...M, tocMode: "add" })).not.toBe(await mappingSha256(M));
  });

  it("sameRef: pemetaan atau versi berubah = beda; tanpa template = sama", async () => {
    const a = await makeRef(rec([1, 2, 3]));
    expect(sameRef(a, await makeRef(rec([1, 2, 3])))).toBe(true);
    expect(sameRef(a, await makeRef(rec([1, 2, 3], { ...M, bodyStart: 6 })))).toBe(false);
    expect(sameRef(a, await makeRef(rec([1, 2, 3], M, { version: 2 })))).toBe(false);
    expect(sameRef(null, undefined)).toBe(true);
    expect(sameRef(a, null)).toBe(false);
  });
});
