import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as doiPOST } from "@/app/api/doi/route";
import { buildSourceBlock } from "../ai";
import { buildBibliography, citedOrder, renderInText } from "../citations";
import { parseSources } from "../guard";
import { doiContentCheck } from "../provenance";
import {
  analyzeReferences,
  contentFingerprint,
  duplicateBy,
  findDuplicateOf,
  findDuplicates,
  isCitable,
  metaFingerprint,
  nextSourceId,
  reconcileEdit,
  sameDoi,
  sourceStatus,
  stampChecks,
} from "../refs";
import type { Provenance, Source } from "../types";

/**
 * T13: reference manager. Status sumber bertingkat yang turun bila data berubah, DOI tidak cocok, sumber ganda,
 * rujukan yatim, dan daftar pustaka yang dibangun kode (bukan AI). Tanpa jaringan: Crossref di-stub.
 */

const LONG = "Anemia pada kehamilan adalah masalah kesehatan masyarakat yang penting. ".repeat(5);
const prov = (o: Partial<Provenance> = {}): Provenance => ({ method: "file", fetchedAt: "2026-11-24T00:00:00Z", ...o });
const mk = (o: Partial<Source> = {}): Source => ({
  id: "S1",
  type: "jurnal",
  title: "Efektivitas tablet besi pada ibu hamil",
  authors: [{ family: "Rahma", given: "Siti" }],
  year: "2022",
  origin: "manual",
  verified: false,
  ...o,
});
/** Sumber hasil verifikasi Crossref dengan abstrak, sudah dicap seperti yang dilakukan route /api/doi. */
const verified = (o: Partial<Source> = {}): Source =>
  stampChecks(mk({ origin: "crossref", verified: true, doi: "10.1234/abc", content: LONG, provenance: prov({ method: "doi" }), ...o }));

afterEach(() => vi.unstubAllGlobals());

describe("status sumber bertingkat", () => {
  it("manual tanpa isi -> manual, tidak boleh dikutip", () => {
    const s = sourceStatus(mk());
    expect(s).toMatchObject({ level: "manual", rank: 0, citable: false });
  });

  it("manual dengan isi -> isi, boleh dikutip", () => {
    expect(sourceStatus(mk({ content: LONG }))).toMatchObject({ level: "isi", rank: 2, citable: true });
  });

  it("Crossref tanpa isi -> metadata; Crossref dengan abstrak -> terverifikasi", () => {
    expect(sourceStatus(verified({ content: undefined })).level).toBe("metadata");
    expect(sourceStatus(verified())).toMatchObject({ level: "terverifikasi", rank: 3, citable: true });
  });

  it("dari file/URL: judul cocok -> terverifikasi; belum bisa dinilai -> hanya isi", () => {
    const base = { origin: "crossref" as const, verified: true, doi: "10.1234/abc", content: LONG };
    expect(sourceStatus(mk({ ...base, provenance: prov({ doiCheck: "cocok" }) })).level).toBe("terverifikasi");
    const unsure = sourceStatus(mk({ ...base, provenance: prov({ doiCheck: "tidak-dapat-dinilai" }) }));
    expect(unsure.level).toBe("isi");
    expect(unsure.reasons.join(" ")).toMatch(/belum bisa dipastikan/);
  });

  it("bendera verified tanpa dasar Crossref/DOI tidak dipercaya (data dari klien/penyimpanan)", () => {
    const forged = sourceStatus(mk({ verified: true, content: LONG }));
    expect(forged.level).toBe("isi");
    expect(forged.reasons.join(" ")).toMatch(/dianggap isian manual/);
    expect(sourceStatus(mk({ verified: true, origin: "crossref" })).level).toBe("manual"); // tanpa DOI
  });
});

describe("DOI tidak cocok dengan isi", () => {
  const mismatch = (o: Partial<Source> = {}) => mk({ doi: "10.1234/abc", content: LONG, provenance: prov({ doiCheck: "tidak-cocok", doiInText: "10.1234/abc" }), ...o });

  it("DOI yang diklaim sumber tidak cocok dengan isinya -> perlu ditinjau dan tidak dikutip", () => {
    const s = sourceStatus(mismatch());
    expect(s).toMatchObject({ level: "perlu-tinjau", rank: -1, citable: false });
    expect(s.reasons.join(" ")).toMatch(/tidak cocok/);
    expect(isCitable(mismatch())).toBe(false);
  });

  it("alur lengkap: judul Crossref vs isi file lain -> tidak-cocok -> perlu ditinjau", () => {
    const check = doiContentCheck("Efektivitas tablet besi pada ibu hamil", "Panduan senam nifas untuk ibu setelah persalinan normal. ".repeat(10));
    expect(check).toBe("tidak-cocok");
    expect(sourceStatus(mk({ doi: "10.1234/abc", content: LONG, provenance: prov({ doiCheck: check, doiInText: "10.1234/abc" }) })).level).toBe("perlu-tinjau");
  });

  it("tanpa DOI di sumber (mahasiswa mengisi metadata sendiri) tidak memblokir, DOI lain yang diketik juga tidak", () => {
    expect(sourceStatus(mismatch({ doi: undefined })).level).toBe("isi");
    const other = sourceStatus(mismatch({ doi: "10.9999/lain" }));
    expect(other.level).toBe("isi");
    expect(other.reasons.join(" ")).toMatch(/berbeda dari DOI/);
  });

  it("buildSourceBlock: sumber perlu-tinjau tidak diberi isi ke AI dan penandanya tidak diizinkan", () => {
    const bad = mismatch({ id: "S1" });
    const good = mk({ id: "S2", title: "Buku lain", content: LONG });
    const { block, usable } = buildSourceBlock("LP", [bad, good]);
    expect(usable).toEqual(["S2"]);
    expect(block).toContain("[S1]");
    expect(block).toMatch(/\[S1\].*PERLU DITINJAU/);
    expect(block).not.toContain('<isi_sumber id="S1"');
    expect(block).toContain('<isi_sumber id="S2"');
  });
});

describe("status turun jika berubah", () => {
  it("metadata diubah setelah diverifikasi (judul, tahun, DOI, penulis) -> tidak lagi terverifikasi", () => {
    const v = verified();
    expect(sourceStatus(v).level).toBe("terverifikasi");
    const t = sourceStatus({ ...v, title: "Judul lain" });
    expect(t.level).toBe("isi");
    expect(t.reasons.join(" ")).toMatch(/Metadata diubah/);
    expect(sourceStatus({ ...v, year: "2023" }).level).toBe("isi");
    expect(sourceStatus({ ...v, doi: "10.1234/xyz" }).level).toBe("isi");
    expect(sourceStatus({ ...v, authors: [] }).level).toBe("isi");
  });

  it("isi diubah setelah diperiksa -> tidak lagi terverifikasi", () => {
    expect(sourceStatus({ ...verified(), content: LONG + " Tambahan dari mahasiswa." }).level).toBe("isi");
  });

  it("perubahan spasi dan huruf besar/kecil DOI tidak menurunkan status", () => {
    const v = verified({ doi: "10.1234/ABC" });
    expect(sourceStatus({ ...v, content: `  ${LONG.replace(/ /g, "  ")} ` }).level).toBe("terverifikasi");
    expect(sourceStatus({ ...v, title: "  Efektivitas   tablet besi pada ibu hamil ", doi: "https://doi.org/10.1234/abc" }).level).toBe("terverifikasi");
  });

  it("status 'perlu ditinjau' tidak bertahan bila isi sudah diganti (pemeriksaan DOI basi)", () => {
    const m = stampChecks(mk({ doi: "10.1234/abc", content: LONG, provenance: prov({ doiCheck: "tidak-cocok", doiInText: "10.1234/abc" }) }));
    expect(sourceStatus(m).level).toBe("perlu-tinjau");
    const after = sourceStatus({ ...m, content: LONG + " Isi sudah saya ganti dengan teks artikel yang benar." });
    expect(after.level).toBe("isi");
    expect(after.reasons.join(" ")).toMatch(/pemeriksaan itu tidak berlaku/);
  });

  it("reconcileEdit: tanpa perubahan semuanya tetap", () => {
    const v = verified();
    const same = reconcileEdit(v, { ...v });
    expect(same).toMatchObject({ verified: true, origin: "crossref" });
    expect(same.provenance?.metaFp).toBeTruthy();
    expect(same.provenance?.contentFp).toBeTruthy();
    expect(reconcileEdit(undefined, v)).toBe(v);
  });

  it("reconcileEdit: metadata diubah -> isian manual, cap metadata dibuang, cap isi dipertahankan", () => {
    const v = verified({ provenance: prov({ method: "doi", doiCheck: "cocok" }) });
    const e = reconcileEdit(v, { ...v, title: "Judul baru" });
    expect(e).toMatchObject({ verified: false, origin: "manual" });
    expect(e.provenance?.metaFp).toBeUndefined();
    expect(e.provenance?.contentFp).toBeTruthy();
    expect(e.provenance?.doiCheck).toBe("cocok");
    expect(sourceStatus(e).level).toBe("isi");
  });

  it("reconcileEdit: isi diubah -> hasil cek DOI dan cap isi dibuang, verifikasi metadata tetap", () => {
    const v = verified({ provenance: prov({ method: "doi", doiCheck: "cocok" }) });
    const e = reconcileEdit(v, { ...v, content: LONG + " baru" });
    expect(e.verified).toBe(true);
    expect(e.provenance?.contentFp).toBeUndefined();
    expect(e.provenance?.doiCheck).toBeUndefined();
  });

  it("reconcileEdit: sumber manual yang metadatanya diubah tetap manual", () => {
    const m = mk({ content: LONG });
    expect(reconcileEdit(m, { ...m, title: "x" })).toMatchObject({ verified: false, origin: "manual" });
  });

  it("sidik jari: 14 heksadesimal, berubah bila isi berubah, tanpa provenance tidak dicap", () => {
    expect(metaFingerprint(mk())).toMatch(/^[0-9a-f]{14}$/);
    expect(contentFingerprint({ content: "a" })).toMatch(/^[0-9a-f]{14}$/);
    expect(contentFingerprint({ content: "a" })).not.toBe(contentFingerprint({ content: "b" }));
    expect(stampChecks(mk()).provenance).toBeUndefined();
  });
});

describe("route DOI mencap hasil verifikasi", () => {
  const crossref = (message: unknown) => vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ message }), { status: 200 })));
  const call = async () => {
    const res = await doiPOST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.77" }, body: JSON.stringify({ doi: "10.1234/abc.9" }) }));
    expect(res.status).toBe(200);
    return { id: "S1", ...((await res.json()) as { source: Omit<Source, "id"> }).source } as Source;
  };

  it("dengan abstrak: terverifikasi; ubah judul sesudahnya -> turun", async () => {
    vi.stubGlobal("fetch", crossref({ title: ["Judul Uji"], author: [{ family: "Rahma" }], issued: { "date-parts": [[2022]] }, type: "journal-article", abstract: `<p>${LONG}</p>` }));
    const s = await call();
    expect(s.provenance?.metaFp).toBe(metaFingerprint(s));
    expect(s.provenance?.contentFp).toBe(contentFingerprint(s));
    expect(sourceStatus(s).level).toBe("terverifikasi");
    expect(sourceStatus({ ...s, title: "Judul yang saya ubah" }).level).toBe("isi");
  });

  it("tanpa abstrak: hanya metadata terverifikasi, belum boleh dikutip", async () => {
    vi.stubGlobal("fetch", crossref({ title: ["Judul Uji"], type: "journal-article" }));
    const s = await call();
    expect(sourceStatus(s)).toMatchObject({ level: "metadata", citable: false });
  });
});

describe("parseSources dan cap perubahan", () => {
  const base = { id: "S1", type: "jurnal", title: "T", authors: [], year: "2022" };
  const withProv = (p: Record<string, unknown>) => parseSources([{ ...base, provenance: { method: "doi", fetchedAt: "2026-11-24T00:00:00Z", ...p } }])![0].provenance;

  it("cap heksadesimal yang sah dipertahankan agar server menilai status sama seperti klien", () => {
    expect(withProv({ metaFp: "0123456789abcd", contentFp: "0123456789abcdef" })).toMatchObject({ metaFp: "0123456789abcd", contentFp: "0123456789abcdef" });
  });

  it("cap berbentuk lain atau terlalu panjang dibuang, bukan dipotong", () => {
    const p = withProv({ metaFp: "zz-bukan-hex!", contentFp: "0123456789abcdef0" });
    expect(p?.metaFp).toBeUndefined();
    expect(p?.contentFp).toBeUndefined();
    expect(withProv({ metaFp: 12345678 })?.metaFp).toBeUndefined(); // bukan string
    expect(withProv({ contentFp: "ABCDEF0123456789" })?.contentFp).toBeUndefined(); // huruf besar bukan bentuk yang dikenal
  });

  it("sumber yang dipalsukan klien (verified tanpa Crossref) tetap tidak naik tingkat di server", () => {
    const [s] = parseSources([{ ...base, verified: true, content: LONG }])!;
    expect(s.verified).toBe(true);
    expect(sourceStatus(s).level).toBe("isi");
  });
});

describe("sumber ganda", () => {
  const a = mk({ id: "S1", doi: "10.1234/ABC" });
  const b = mk({ id: "S2", title: "Judul berbeda", doi: "https://doi.org/10.1234/abc" });
  const c = mk({ id: "S3", title: "  EFEKTIVITAS tablet besi, pada ibu hamil! " });

  it("DOI sama setelah awalan URL dan huruf besar/kecil dinormalkan; judul sama setelah tanda baca dan spasi dinormalkan", () => {
    expect(sameDoi("10.1234/ABC", "https://doi.org/10.1234/abc")).toBe(true);
    expect(sameDoi(" doi: 10.1/x", "10.1/X")).toBe(true);
    expect(sameDoi("", "")).toBe(false);
    expect(sameDoi(undefined, undefined)).toBe(false);
    expect(duplicateBy(a, b)).toBe("doi");
    expect(duplicateBy(a, c)).toBe("judul");
    expect(duplicateBy(b, c)).toBeNull();
  });

  it("findDuplicates: kelompok DOI dan judul; kelompok judul yang sudah tercakup DOI tidak dobel", () => {
    expect(findDuplicates([a, b, c])).toEqual([
      { ids: ["S1", "S2"], by: "doi" },
      { ids: ["S1", "S3"], by: "judul" },
    ]);
    expect(findDuplicates([mk({ id: "S1", doi: "10.1/a" }), mk({ id: "S2", doi: "10.1/A" })])).toEqual([{ ids: ["S1", "S2"], by: "doi" }]);
  });

  it("findDuplicateOf: DOI didahulukan; tahun atau penulis pertama berbeda bukan ganda; judul kosong tidak pernah ganda", () => {
    expect(findDuplicateOf([c, a], { doi: "10.1234/abc", title: "", year: "", authors: [] })).toEqual({ id: "S1", by: "doi" });
    expect(findDuplicateOf([c], mk({ title: "efektivitas tablet besi pada ibu hamil" }))).toEqual({ id: "S3", by: "judul" });
    expect(findDuplicateOf([c], mk({ year: "2021" }))).toBeNull();
    expect(findDuplicateOf([c], mk({ authors: [{ family: "Lain" }] }))).toBeNull();
    expect(findDuplicates([mk({ id: "S1", title: "" }), mk({ id: "S2", title: "" })])).toEqual([]);
  });
});

describe("rujukan yatim dan sitasi hanya ke sumber yang ada", () => {
  const s1 = mk({ id: "S1", content: LONG });
  const s2 = mk({ id: "S2", title: "Dua" });
  const s3 = mk({ id: "S3", title: "Tiga", content: LONG });
  const s4 = mk({ id: "S4", title: "Empat", doi: "10.1/a", content: LONG, provenance: prov({ doiCheck: "tidak-cocok", doiInText: "10.1/a" }) });

  it("analyzeReferences: dirujuk, penanda tanpa sumber, sumber tak dirujuk, dirujuk padahal tak boleh dikutip", () => {
    const r = analyzeReferences(["a [S1] b [S9]", "c [S2, S4]. d [S1]"], [s1, s2, s3, s4]);
    expect(r.cited).toEqual(["S1", "S2", "S4"]);
    expect(r.dangling).toEqual(["S9"]);
    expect(r.uncited).toEqual(["S3"]);
    expect(r.citedNotCitable).toEqual(["S2", "S4"]);
    expect(analyzeReferences([], [])).toEqual({ cited: [], dangling: [], uncited: [], citedNotCitable: [] });
  });

  it("menghapus sumber lalu menambah baru tidak membuat penanda lama menunjuk ke sumber lain", () => {
    const rest = [mk({ id: "S1" }), mk({ id: "S2" })]; // S3 baru saja dihapus
    expect(nextSourceId(rest)).toBe("S3"); // tanpa pengaman: nomor dipakai ulang
    const r = analyzeReferences(["Klaim lama [S3]."], rest);
    expect(r.dangling).toEqual(["S3"]); // masih ditandai yatim
    expect(nextSourceId(rest, r.dangling)).toBe("S4"); // dengan pengaman: nomor S3 tidak dipakai ulang
    expect(nextSourceId([], ["S7", "S2"])).toBe("S8");
    expect(nextSourceId([])).toBe("S1");
  });

  it("daftar pustaka dibangun dari data sumber: penanda palsu dan sumber tak dirujuk tidak masuk, tanpa duplikat", () => {
    const map = new Map([mk({ id: "S1", doi: "10.1/a" }), mk({ id: "S2", title: "Dua", year: "2020" }), mk({ id: "S3", title: "Tiga" })].map((s) => [s.id, s]));
    const order = citedOrder(["Klaim [S2] dan [S9]. Lagi [S2, S1].", "Tidak ada [S8]"], new Set(map.keys()));
    expect(order).toEqual(["S2", "S1"]);
    const bib = buildBibliography(order, map, "Vancouver");
    expect(bib).toHaveLength(2);
    expect(bib.map((e) => e.segs.map((x) => x.t).join("")).join(" ")).not.toContain("Tiga");
    expect(renderInText("Klaim [S9]. Dasar [S2].", map, "Vancouver", new Map([["S2", 1]]))).toBe("Klaim. Dasar [1].");
  });
});
