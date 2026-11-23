import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATES } from "../../templates";
import type { DocType, Input, Source } from "../types";
import { buildPrompt, generateSection } from "../ai";
import { PATIENT_FIELD_IDS } from "../kasus";
import { PERLU_REFERENSI } from "../lp";
import { POST } from "../../app/api/generate/route";

// T07 (integrasi): jalur server /api/generate untuk tiap dokumen yang dimulai sendiri, tanpa AI sungguhan.
vi.mock("../ai", async (importOriginal) => {
  const m = await importOriginal<typeof import("../ai")>();
  return { ...m, generateSection: vi.fn(m.generateSection) };
});

const JOURNAL: Source = {
  id: "S1",
  type: "jurnal",
  title: "Efek tablet besi pada anemia ibu hamil",
  authors: [{ family: "Rahma", given: "Sari" }],
  year: "2022",
  content: "Sebanyak 120 responden dilibatkan dalam penelitian ini. ".repeat(20),
  origin: "manual",
  verified: false,
};

const firstAi = (t: DocType): string => TEMPLATES[t].sections.find((s) => s.kind === "ai")!.id;

const lastInput = (): Input => vi.mocked(generateSection).mock.calls.at(-1)?.[2] ?? {};

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("NAKESA_MOCK_AI", "1");
  vi.stubEnv("ACCESS_CODE", "");
  vi.mocked(generateSection).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("T07: tiap generator berjalan sendiri lewat /api/generate", () => {
  it("LK dan LP: tanpa dokumen lain, tanpa kasus bersama, tanpa sumber", async () => {
    for (const t of ["LK", "LP"] as const) {
      const res = await call({ docType: t, sectionId: firstAi(t), input: { kasus: "Anemia ringan", jenis_asuhan: "Kehamilan (ANC)" }, sources: [] });
      expect(res.status, t).toBe(200);
      const data = (await res.json()) as { text: string };
      expect(data.text, t).toContain("[CONTOH MODE UJI]");
    }
  });

  it("Reading Journal: hanya butuh teks jurnal, tanpa LK/LP", async () => {
    const res = await call({ docType: "RJ", sectionId: firstAi("RJ"), input: {}, sources: [JOURNAL] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }).text).toContain("[S1]");
  });

  it("Reading Journal tanpa teks jurnal ditolak, tidak diisi dari dokumen lain", async () => {
    const res = await call({ docType: "RJ", sectionId: firstAi("RJ"), input: { topik: "Anemia" }, sources: [] });
    expect(res.status).toBe(400);
  });
});

describe("T08: LP dari topik saja, sumber kosong = [perlu referensi]", () => {
  const input = { kasus: "Anemia ringan", jenis_asuhan: "Kehamilan (ANC)" };

  it("tanpa sumber: paragraf teori ditandai oleh kode dan tidak ada penanda [S#]", async () => {
    const res = await call({ docType: "LP", sectionId: "pengertian", input, sources: [] });
    expect(res.status).toBe(200);
    const { text } = (await res.json()) as { text: string };
    expect(text).toContain(PERLU_REFERENSI);
    expect(text).not.toMatch(/\[S\d+\]/);
  });

  it("dengan sumber berisi: tidak ditandai dan boleh mengutip sumber itu", async () => {
    const res = await call({ docType: "LP", sectionId: "pengertian", input, sources: [JOURNAL] });
    const { text } = (await res.json()) as { text: string };
    expect(text).not.toContain(PERLU_REFERENSI);
    expect(text).toContain("[S1]");
  });

  it("menulis ulang satu subbab hanya memproses subbab itu (permintaan per bagian)", async () => {
    await call({ docType: "LP", sectionId: "etiologi", input, sources: [] });
    expect(vi.mocked(generateSection)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateSection).mock.calls[0][1]).toBe("etiologi");
  });

  it("LK dan Reading Journal tidak diberi tanda ini", async () => {
    const lk = await call({ docType: "LK", sectionId: firstAi("LK"), input: { kasus: "Anemia" }, sources: [] });
    expect(((await lk.json()) as { text: string }).text).not.toContain(PERLU_REFERENSI);
    const rj = await call({ docType: "RJ", sectionId: firstAi("RJ"), input: {}, sources: [JOURNAL] });
    expect(((await rj.json()) as { text: string }).text).not.toContain(PERLU_REFERENSI);
  });
});

describe("T09: LK ANC lewat /api/generate", () => {
  const input = { jenis_asuhan: "Kehamilan (ANC)", kasus: "Anemia ringan", inisial: "Ny. S" };

  it("nilai ANC yang dikarang AI saat kolom kosong diberi peringatan oleh server", async () => {
    vi.mocked(generateSection).mockResolvedValueOnce({ text: "DJJ 148 x/menit dan TFU 30 cm. HPHT 3 Maret 2026.", stripped: [] });
    const res = await call({ docType: "LK", sectionId: "interpretasi", input, sources: [] });
    expect(res.status).toBe(200);
    const { warnings } = (await res.json()) as { warnings: { unsupportedNumbers: string[] } };
    expect(warnings.unsupportedNumbers).toEqual(expect.arrayContaining(["148 x/menit", "30 cm", "3 Maret 2026"]));
  });

  it("bagian data (subjektif/objektif) disusun kode: kolom kosong [belum diisi], AI tidak dipanggil", async () => {
    const res = await call({ docType: "LK", sectionId: "objektif", input, sources: [] });
    expect(res.status).toBe(200);
    const { text } = (await res.json()) as { text: string };
    expect(text).toContain("| Denyut jantung janin (DJJ) | [belum diisi] |");
    expect(text).toContain("**Pengukuran Serial**\n\n[belum diisi]");
    expect(vi.mocked(generateSection)).not.toHaveBeenCalled();
  });
});

describe("T07: data pasien tidak sampai ke Reading Journal", () => {
  const dirty = { topik: "ASI eksklusif", inisial: "Ny. S", umur: "27 tahun", td: "110/70 mmHg", implementasi: "Tablet Fe", keluhan_utama: "Lemas dan pusing" };

  it("server membuang kolom pasien dari input RJ sebelum diteruskan", async () => {
    const res = await call({ docType: "RJ", sectionId: firstAi("RJ"), input: dirty, sources: [JOURNAL] });
    expect(res.status).toBe(200);
    const passed = lastInput();
    for (const id of PATIENT_FIELD_IDS) expect(passed[id], id).toBeUndefined();
    expect(passed.topik).toBe("ASI eksklusif");
  });

  it("LK tetap menerima data pasien (kolom itu memang miliknya)", async () => {
    await call({ docType: "LK", sectionId: firstAi("LK"), input: { ...dirty, kasus: "Anemia" }, sources: [] });
    expect(lastInput().td).toBe("110/70 mmHg");
  });

  it("prompt RJ tidak memuat nilai data pasien walau input tercemar", () => {
    const section = TEMPLATES.RJ.sections.find((s) => s.id === "hasil")!;
    const { prompt } = buildPrompt("RJ", section, dirty, [JOURNAL]);
    for (const v of ["Ny. S", "27 tahun", "110/70 mmHg", "Tablet Fe", "Lemas dan pusing"]) expect(prompt).not.toContain(v);
    expect(prompt).not.toContain("DATA KASUS");
  });
});
