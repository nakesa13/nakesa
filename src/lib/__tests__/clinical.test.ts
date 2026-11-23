import { describe, expect, it } from "vitest";
import { parseHb, parseLila, parseTrimester, trimesterOfWeeks } from "../clinical/parse";
import { classifyHb, classifyHbAny, reviewClinical } from "../clinical/review";

const ANC = { jenis_asuhan: "Kehamilan (ANC)" };
const ids = (r: ReturnType<typeof reviewClinical>) => r.findings.map((f) => f.id);
const lvl = (r: ReturnType<typeof reviewClinical>, id: string) => r.findings.find((f) => f.id === id)?.level;

describe("pembaca angka", () => {
  it("Hb: koma/titik desimal, satuan diabaikan, bukan HBsAg", () => {
    expect(parseHb("Hb 10,2 g/dL")).toEqual([10.2]);
    expect(parseHb("hemoglobin: 9.8 gr%")).toEqual([9.8]);
    expect(parseHb("HbsAg negatif, HbA1c 5")).toEqual([]);
    expect(parseHb("Hb 105 g/L")).toEqual([]); // satuan SI tidak ditebak
    expect(parseHb("Hb 2 g/dL")).toEqual([]); // tidak masuk akal
  });
  it("Hb ganda dikembalikan semua (tidak memilih salah satu)", () => {
    expect(parseHb("Hb awal 9,8; Hb sesudah 11,2")).toEqual([9.8, 11.2]);
    expect(parseHb("Hb 10,2 dan Hb 10,2 lagi")).toEqual([10.2]);
  });
  it("LiLA", () => {
    expect(parseLila("LiLA 22 cm")).toEqual([22]);
    expect(parseLila("Lingkar lengan atas: 23,5 cm")).toEqual([23.5]);
    expect(parseLila("tidak diukur")).toEqual([]);
  });
  it("trimester dari usia kehamilan; batas minggu 13/14 dan 27/28", () => {
    expect([13, 14, 27, 28].map(trimesterOfWeeks)).toEqual([1, 2, 2, 3]);
    expect(parseTrimester("G1P0A0, usia kehamilan 36 minggu")).toMatchObject({ trimester: 3, weeks: 36, from: "minggu" });
    expect(parseTrimester("UK 30+2 minggu")).toMatchObject({ trimester: 3, weeks: 30 });
    expect(parseTrimester("ibu hamil 20 minggu")).toMatchObject({ trimester: 2 });
  });
  it("trimester dari kata tertulis; ambigu atau tidak ada = null", () => {
    expect(parseTrimester("hamil trimester II")).toMatchObject({ trimester: 2, from: "teks" });
    expect(parseTrimester("TM III")).toMatchObject({ trimester: 3 });
    expect(parseTrimester("trimester I dan trimester III")).toMatchObject({ trimester: null });
    expect(parseTrimester("UK 10 minggu, UK 30 minggu")).toMatchObject({ trimester: null });
    expect(parseTrimester("tidak ada keterangan")).toMatchObject({ trimester: null, from: null });
  });
});

describe("klasifikasi Hb (WHO 2024)", () => {
  it("T1 dan T3: <11 anemia; 10-10,9 ringan; 7-9,9 sedang; <7 berat", () => {
    for (const t of [1, 3] as const) {
      expect(classifyHb(11, t)).toEqual({ anemia: false, level: null });
      expect(classifyHb(10.9, t)).toEqual({ anemia: true, level: "ringan" });
      expect(classifyHb(10, t)).toEqual({ anemia: true, level: "ringan" });
      expect(classifyHb(9.9, t)).toEqual({ anemia: true, level: "sedang" });
      expect(classifyHb(7, t)).toEqual({ anemia: true, level: "sedang" });
      expect(classifyHb(6.9, t)).toEqual({ anemia: true, level: "berat" });
    }
  });
  it("T2: <10,5 anemia; 9,5-10,4 ringan; 7-9,4 sedang", () => {
    expect(classifyHb(10.5, 2)).toEqual({ anemia: false, level: null });
    expect(classifyHb(10.4, 2)).toEqual({ anemia: true, level: "ringan" });
    expect(classifyHb(9.5, 2)).toEqual({ anemia: true, level: "ringan" });
    expect(classifyHb(9.4, 2)).toEqual({ anemia: true, level: "sedang" });
    expect(classifyHb(6.9, 2)).toEqual({ anemia: true, level: "berat" });
  });
  it("trimester tidak diketahui: hanya simpulan yang berlaku di semua trimester", () => {
    expect(classifyHbAny(12, null)).toEqual({ anemia: false, level: null, levelKnown: true });
    expect(classifyHbAny(6, null)).toEqual({ anemia: true, level: "berat", levelKnown: true });
    expect(classifyHbAny(10.2, null)).toEqual({ anemia: true, level: "ringan", levelKnown: true });
    expect(classifyHbAny(10.7, null).anemia).toBeNull(); // anemia di T1/T3, tidak di T2
    expect(classifyHbAny(9.7, null)).toMatchObject({ anemia: true, level: null, levelKnown: false });
    expect(classifyHbAny(10.7, 3)).toMatchObject({ anemia: true, level: "ringan" });
  });
});

describe("penelaah klinis ANC", () => {
  it("tidak berlaku bila jenis asuhan kosong atau bukan ANC", () => {
    expect(reviewClinical({}).applicable).toBe(false);
    const r = reviewClinical({ jenis_asuhan: "Persalinan (INC)", kasus: "Anemia" });
    expect(r.applicable).toBe(false);
    expect(r.findings).toEqual([]);
  });

  it("anemia ringan didukung Hb: sesuai, dengan trimester dari usia kehamilan", () => {
    const r = reviewClinical({ ...ANC, kasus: "Anemia ringan dalam kehamilan", penunjang: "Hb 10,6 g/dL", riwayat_obstetri: "usia kehamilan 36 minggu" });
    expect(lvl(r, "anemia-sesuai")).toBe("sesuai");
    expect(r.findings[0].detail).toContain("trimester III, 36 minggu");
    expect(r.findings[0].detail).toContain("bukan penilaian");
  });

  it("Hb normal tetapi diagnosis anemia: perlu dicek", () => {
    const r = reviewClinical({ ...ANC, kasus: "Anemia ringan", penunjang: "Hb 12,1 g/dL", riwayat_obstetri: "UK 30 minggu" });
    expect(lvl(r, "anemia-tidak-sesuai")).toBe("periksa");
  });

  it("derajat berbeda: diagnosis 'sedang' tetapi Hb 10,6 (ringan)", () => {
    const r = reviewClinical({ ...ANC, kasus: "Anemia sedang", penunjang: "Hb 10,6", riwayat_obstetri: "UK 36 minggu" });
    expect(lvl(r, "anemia-derajat")).toBe("periksa");
    expect(r.findings[0].detail).toContain("ringan");
  });

  it("T2 memakai batas 10,5: Hb 10,7 di T2 bukan anemia, di T3 anemia ringan", () => {
    expect(lvl(reviewClinical({ ...ANC, kasus: "Anemia", penunjang: "Hb 10,7", riwayat_obstetri: "UK 20 minggu" }), "anemia-tidak-sesuai")).toBe("periksa");
    expect(lvl(reviewClinical({ ...ANC, kasus: "Anemia", penunjang: "Hb 10,7", riwayat_obstetri: "UK 32 minggu" }), "anemia-sesuai")).toBe("sesuai");
  });

  it("tidak menebak: Hb tidak terbaca, Hb ganda, trimester tidak terbaca", () => {
    expect(lvl(reviewClinical({ ...ANC, kasus: "Anemia ringan", penunjang: "Hb belum diperiksa" }), "anemia-hb-kosong")).toBe("belum-bisa");
    expect(lvl(reviewClinical({ ...ANC, kasus: "Anemia", penunjang: "Hb 9,8 lalu Hb 11,2" }), "anemia-hb-ganda")).toBe("belum-bisa");
    expect(lvl(reviewClinical({ ...ANC, kasus: "Anemia", penunjang: "Hb 10,7" }), "anemia-trimester")).toBe("belum-bisa");
  });

  it("data menunjukkan anemia tetapi diagnosis tidak menyebutnya", () => {
    const r = reviewClinical({ ...ANC, kasus: "Kehamilan normal", penunjang: "Hb 9,0", riwayat_obstetri: "UK 30 minggu" });
    expect(lvl(r, "anemia-tidak-disebut")).toBe("periksa");
    expect(reviewClinical({ ...ANC, kasus: "Kehamilan normal", penunjang: "Hb 12", riwayat_obstetri: "UK 30 minggu" }).findings).toEqual([]);
  });

  it("diagnosis di teks interpretasi juga dihitung", () => {
    const r = reviewClinical({ ...ANC, kasus: "Kehamilan", penunjang: "Hb 9,0", riwayat_obstetri: "UK 30 minggu" }, { interpretasi: "Diagnosa: ibu hamil dengan anemia sedang" });
    expect(ids(r)).not.toContain("anemia-tidak-disebut");
    expect(ids(r)).toContain("anemia-sesuai");
  });

  it("KEK: LiLA <23,5 sesuai, >=23,5 periksa, kosong belum bisa, tidak disebut tetapi rendah periksa", () => {
    expect(lvl(reviewClinical({ ...ANC, kasus: "KEK", pemeriksaan_fisik: "LiLA 22 cm" }), "kek-sesuai")).toBe("sesuai");
    expect(lvl(reviewClinical({ ...ANC, kasus: "Kurang energi kronis", pemeriksaan_fisik: "LiLA 24 cm" }), "kek-tidak-sesuai")).toBe("periksa");
    expect(lvl(reviewClinical({ ...ANC, kasus: "KEK" }), "kek-lila-kosong")).toBe("belum-bisa");
    expect(lvl(reviewClinical({ ...ANC, kasus: "Kehamilan normal", pemeriksaan_fisik: "LiLA 22" }), "kek-tidak-disebut")).toBe("periksa");
    expect(lvl(reviewClinical({ ...ANC, kasus: "KEK", pemeriksaan_fisik: "LiLA 23,5 cm" }), "kek-tidak-sesuai")).toBe("periksa"); // batas: 23,5 bukan KEK
  });

  it("selalu menyebut yang belum dicek; 'periksa' diurutkan di atas 'sesuai'", () => {
    const r = reviewClinical({ ...ANC, kasus: "Anemia ringan dan KEK", penunjang: "Hb 10,6", pemeriksaan_fisik: "LiLA 24", riwayat_obstetri: "UK 36 minggu" });
    expect(r.notChecked.join(" ")).toContain("Tekanan darah");
    expect(r.findings.map((f) => f.level)).toEqual(["periksa", "sesuai"]);
    expect(r.findings.every((f) => f.basis.length > 20)).toBe(true);
  });
});
