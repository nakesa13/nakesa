import PizZip from "pizzip";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as docxPOST } from "../../app/api/docx/route";
import type { BuildInput, BuildResult } from "../docx-builder";
import { inspectDocx } from "../docx-check";
import { analyzeTemplate } from "../template/analyze";
import { buildDocxFromTemplate } from "../template/build";
import { parseMapping } from "../template/mapping";
import { attr, child, descendants, parseXml, textOf } from "../template/xml";
import type { Source } from "../types";
import { directTemplate, placeholderTemplate, styledTemplate } from "./fixtures";

// T11/T12: hasil dari template kampus harus berstruktur sama dengan template (urutan heading, nama style, bagian halaman, TOC field,
// daftar pustaka di tempat yang sama). Semua berkas dibuat oleh kode dengan data fiktif.

const SRC: Source = { id: "S1", type: "jurnal", title: "Judul artikel uji", authors: [{ family: "Rahma", given: "Sari" }], year: "2022", journal: "Jurnal Uji", origin: "manual", verified: false, content: "x".repeat(300) };

function input(over: Partial<BuildInput> = {}): BuildInput {
  return {
    coverTitle: "LAPORAN PENDAHULUAN",
    judul: "Asuhan Kebidanan pada Ibu Bersalin",
    identity: { nama: "Siti Aminah", nim: "2301001", prodi: "D III Kebidanan", kampus: "Poltekkes Baru", pembimbing: "Dr. Bidan, M.Keb", tahun: "2026" },
    sections: [
      { id: "a", title: "BAB I PENDAHULUAN", level: 1, kind: "heading", text: "" },
      { id: "b", title: "A. Latar Belakang", level: 2, kind: "ai", text: "Persalinan adalah proses penting [S1]." },
      { id: "c", title: "1. Pengertian", level: 3, kind: "ai", text: "Ibu mengeluh nyeri." },
    ],
    sources: [SRC],
    style: "APA",
    chapterStyle: "center",
    ...over,
  };
}

const read = (buf: Uint8Array, name: string): string => new PizZip(buf).file(name)?.asText() ?? "";
const names = (buf: Uint8Array): string[] => Object.keys(new PizZip(buf).files).filter((n) => !new PizZip(buf).files[n].dir);
const count = (xml: string, re: RegExp): number => (xml.match(re) ?? []).length;
const docXml = (buf: Uint8Array): string => read(buf, "word/document.xml");

function paras(buf: Uint8Array) {
  const body = child(parseXml(docXml(buf)).documentElement, "body")!;
  return descendants(body, "p").map((p) => ({ p, style: attr(child(child(p, "pPr"), "pStyle"), "val"), text: textOf(p).trim() }));
}
const texts = (buf: Uint8Array): string[] => paras(buf).map((x) => x.text);
const headings = (buf: Uint8Array) => paras(buf).filter((x) => x.style && /^Heading\d$/.test(x.style)).map((x) => ({ style: x.style, text: x.text }));
/** Atribut penting tiap bagian halaman: ukuran, margin, penomoran, dan rujukan header/footer. */
const sectionProps = (xml: string): string[] => xml.match(/<w:(?:pgSz|pgMar|pgNumType|headerReference|footerReference)\b[^>]*>/g) ?? [];

function editXml(buf: Uint8Array | Buffer, fn: (xml: string) => string): Uint8Array {
  const zip = new PizZip(buf);
  zip.file("word/document.xml", fn(zip.file("word/document.xml")!.asText()));
  return new Uint8Array(zip.generate({ type: "uint8array" }));
}
/**
 * Sisipkan potongan XML tepat sebelum paragraf yang memuat teks `marker`. Kemunculan TERAKHIR yang dipakai: pembuat template mengisi
 * entri daftar isi dengan judul yang sama, jadi kemunculan pertama bisa ada di daftar isi, bukan di isi dokumen.
 */
function insertBefore(xml: string, marker: string, snippet: string): string {
  const at = xml.lastIndexOf(marker);
  if (at < 0) throw new Error(`penanda tidak ditemukan: ${marker}`);
  const start = Math.max(xml.lastIndexOf("<w:p>", at), xml.lastIndexOf("<w:p ", at));
  return xml.slice(0, start) + snippet + xml.slice(start);
}

/** Masalah yang berarti: galat struktur dan sitasi yang tidak cocok dengan entri (peringatan lain tidak relevan di sini). */
const bad = (r: ReturnType<typeof inspectDocx>) => r.problems.filter((p) => p.level === "error" || p.code === "sitasi-tak-cocok");

const APA_ENTRY = "Contoh, A. (2000). Entri contoh dari template kampus. Penerbit Contoh.";
const VAN_ENTRY = "1. Contoh A. Entri contoh dari template kampus. Penerbit Contoh; 2000.";
const IMG = "<w:p><w:r><w:drawing/></w:r></w:p>";
const TBL = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Sel contoh</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const FN = '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>';
const BREAK = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr></w:p>';

let styled: Uint8Array;
let direct: Uint8Array;
let placeholder: Uint8Array;
beforeAll(async () => {
  styled = new Uint8Array(await styledTemplate());
  direct = new Uint8Array(await directTemplate());
  placeholder = new Uint8Array(await placeholderTemplate());
});

describe("T12: hasil mengisi template asli (template bergaya Word)", () => {
  let res: BuildResult;
  beforeAll(async () => {
    res = await buildDocxFromTemplate(input(), styled, analyzeTemplate(styled).suggested);
  });

  it("urutan heading dan nama style sama dengan template; isi contoh diganti isi dokumen", () => {
    const t = headings(styled);
    const r = headings(res.buffer);
    expect(t.map((x) => x.style)).toEqual(["Heading1", "Heading2", "Heading3", "Heading1", "Heading1"]);
    expect(r.map((x) => x.style)).toEqual(t.map((x) => x.style));
    expect(r.map((x) => x.text)).toEqual(["BAB I PENDAHULUAN", "A. Latar Belakang", "1. Pengertian", "DAFTAR PUSTAKA", "LAMPIRAN"]);
    expect(texts(res.buffer).join("\n")).not.toContain("Ini contoh paragraf isi");
  });

  it("style, header/footer, penomoran, dan media template tidak berubah (bagian paket disalin apa adanya)", () => {
    const parts = names(styled).filter((n) => /^word\/(styles|numbering|fontTable|header\d*|footer\d*)\.xml$/.test(n));
    expect(parts).toContain("word/styles.xml");
    expect(parts.some((n) => n.startsWith("word/footer"))).toBe(true);
    for (const p of parts) expect(read(res.buffer, p), p).toBe(read(styled, p));
    const media = (b: Uint8Array) => names(b).filter((n) => n.startsWith("word/media/")).sort();
    expect(media(styled).length).toBeGreaterThan(0);
    expect(media(res.buffer)).toEqual(media(styled));
  });

  it("ukuran halaman, margin, penomoran halaman, dan rujukan header/footer tiap bagian identik dengan template", () => {
    const t = sectionProps(docXml(styled));
    expect(t.length).toBeGreaterThan(5);
    expect(sectionProps(docXml(res.buffer))).toEqual(t);
  });

  it("daftar isi berupa field TOC Word (di kontrol konten template), bukan teks biasa", () => {
    const xml = docXml(res.buffer);
    expect(xml).toMatch(/<w:instrText[^>]*>\s*TOC\b/);
    // Template bisa membawa entri daftar isi bawaan (banyak field PAGEREF); hasil hanya punya satu field TOC dengan judul dokumen.
    for (const t of ["begin", "separate", "end"]) expect(count(xml, new RegExp(`w:fldCharType="${t}"`, "g")), t).toBe(1);
    expect(count(xml, /<w:sdt>/g)).toBe(count(docXml(styled), /<w:sdt>/g));
    const body = child(parseXml(xml).documentElement, "body")!;
    const toc = descendants(descendants(body, "sdt")[0], "p").map((p) => textOf(p).trim());
    expect(toc).toEqual(["BAB I PENDAHULUAN", "A. Latar Belakang", "1. Pengertian"]);
    expect(read(res.buffer, "word/settings.xml")).toContain("updateFields");
  });

  it("daftar pustaka di posisi template (setelah isi, sebelum Lampiran) dengan format entri contoh template", () => {
    const ps = texts(res.buffer);
    const iBody = ps.lastIndexOf("1. Pengertian");
    const iBib = ps.indexOf("DAFTAR PUSTAKA");
    const iEntry = ps.findIndex((t) => t.includes("Judul artikel uji"));
    const iApp = ps.indexOf("LAMPIRAN");
    expect(iBody).toBeGreaterThan(-1);
    expect(iBody).toBeLessThan(iBib);
    expect(iBib).toBeLessThan(iEntry);
    expect(iEntry).toBeLessThan(iApp);
    expect(ps.join("\n")).not.toContain("Entri contoh dari template kampus");
    const ind = child(child(paras(res.buffer)[iEntry].p, "pPr"), "ind");
    expect(attr(ind, "left")).toBe("720");
    expect(attr(ind, "hanging")).toBe("720");
    expect(ps[ps.length - 1]).toBe("Isi lampiran contoh yang harus tetap ada.");
  });

  it("template mendeteksi gaya APA; sitasi di isi dan entri daftar pustaka cocok; tanpa peringatan", () => {
    const a = analyzeTemplate(styled);
    expect(a.citeStyle?.style).toBe("APA");
    expect(a.suggested.citeStyle).toBe("APA");
    expect(texts(res.buffer).join("\n")).toContain("(Rahma, 2022)");
    expect(bad(inspectDocx(res.buffer, { cited: [SRC], style: "APA" }))).toEqual([]);
    expect(res.warnings).toBeUndefined();
  });
});

describe("T12: gaya sitasi dari template, bisa dikoreksi pengguna", () => {
  const van = () => editXml(styled, (xml) => xml.replace(APA_ENTRY, VAN_ENTRY));

  it("contoh entri bernomor dikenali sebagai Vancouver, dan dipakai walau Pengaturan memilih APA", async () => {
    const tpl = van();
    expect(texts(tpl).join("\n")).toContain(VAN_ENTRY);
    const a = analyzeTemplate(tpl);
    expect(a.citeStyle?.style).toBe("Vancouver");
    expect(a.suggested.citeStyle).toBe("Vancouver");
    const res = await buildDocxFromTemplate(input({ style: "APA" }), tpl, a.suggested);
    const ps = texts(res.buffer);
    expect(ps.join("\n")).toContain("Persalinan adalah proses penting [1].");
    expect(ps.join("\n")).not.toContain("(Rahma, 2022)");
    const entry = ps.find((t) => t.includes("Judul artikel uji"))!;
    expect(entry).toMatch(/^1\.\s+Rahma/);
    expect(bad(inspectDocx(res.buffer, { cited: [SRC], style: "Vancouver" }))).toEqual([]);
  });

  it("pengguna mengoreksi gaya: pemetaan citeStyle APA mengalahkan deteksi", async () => {
    const tpl = van();
    const mapping = { ...analyzeTemplate(tpl).suggested, citeStyle: "APA" as const };
    const res = await buildDocxFromTemplate(input({ style: "Vancouver" }), tpl, mapping);
    const ps = texts(res.buffer);
    expect(ps.join("\n")).toContain("(Rahma, 2022)");
    expect(ps.find((t) => t.includes("Judul artikel uji"))).toMatch(/^Rahma, S\. \(2022\)/);
    expect(bad(inspectDocx(res.buffer, { cited: [SRC], style: "APA" }))).toEqual([]);
  });

  it("sitasi yang tidak cocok dengan entri diperingatkan, tetap ok (nomor [1] diubah menjadi [2])", async () => {
    const tpl = van();
    const res = await buildDocxFromTemplate(input(), tpl, analyzeTemplate(tpl).suggested);
    const xml = docXml(res.buffer);
    expect(xml).toContain("[1]");
    const zip = new PizZip(res.buffer);
    zip.file("word/document.xml", xml.split("[1]").join("[2]"));
    const r = inspectDocx(new Uint8Array(zip.generate({ type: "uint8array" })), { cited: [SRC], style: "Vancouver" });
    expect(r.ok).toBe(true);
    expect(r.problems.map((p) => p.code)).toContain("sitasi-tak-cocok");
  });

  it("pemetaan dari klien: citeStyle yang sah diterima, yang tidak sah ditolak", () => {
    const m = analyzeTemplate(styled).suggested;
    expect(parseMapping(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(parseMapping({ ...m, citeStyle: "Vancouver" })?.citeStyle).toBe("Vancouver");
    expect(parseMapping({ ...m, citeStyle: null })?.citeStyle).toBeNull();
    expect(parseMapping({ ...m, citeStyle: "Chicago" })).toBeNull();
  });

  it("template tanpa contoh daftar pustaka atau sitasi: gaya tidak ditebak (ikut Pengaturan)", () => {
    const a = analyzeTemplate(placeholder);
    expect(a.citeStyle?.style).toBeNull();
    expect(a.suggested.citeStyle).toBeNull();
  });
});

describe("T12: daftar pustaka hanya dari sumber yang dikutip (Reference Manager)", () => {
  it("tanpa sumber yang dikutip: judul tetap di tempatnya, ditandai 'perlu diisi', tidak ada referensi dikarang", async () => {
    const res = await buildDocxFromTemplate(
      input({ sections: [{ id: "b", title: "A. Latar Belakang", level: 2, kind: "ai", text: "Klaim tanpa sumber [S9]." }] }),
      styled,
      analyzeTemplate(styled).suggested
    );
    const ps = texts(res.buffer);
    const iBib = ps.indexOf("DAFTAR PUSTAKA");
    expect(iBib).toBeGreaterThan(-1);
    expect(ps[iBib + 1]).toMatch(/^\[Perlu diisi/);
    expect(ps[iBib + 2]).toBe("LAMPIRAN");
    const all = ps.join("\n");
    expect(all).not.toContain("Entri contoh dari template kampus"); // entri contoh template tidak tersisa
    expect(all).not.toContain("Judul artikel uji"); // S1 ada di manajer tetapi tidak dikutip: tidak masuk daftar
    expect(all).not.toContain("S9"); // penanda tanpa sumber dibuang, bukan dijadikan referensi
    expect(res.citedIds).toEqual([]);
    expect(res.warnings).toContain("pustaka-perlu-diisi");
    expect(inspectDocx(res.buffer, { cited: [], style: "APA" }).ok).toBe(true);
  });

  it("lewat /api/docx: peringatan 'pustaka-perlu-diisi' dikirim di header", async () => {
    const form = new FormData();
    form.set(
      "data",
      JSON.stringify({ docType: "LK", judul: "Asuhan Uji", style: "APA", identity: { nama: "Mahasiswa Uji" }, sources: [], sections: [{ id: "a", title: "A. Latar", level: 2, kind: "ai", text: "Isi tanpa sumber." }] })
    );
    form.set("mapping", JSON.stringify(analyzeTemplate(styled).suggested));
    form.set("template", new File([new Uint8Array(styled)], "template.docx")); // salinan bertipe Uint8Array<ArrayBuffer>: File tidak menerima ArrayBufferLike
    const res = await docxPOST(new Request("http://localhost/api/docx", { method: "POST", body: form, headers: { "x-forwarded-for": "10.88.0.1" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Nakesa-Warnings")).toContain("pustaka-perlu-diisi");
  });
});

describe("T11/T12: elemen yang tidak bisa dipertahankan muncul sebagai peringatan", () => {
  it("tabel, gambar, dan catatan kaki di area isi: peringatan di analisis dan di hasil, isinya memang diganti", async () => {
    const tpl = editXml(styled, (xml) => insertBefore(xml, "A. Latar Belakang", TBL + IMG + FN));
    const a = analyzeTemplate(tpl);
    const w = a.warnings.find((x) => x.includes("Area isi template memuat"));
    expect(w).toBeDefined();
    expect(w).toContain("1 tabel");
    expect(w).toContain("1 gambar");
    expect(w).toContain("1 catatan kaki");
    const res = await buildDocxFromTemplate(input(), tpl, a.suggested);
    expect(res.warnings).toContain("template-elemen-dibuang");
    expect(docXml(res.buffer)).not.toContain("Sel contoh");
  });

  it("gambar di area daftar pustaka template: peringatan tersendiri", async () => {
    const tpl = editXml(styled, (xml) => insertBefore(xml, "LAMPIRAN", IMG));
    const a = analyzeTemplate(tpl);
    expect(a.warnings.some((x) => x.includes("Area daftar pustaka template memuat 1 gambar"))).toBe(true);
    expect(a.warnings.some((x) => x.includes("Area isi template memuat"))).toBe(false);
    const res = await buildDocxFromTemplate(input(), tpl, a.suggested);
    expect(res.warnings).toContain("template-elemen-dibuang");
  });

  it("beberapa pemisah bagian halaman di area isi: hanya yang terakhir dipertahankan, dan itu diperingatkan", async () => {
    const tpl = editXml(styled, (xml) => insertBefore(insertBefore(xml, "A. Latar Belakang", BREAK), "1. Contoh Sub", BREAK));
    const a = analyzeTemplate(tpl);
    expect(a.warnings.some((x) => x.includes("pemisah bagian halaman"))).toBe(true);
    const res = await buildDocxFromTemplate(input(), tpl, a.suggested);
    expect(res.warnings).toContain("template-bagian-digabung");
  });

  it("template polos (tanpa elemen seperti itu) tidak diberi peringatan elemen", async () => {
    for (const [k, tpl] of Object.entries({ styled, direct, placeholder })) {
      const a = analyzeTemplate(tpl);
      expect(a.warnings.filter((x) => /Area (isi|daftar pustaka) template memuat|pemisah bagian halaman/.test(x)), k).toEqual([]);
      const res = await buildDocxFromTemplate(input(), tpl, a.suggested);
      expect(res.warnings ?? [], k).not.toContain("template-elemen-dibuang");
      expect(res.warnings ?? [], k).not.toContain("template-bagian-digabung");
    }
  });
});

describe("T12: struktur untuk template format langsung dan berplaceholder", () => {
  it("format langsung: daftar isi ketikan diganti satu field TOC di bawah judul DAFTAR ISI template", async () => {
    const a = analyzeTemplate(direct);
    expect(a.suggested.tocMode).toBe("replace");
    const res = await buildDocxFromTemplate(input(), direct, a.suggested);
    const xml = docXml(res.buffer);
    expect(count(xml, /w:fldCharType="begin"/g)).toBe(1);
    expect(count(xml, /w:fldCharType="separate"/g)).toBe(1);
    expect(count(xml, /w:fldCharType="end"/g)).toBe(1);
    expect(xml).toMatch(/<w:instrText[^>]*>\s*TOC\b/);
    const ps = texts(res.buffer);
    expect(ps.filter((t) => t === "DAFTAR ISI")).toHaveLength(1);
    expect(ps.indexOf("DAFTAR ISI")).toBeLessThan(ps.indexOf("BAB I PENDAHULUAN")); // entri TOC pertama
    expect(ps.indexOf("BAB I PENDAHULUAN")).toBeLessThan(ps.lastIndexOf("BAB I PENDAHULUAN")); // lalu judul bab sebenarnya
    expect(ps.filter((t) => t === "DAFTAR PUSTAKA")).toHaveLength(1);
    expect(ps.findIndex((t) => t.includes("Judul artikel uji"))).toBeGreaterThan(ps.indexOf("DAFTAR PUSTAKA"));
  });

  it("berplaceholder tanpa daftar isi: DAFTAR ISI + field TOC ditambahkan sebelum bab pertama, daftar pustaka di akhir", async () => {
    const a = analyzeTemplate(placeholder);
    expect(a.suggested.tocMode).toBe("add");
    const res = await buildDocxFromTemplate(input(), placeholder, a.suggested);
    const xml = docXml(res.buffer);
    expect(count(xml, /w:fldCharType="begin"/g)).toBe(1);
    expect(xml).toMatch(/<w:instrText[^>]*>\s*TOC\b/);
    const ps = texts(res.buffer);
    expect(ps.indexOf("DAFTAR ISI")).toBeGreaterThan(-1);
    expect(ps.indexOf("DAFTAR ISI")).toBeLessThan(ps.lastIndexOf("BAB I PENDAHULUAN"));
    expect(ps.indexOf("DAFTAR PUSTAKA")).toBeGreaterThan(ps.lastIndexOf("1. Pengertian"));
    expect(ps[ps.length - 1]).toContain("Judul artikel uji");
  });
});
