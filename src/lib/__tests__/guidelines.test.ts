import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUIDELINE_STATUSES,
  LIMITS,
  TRANSITIONS,
  approve,
  approvedGuidelines,
  contentHash,
  createDraft,
  emptyBank,
  newVersionFrom,
  parseBank,
  parseGuideline,
  resolveCitation,
  returnToDraft,
  submitForReview,
  supersede,
  updateDraft,
  validateForReview,
  verifyIntegrity,
  type GuidelineBank,
  type GuidelineRecord,
  type GuidelineStatus,
  type Result,
} from "../guidelines";
import { addApproved, addDraft, addInReview, at, deepFreeze, dummyInput, ok } from "./guideline-fixtures";

/**
 * T16: bank pedoman. Alur draft > review > approved > superseded, hanya approved yang dipakai, empat mata, integritas
 * hash, dan pembacaan data tidak tepercaya. Semua data fiktif (guideline-fixtures.ts); tanpa isi klinis.
 */

const err = (r: Result): string => (r.ok ? "" : r.error);
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("createDraft: metadata dan pembersihan", () => {
  it("draf baru: status draft, versi 1, pembuat dan jejak audit pertama tercatat", () => {
    const r = ok(createDraft(emptyBank(), dummyInput(), "  penyusun  ", at(0)));
    expect(r.record).toMatchObject({ id: "gl1", seriesId: "gs1", version: 1, status: "draft", fixture: false, createdBy: "penyusun", contributors: ["penyusun"], createdAt: at(0).toISOString() });
    expect(r.record.audit).toEqual([{ at: at(0).toISOString(), by: "penyusun", from: null, to: "draft" }]);
    expect(r.record.contentHash).toBeUndefined();
    expect(r.bank.guidelines).toHaveLength(1);
    const second = ok(createDraft(r.bank, dummyInput(), "penyusun", at(1)));
    expect(second.record).toMatchObject({ id: "gl2", seriesId: "gs2", version: 1 });
  });

  it("pelaku wajib ada; penanda fixture hanya bila diminta", () => {
    expect(err(createDraft(emptyBank(), dummyInput(), "   ", at(0)))).toContain("Identitas pelaku");
    expect(ok(createDraft(emptyBank(), dummyInput(), "a", at(0), { fixture: true })).record.fixture).toBe(true);
  });

  it("metadata dibersihkan: karakter kontrol, spasi, huruf kode topik, batas panjang, tahun dan bahasa tidak sah", () => {
    const r = ok(
      createDraft(
        emptyBank(),
        { meta: { title: "  Pedoman\u0000  Uji\n Fiktif  ", issuer: "x".repeat(500), topic: "UJI", year: 2024.5, language: "fr" as never, sourceUrl: "  https://example.org/a  ", pageCount: 99999 } },
        "a",
        at(0)
      )
    );
    const m = r.record.meta;
    expect(m.title).toBe("Pedoman Uji Fiktif");
    expect(m.issuer).toHaveLength(LIMITS.issuer);
    expect(m.topic).toBe("uji");
    expect(m.year).toBe(0);
    expect(m.language).toBe("id");
    expect(m.sourceUrl).toBe("https://example.org/a");
    expect(m).not.toHaveProperty("pageCount");
  });

  it("kutipan: id sah dipertahankan, id ganda atau tidak sah diganti, halaman tidak sah jadi 0, teks dipotong, bukan objek dilewati", () => {
    const r = ok(
      createDraft(
        emptyBank(),
        {
          passages: [
            { id: "p5", page: 3, text: "a" },
            { id: "p5", page: -1, text: "b" },
            { id: "zzz", page: 1.5, text: "c" },
            "bukan objek" as never,
            null as never,
            { page: 6000, text: "x".repeat(3000) },
          ],
        },
        "a",
        at(0)
      )
    );
    expect(r.record.passages.map((p) => p.id)).toEqual(["p5", "p1", "p2", "p3"]);
    expect(r.record.passages.map((p) => p.page)).toEqual([3, 0, 0, 0]);
    expect(r.record.passages[3].text).toHaveLength(LIMITS.passageText);
  });

  it("jumlah kutipan dibatasi", () => {
    const many = Array.from({ length: LIMITS.passages + 100 }, (_, i) => ({ page: 1, text: `Kutipan fiktif nomor ${i}` }));
    expect(ok(createDraft(emptyBank(), { passages: many }, "a", at(0))).record.passages).toHaveLength(LIMITS.passages);
  });

  it("jumlah pedoman dibatasi", () => {
    let b = emptyBank();
    for (let i = 0; i < LIMITS.guidelines; i++) b = ok(createDraft(b, {}, "a", at(0))).bank;
    expect(err(createDraft(b, {}, "a", at(0)))).toContain(String(LIMITS.guidelines));
  });
});

describe("kelengkapan sebelum review", () => {
  const rec = (over?: Parameters<typeof dummyInput>[0]): GuidelineRecord => addDraft(emptyBank(), { input: dummyInput(over) }).record;

  it("masukan lengkap tidak punya kekurangan; tautan sumber http(s) yang sah diterima", () => {
    expect(validateForReview(rec())).toEqual([]);
    expect(validateForReview(rec({ meta: { sourceUrl: "https://example.org/x" } }))).toEqual([]);
  });

  it("draf kosong memuat seluruh kekurangan", () => {
    const empty = ok(createDraft(emptyBank(), {}, "a", at(0))).record;
    expect(validateForReview(empty)).toHaveLength(8);
  });

  it.each<[string, Parameters<typeof dummyInput>[0], string]>([
    ["judul pendek", { meta: { title: "abc" } }, "Judul pedoman"],
    ["penerbit kosong", { meta: { issuer: "" } }, "Penerbit"],
    ["tahun 1949", { meta: { year: 1949 } }, "Tahun terbit"],
    ["tahun 2101", { meta: { year: 2101 } }, "Tahun terbit"],
    ["edisi kosong", { meta: { versionLabel: "" } }, "Edisi"],
    ["topik berspasi", { meta: { topic: "anemia hamil" } }, "Kode topik"],
    ["topik satu huruf", { meta: { topic: "a" } }, "Kode topik"],
    ["cakupan pendek", { meta: { scope: "singkat" } }, "Cakupan"],
    ["dasar izin pendek", { meta: { rights: "izin" } }, "Dasar izin"],
    ["tautan bukan http(s)", { meta: { sourceUrl: "ftp://example.org/x" } }, "Tautan sumber"],
    ["tautan rusak", { meta: { sourceUrl: "bukan url" } }, "Tautan sumber"],
    ["tanpa kutipan", { passages: [] }, "Minimal satu kutipan"],
    ["kutipan tanpa halaman", { passages: [{ text: "Kutipan fiktif yang cukup panjang." }] }, "nomor halaman wajib"],
    ["halaman melebihi jumlah", { passages: [{ page: 41, text: "Kutipan fiktif yang cukup panjang." }] }, "melebihi jumlah halaman"],
    ["teks kutipan pendek", { passages: [{ page: 2, text: "pendek" }] }, "minimal 20 karakter"],
  ])("kekurangan: %s", (_name, over, expected) => {
    expect(validateForReview(rec(over)).join(" ")).toContain(expected);
  });

  it("tidak bisa diajukan bila belum lengkap", () => {
    const d = ok(createDraft(emptyBank(), {}, "a", at(0)));
    expect(err(submitForReview(d.bank, "gl1", "a", at(1)))).toMatch(/^Belum lengkap:/);
  });
});

describe("alur status", () => {
  it("jalur sah draft > review > approved > superseded, tiap langkah tercatat (siapa, kapan, catatan)", () => {
    const a = ok(createDraft(emptyBank(), dummyInput(), "penyusun", at(0)));
    const b = ok(submitForReview(a.bank, "gl1", "penyusun", at(1)));
    expect(b.record).toMatchObject({ status: "review", submittedBy: "penyusun" });
    expect(b.record.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const c = ok(approve(b.bank, "gl1", "peninjau", at(2), "Sudah sesuai uji"));
    expect(c.record).toMatchObject({ status: "approved", approvedBy: "peninjau", approvedAt: at(2).toISOString() });
    const d = ok(supersede(c.bank, "gl1", "admin", at(3), "Ditarik untuk uji"));
    expect(d.record.status).toBe("superseded");
    expect(d.record.audit.map((e) => [e.from, e.to, e.by, e.at])).toEqual([
      [null, "draft", "penyusun", at(0).toISOString()],
      ["draft", "review", "penyusun", at(1).toISOString()],
      ["review", "approved", "peninjau", at(2).toISOString()],
      ["approved", "superseded", "admin", at(3).toISOString()],
    ]);
    expect(d.record.audit[2].note).toBe("Sudah sesuai uji");
    expect(d.record.audit[3].note).toBe("Ditarik untuk uji");
  });

  it("tabel peralihan tidak membolehkan lompatan", () => {
    expect(GUIDELINE_STATUSES).toEqual(["draft", "review", "approved", "superseded"]);
    expect(TRANSITIONS).toEqual({ draft: ["review"], review: ["draft", "approved"], approved: ["superseded"], superseded: [] });
  });

  describe("setiap aksi hanya sah dari status yang semestinya", () => {
    const inStatus = (s: GuidelineStatus): { bank: GuidelineBank; id: string } => {
      if (s === "draft") return { bank: addDraft(emptyBank()).bank, id: "gl1" };
      if (s === "review") return { bank: addInReview(emptyBank()).bank, id: "gl1" };
      const a = addApproved(emptyBank());
      if (s === "approved") return { bank: a.bank, id: "gl1" };
      return { bank: ok(supersede(a.bank, "gl1", "admin", at(10), "Ditarik untuk uji")).bank, id: "gl1" };
    };
    const ACTIONS: Record<string, { run: (b: GuidelineBank, id: string) => Result; from: GuidelineStatus[]; to: GuidelineStatus }> = {
      ajukan: { run: (b, id) => submitForReview(b, id, "penyusun", at(20)), from: ["draft"], to: "review" },
      setujui: { run: (b, id) => approve(b, id, "pihak-ketiga", at(20)), from: ["review"], to: "approved" },
      kembalikan: { run: (b, id) => returnToDraft(b, id, "peninjau", at(20), "Perlu diperbaiki lagi"), from: ["review"], to: "draft" },
      tarik: { run: (b, id) => supersede(b, id, "admin", at(20), "Ditarik untuk uji"), from: ["approved"], to: "superseded" },
      ubah: { run: (b, id) => updateDraft(b, id, { meta: { title: "Judul baru yang sah" } }, "penyusun"), from: ["draft"], to: "draft" },
      "versi-baru": { run: (b, id) => newVersionFrom(b, id, "penyusun", at(20)), from: ["approved"], to: "draft" },
    };
    for (const status of GUIDELINE_STATUSES) {
      for (const [name, a] of Object.entries(ACTIONS)) {
        const allowed = a.from.includes(status);
        it(`${name} dari ${status}: ${allowed ? "sah" : "ditolak"}`, () => {
          const { bank, id } = inStatus(status);
          const before = JSON.stringify(bank);
          const r = a.run(deepFreeze(bank), id);
          expect(r.ok).toBe(allowed);
          if (r.ok) expect(r.record.status).toBe(a.to);
          else expect(r.error).toBeTruthy();
          expect(JSON.stringify(bank)).toBe(before); // masukan tidak berubah, baik sah maupun ditolak
        });
      }
    }
  });

  it("pedoman yang tidak ada ditolak untuk semua aksi", () => {
    const b = emptyBank();
    expect(err(submitForReview(b, "gl9", "a", at(0)))).toContain("tidak ditemukan");
    expect(err(approve(b, "gl9", "a", at(0)))).toContain("tidak ditemukan");
    expect(err(returnToDraft(b, "gl9", "a", at(0), "alasan cukup"))).toContain("tidak ditemukan");
    expect(err(supersede(b, "gl9", "a", at(0), "alasan cukup"))).toContain("tidak ditemukan");
    expect(err(updateDraft(b, "gl9", {}, "a"))).toContain("tidak ditemukan");
    expect(err(newVersionFrom(b, "gl9", "a", at(0)))).toContain("tidak ditemukan");
  });

  it("setiap aksi butuh identitas pelaku", () => {
    const { bank } = addInReview(emptyBank());
    expect(err(submitForReview(bank, "gl1", " ", at(0)))).toContain("Identitas");
    expect(err(approve(bank, "gl1", " ", at(0)))).toContain("Identitas");
    expect(err(returnToDraft(bank, "gl1", " ", at(0), "alasan cukup"))).toContain("Identitas");
    expect(err(updateDraft(bank, "gl1", {}, " "))).toContain("Identitas");
  });

  it("alur lengkap berjalan tanpa mengubah masukan sedikit pun (semua dibekukan)", () => {
    let bank = deepFreeze(emptyBank());
    bank = deepFreeze(ok(createDraft(bank, deepFreeze(dummyInput()), "penyusun", at(0))).bank);
    bank = deepFreeze(ok(updateDraft(bank, "gl1", deepFreeze({ meta: { title: "Pedoman Uji Fiktif Beta" } }), "penyusun")).bank);
    bank = deepFreeze(ok(submitForReview(bank, "gl1", "penyusun", at(1))).bank);
    bank = deepFreeze(ok(returnToDraft(bank, "gl1", "peninjau", at(2), "Perlu perbaikan kecil")).bank);
    bank = deepFreeze(ok(submitForReview(bank, "gl1", "penyusun", at(3))).bank);
    bank = deepFreeze(ok(approve(bank, "gl1", "peninjau", at(4))).bank);
    bank = deepFreeze(ok(newVersionFrom(bank, "gl1", "pembaru", at(5))).bank);
    expect(bank.guidelines).toHaveLength(2);
  });
});

describe("empat mata", () => {
  it("pembuat tidak boleh menyetujui, walau beda huruf besar/kecil atau spasi", () => {
    const { bank } = addInReview(emptyBank(), { creator: "Penyusun" });
    for (const who of ["Penyusun", "penyusun", "  PENYUSUN  "]) expect(err(approve(bank, "gl1", who, at(5))), who).toContain("tidak boleh");
    expect(approve(bank, "gl1", "peninjau", at(5)).ok).toBe(true);
  });

  it("orang yang mengubah atau mengajukan juga tidak boleh menyetujui", () => {
    const a = ok(createDraft(emptyBank(), dummyInput(), "pembuat", at(0)));
    const edited = ok(updateDraft(a.bank, "gl1", { meta: { versionLabel: "Edisi 2" } }, "pengubah"));
    const submitted = ok(submitForReview(edited.bank, "gl1", "pengaju", at(1)));
    expect(submitted.record.contributors).toEqual(["pembuat", "pengubah", "pengaju"]);
    for (const who of ["pembuat", "pengubah", "pengaju"]) expect(approve(submitted.bank, "gl1", who, at(2)).ok, who).toBe(false);
    expect(approve(submitted.bank, "gl1", "peninjau", at(2)).ok).toBe(true);
  });

  it("peninjau yang mengembalikan boleh menyetujui nanti, asal tidak ikut mengubah", () => {
    const r1 = addInReview(emptyBank());
    const back = ok(returnToDraft(r1.bank, "gl1", "peninjau", at(3), "Perlu perbaikan kecil"));
    const fixed = ok(updateDraft(back.bank, "gl1", { meta: { scope: "Cakupan fiktif yang sudah diperbaiki untuk uji." } }, "penyusun"));
    const again = ok(submitForReview(fixed.bank, "gl1", "penyusun", at(4)));
    expect(approve(again.bank, "gl1", "peninjau", at(5)).ok).toBe(true);
  });
});

describe("integritas isi (hash)", () => {
  it("hash tidak bergantung pada status atau jejak audit, tetapi berubah bila isi berubah", () => {
    const d = addDraft(emptyBank()).record;
    const a = addApproved(emptyBank()).record;
    expect(contentHash(d)).toBe(contentHash(a));
    expect(contentHash(d)).toBe(contentHash(structuredClone(d)));
    const other = addDraft(emptyBank(), { input: dummyInput({ meta: { title: "Pedoman Uji Fiktif Gamma" } }) }).record;
    expect(contentHash(other)).not.toBe(contentHash(d));
  });

  it("draf belum punya hash dibekukan, jadi dianggap tidak utuh", () => {
    expect(verifyIntegrity(addDraft(emptyBank()).record)).toBe(false);
    expect(verifyIntegrity(addInReview(emptyBank()).record)).toBe(true);
  });

  it("isi yang diubah setelah diajukan tidak bisa disetujui", () => {
    const r = addInReview(emptyBank());
    const tampered: GuidelineBank = { guidelines: r.bank.guidelines.map((g) => ({ ...g, passages: g.passages.map((p) => ({ ...p, text: `${p.text} (disisipkan)` })) })) };
    expect(verifyIntegrity(tampered.guidelines[0])).toBe(false);
    expect(err(approve(tampered, r.record.id, "peninjau", at(5)))).toContain("berbeda dari saat diajukan");
  });

  it("dikembalikan ke draft: hash dan pengaju dihapus, harus diajukan ulang dengan catatan alasan", () => {
    const r = addInReview(emptyBank());
    expect(err(returnToDraft(r.bank, "gl1", "peninjau", at(3), "oke"))).toContain("minimal 5 karakter");
    const back = ok(returnToDraft(r.bank, "gl1", "peninjau", at(3), "Cakupan kurang jelas"));
    expect(back.record.status).toBe("draft");
    expect(back.record).not.toHaveProperty("contentHash");
    expect(back.record).not.toHaveProperty("submittedBy");
    expect(back.record.audit[back.record.audit.length - 1].note).toBe("Cakupan kurang jelas");
    expect(err(approve(back.bank, "gl1", "pihak-ketiga", at(4)))).toContain("review");
  });
});

describe("ubah draf", () => {
  it("metadata digabung, daftar kutipan diganti utuh, pengubah tercatat sebagai kontributor", () => {
    const d = addDraft(emptyBank());
    const r = ok(updateDraft(d.bank, "gl1", { meta: { title: "Judul baru yang sah" } }, "pengubah"));
    expect(r.record.meta).toMatchObject({ title: "Judul baru yang sah", issuer: "Penerbit Fiktif", year: 2024 });
    expect(r.record.passages).toHaveLength(2);
    expect(r.record.contributors).toEqual(["penyusun", "pengubah"]);
    const r2 = ok(updateDraft(r.bank, "gl1", { passages: [{ page: 5, text: "Kutipan fiktif pengganti untuk uji." }] }, "penyusun"));
    expect(r2.record.passages).toEqual([{ id: "p1", page: 5, text: "Kutipan fiktif pengganti untuk uji." }]);
    expect(r2.record.contributors).toEqual(["penyusun", "pengubah"]);
  });

  it("pedoman yang dibekukan tidak bisa diubah, dengan petunjuk membuat versi baru", () => {
    expect(err(updateDraft(addInReview(emptyBank()).bank, "gl1", {}, "a"))).toContain("Hanya draft");
    expect(err(updateDraft(addApproved(emptyBank()).bank, "gl1", {}, "a"))).toContain("versi baru");
  });
});

describe("versi dan seri", () => {
  it("versi baru dari approved: draf salinan yang menempuh alur dari awal; saat disetujui, versi lama otomatis superseded", () => {
    const a = addApproved(emptyBank(), { fixture: true });
    const nv = ok(newVersionFrom(a.bank, "gl1", "pembaru", at(10)));
    expect(nv.record).toMatchObject({ id: "gl2", seriesId: "gs1", version: 2, status: "draft", supersedes: "gl1", fixture: true, contributors: ["pembaru"] });
    expect(nv.record.passages).toEqual(a.record.passages);
    expect(nv.record.audit[0].note).toBe("Versi baru dari gl1");
    expect(err(newVersionFrom(nv.bank, "gl1", "lain", at(11)))).toContain("masih draft atau review");
    expect(approvedGuidelines(nv.bank, { includeFixtures: true }).map((g) => g.id)).toEqual(["gl1"]); // v1 tetap dipakai selama v2 belum disetujui

    const s = ok(submitForReview(nv.bank, "gl2", "pembaru", at(11)));
    const done = ok(approve(s.bank, "gl2", "peninjau", at(12)));
    const v1 = done.bank.guidelines.find((g) => g.id === "gl1")!;
    expect(v1).toMatchObject({ status: "superseded", supersededBy: "gl2" });
    expect(v1.audit[v1.audit.length - 1]).toMatchObject({ from: "approved", to: "superseded", by: "peninjau", note: "Digantikan oleh gl2" });
    expect(approvedGuidelines(done.bank, { includeFixtures: true }).map((g) => g.id)).toEqual(["gl2"]);
  });

  it("menolak menyetujui bila di seri itu sudah ada versi yang sama atau lebih baru yang approved", () => {
    const a = addApproved(emptyBank());
    const nv = ok(newVersionFrom(a.bank, "gl1", "pembaru", at(10)));
    const s = ok(submitForReview(nv.bank, "gl2", "pembaru", at(11)));
    const skewed: GuidelineBank = { guidelines: s.bank.guidelines.map((g) => (g.id === "gl1" ? { ...g, version: 3 } : g)) };
    expect(err(approve(skewed, "gl2", "peninjau", at(12)))).toContain("lebih baru");
  });

  it("penarikan tanpa pengganti butuh catatan; setelahnya tidak dipakai dan tidak bisa dijadikan versi baru", () => {
    const a = addApproved(emptyBank());
    expect(err(supersede(a.bank, "gl1", "admin", at(10), "x"))).toContain("minimal 5 karakter");
    const d = ok(supersede(a.bank, "gl1", "admin", at(10), "Ditarik karena uji"));
    expect(approvedGuidelines(d.bank)).toEqual([]);
    expect(err(newVersionFrom(d.bank, "gl1", "a", at(11)))).toContain("approved");
  });
});

describe("hanya approved yang dipakai", () => {
  function mixed(): GuidelineBank {
    let b = emptyBank();
    b = addDraft(b, { t: 0, input: dummyInput({ meta: { title: "Pedoman Uji Draft" } }) }).bank; // gl1 draft
    b = addInReview(b, { t: 10, input: dummyInput({ meta: { title: "Pedoman Uji Review" } }) }).bank; // gl2 review
    b = addApproved(b, { t: 20, input: dummyInput({ meta: { title: "Pedoman Uji Approved", topic: "uji" } }) }).bank; // gl3 approved
    const old = addApproved(b, { t: 30, input: dummyInput({ meta: { title: "Pedoman Uji Lama" } }) }); // gl4 approved
    b = ok(supersede(old.bank, "gl4", "admin", at(40), "Ditarik untuk uji")).bank; // gl4 superseded
    b = addApproved(b, { t: 50, fixture: true, input: dummyInput({ meta: { title: "Pedoman Uji Fixture", topic: "fixture" } }) }).bank; // gl5 approved fixture
    return b;
  }

  it("hanya approved non-fixture yang lolos; fixture hanya bila diminta; topik menyaring", () => {
    const b = mixed();
    expect(b.guidelines.map((g) => g.status)).toEqual(["draft", "review", "approved", "superseded", "approved"]);
    expect(approvedGuidelines(b).map((g) => g.id)).toEqual(["gl3"]);
    expect(approvedGuidelines(b, { includeFixtures: true }).map((g) => g.id)).toEqual(["gl3", "gl5"]);
    expect(approvedGuidelines(b, { includeFixtures: true, topic: "fixture" }).map((g) => g.id)).toEqual(["gl5"]);
    expect(approvedGuidelines(b, { topic: "tidak-ada" })).toEqual([]);
  });

  it("kutipan hanya bisa dirujuk dari approved, dengan label yang menyebut penerbit, judul, tahun, dan halaman", () => {
    const b = mixed();
    const r = resolveCitation(b, { guidelineId: "gl3", passageId: "p2" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.passage.page).toBe(12);
    expect(r.label).toBe("Penerbit Fiktif, Pedoman Uji Approved (2024), hlm. 12");
  });

  it.each([
    ["gl1", "draft"],
    ["gl2", "review"],
    ["gl4", "superseded"],
  ])("%s berstatus %s: tidak bisa dirujuk walau kutipannya ada", (id, status) => {
    const r = resolveCitation(mixed(), { guidelineId: id, passageId: "p1" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain(status);
  });

  it("pedoman uji (fixture) tidak dipakai di luar pengujian", () => {
    const b = mixed();
    const r = resolveCitation(b, { guidelineId: "gl5", passageId: "p1" });
    expect(!r.ok && r.reason).toContain("fixture");
    expect(resolveCitation(b, { guidelineId: "gl5", passageId: "p1" }, { includeFixtures: true }).ok).toBe(true);
  });

  it("pedoman atau kutipan yang tidak ada ditolak", () => {
    const b = mixed();
    expect(!resolveCitation(b, { guidelineId: "gl99", passageId: "p1" }).ok).toBe(true);
    const r = resolveCitation(b, { guidelineId: "gl3", passageId: "p99" });
    expect(!r.ok && r.reason).toContain("Kutipan tidak ditemukan");
  });

  it("isi approved yang diubah di penyimpanan (hash tidak cocok) tidak dipakai sama sekali", () => {
    const b = mixed();
    const bad: GuidelineBank = { guidelines: b.guidelines.map((g) => (g.id === "gl3" ? { ...g, passages: g.passages.map((p) => ({ ...p, text: `${p.text} (diubah)` })) } : g)) };
    expect(approvedGuidelines(bad)).toEqual([]);
    const r = resolveCitation(bad, { guidelineId: "gl3", passageId: "p1" });
    expect(!r.ok && r.reason).toContain("hash");
  });

  it("seri dengan lebih dari satu approved dianggap rusak: tidak ada yang dipakai", () => {
    const a = addApproved(emptyBank());
    const dup: GuidelineBank = { guidelines: [...a.bank.guidelines, { ...a.record, id: "gl9", version: 2 }] };
    expect(approvedGuidelines(dup)).toEqual([]);
    const r = resolveCitation(dup, { guidelineId: "gl1", passageId: "p1" });
    expect(!r.ok && r.reason).toContain("lebih dari satu versi approved");
  });
});

describe("membaca dari penyimpanan (data tidak tepercaya)", () => {
  function sample(): GuidelineBank {
    const a = addApproved(emptyBank());
    const nv = ok(newVersionFrom(a.bank, "gl1", "pembaru", at(10)));
    const s = ok(submitForReview(nv.bank, "gl2", "pembaru", at(11)));
    let b = ok(approve(s.bank, "gl2", "peninjau", at(12))).bank; // gl1 superseded, gl2 approved
    b = addDraft(b, { t: 20 }).bank; // gl3 draft
    b = addInReview(b, { t: 30 }).bank; // gl4 review
    return b;
  }

  it("bolak-balik JSON mengembalikan bank yang sama untuk keempat status", () => {
    const b = sample();
    expect(b.guidelines.map((g) => g.status)).toEqual(["superseded", "approved", "draft", "review"]);
    const { bank, dropped } = parseBank(json(b));
    expect(dropped).toBe(0);
    expect(bank).toEqual(b);
    expect(approvedGuidelines(bank).map((g) => g.id)).toEqual(["gl2"]);
  });

  it("bentuk tidak sah ditolak", () => {
    const valid = json(addApproved(emptyBank()).record) as unknown as Record<string, unknown>;
    const review = json(addInReview(emptyBank()).record) as unknown as Record<string, unknown>;
    const bad: [string, unknown][] = [
      ["bukan objek", "teks"],
      ["larik", []],
      ["null", null],
      ["id salah", { ...valid, id: "x1" }],
      ["seri salah", { ...valid, seriesId: "S1" }],
      ["status asing", { ...valid, status: "published" }],
      ["versi 0", { ...valid, version: 0 }],
      ["versi 1000", { ...valid, version: 1000 }],
      ["tanpa pembuat", { ...valid, createdBy: "" }],
      ["waktu rusak", { ...valid, createdAt: "bukan tanggal" }],
      ["tanpa jejak audit", { ...valid, audit: [] }],
      ["status tidak sesuai jejak terakhir", { ...valid, status: "review" }],
      ["review tanpa hash", { ...review, contentHash: undefined }],
      ["hash bukan heksadesimal", { ...review, contentHash: "xyz" }],
      ["approved tanpa penyetuju", { ...valid, approvedBy: "" }],
      ["approved tanpa waktu setuju", { ...valid, approvedAt: undefined }],
    ];
    for (const [name, raw] of bad) expect(parseGuideline(raw), name).toBeNull();
  });

  it("kunci tak dikenal tidak ikut terbawa", () => {
    const valid = json(addApproved(emptyBank()).record) as unknown as Record<string, unknown>;
    const r = parseGuideline({ ...valid, isAdmin: true, meta: { ...(valid.meta as object), evil: "x" } })!;
    expect(r).not.toHaveProperty("isAdmin");
    expect(r.meta).not.toHaveProperty("evil");
  });

  it("isi approved yang diubah di penyimpanan tetap terbaca, tetapi tidak lolos pemakaian", () => {
    const valid = json(addApproved(emptyBank()).record);
    valid.passages[0].text = `${valid.passages[0].text} (diubah di penyimpanan)`;
    const { bank } = parseBank({ guidelines: [valid] });
    expect(bank.guidelines).toHaveLength(1);
    expect(approvedGuidelines(bank)).toEqual([]);
  });

  it("status yang diubah di penyimpanan tanpa jejak audit yang sesuai ditolak, bukan dianggap approved", () => {
    const review = json(addInReview(emptyBank()).record);
    expect(parseGuideline({ ...review, status: "approved", approvedBy: "siapa-saja", approvedAt: at(1).toISOString() })).toBeNull();
  });

  it("akar rusak menghasilkan bank kosong; id ganda memakai yang pertama; kelebihan dibuang dan dihitung", () => {
    for (const raw of [null, [], "x", { guidelines: "x" }, {}]) expect(parseBank(raw)).toEqual({ bank: { guidelines: [] }, dropped: 0 });

    const one = json(addDraft(emptyBank()).record);
    const twice = parseBank({ guidelines: [one, { ...one, meta: { ...one.meta, title: "Judul lain yang berbeda" } }, { id: "rusak" }] });
    expect(twice.bank.guidelines).toHaveLength(1);
    expect(twice.bank.guidelines[0].meta.title).toBe("Pedoman Uji Fiktif Alfa");
    expect(twice.dropped).toBe(2);

    const over = Array.from({ length: LIMITS.guidelines + 3 }, (_, i) => ({ ...one, id: `gl${i + 1}`, seriesId: `gs${i + 1}` }));
    const r = parseBank({ guidelines: over });
    expect(r.bank.guidelines).toHaveLength(LIMITS.guidelines);
    expect(r.dropped).toBe(3);
  });

  it("jejak audit dibatasi 100 entri tetapi tetap berakhir di status sekarang dan bisa dibaca kembali", () => {
    let b = addDraft(emptyBank()).bank;
    for (let i = 0; i < 60; i++) {
      b = ok(submitForReview(b, "gl1", "penyusun", at(i * 2))).bank;
      b = ok(returnToDraft(b, "gl1", "peninjau", at(i * 2 + 1), "Perlu diperbaiki")).bank;
    }
    const rec = b.guidelines[0];
    expect(rec.audit).toHaveLength(LIMITS.audit);
    expect(rec.audit[rec.audit.length - 1].to).toBe("draft");
    expect(parseGuideline(json(rec))).not.toBeNull();
  });
});

describe("batas penggunaan di aplikasi", () => {
  it("bank pedoman memakai node:crypto: tidak boleh diimpor dari komponen klien atau halaman", () => {
    const root = join(process.cwd(), "src");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return name === "api" || name === "__tests__" ? [] : walk(p);
        return /\.(ts|tsx)$/.test(name) ? [p] : [];
      });
    const offenders = [...walk(join(root, "components")), ...walk(join(root, "app"))].filter((f) => /["'][^"']*\/guidelines["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
