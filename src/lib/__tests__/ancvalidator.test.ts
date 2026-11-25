import { describe, expect, it } from "vitest";
import { SERIAL_KEY } from "../anc";
import {
  PENDING_RULES,
  REGISTRY,
  UK_TOLERANCE_DAYS,
  VALIDATOR_NOTE,
  addDays,
  addMonths,
  checkValue,
  dayNumber,
  localToday,
  parseDate,
  parseUk,
  tpCandidates,
  validateAnc,
  type ValidationReport,
} from "../ancvalidator";
import type { Input } from "../types";

/**
 * T15: Data Validator ANC. Pemeriksaan deterministik, tanpa AI dan tanpa jaringan.
 * Tiap aturan di REGISTRY punya id, sumber, dan test batas. Tidak ada ambang klinis (menunggu T16): nilai klinis
 * yang ekstrem harus menghasilkan temuan yang sama persis dengan nilai biasa.
 */

const TODAY = "2026-11-24";
const base: Input = { jenis_asuhan: "Asuhan kehamilan" };
const run = (extra: Input, today: string | null = TODAY): ValidationReport => validateAnc({ ...base, ...extra }, today ? { today } : {});
const ids = (r: ValidationReport): string[] => r.findings.map((f) => f.ruleId);
const serial = (...items: { id: string; at: string; kind: string; value: string }[]): string => JSON.stringify(items);
const item = (id: string, at: string, kind: string, value: string) => ({ id, at, kind, value });

// HPHT 1 Maret 2026: HPHT + 280 hari = 6 Desember 2026; kedua urutan Naegele = 8 Desember 2026.
const HPHT = "1 Maret 2026";

describe("registri aturan", () => {
  it("id unik, bersumber, dan punya level sah", () => {
    expect(new Set(REGISTRY.map((r) => r.id)).size).toBe(REGISTRY.length);
    for (const r of REGISTRY) {
      expect(r.id, r.id).toMatch(/^[a-z-]+\.[a-z-]+$/);
      expect(r.title.length, r.id).toBeGreaterThan(0);
      expect(r.levels.length, r.id).toBeGreaterThan(0);
      expect(["format", "kalender", "definisi", "konvensi"], r.id).toContain(r.source.kind);
      expect(r.source.ref.length, r.id).toBeGreaterThan(10);
    }
  });

  it("pemeriksaan klinis hanya tercatat sebagai tertunda dan tidak punya aturan yang dijalankan", () => {
    expect(PENDING_RULES.length).toBeGreaterThan(0);
    const reg = new Set(REGISTRY.map((r) => r.id));
    for (const p of PENDING_RULES) {
      expect(p.id).toMatch(/^klinis\./);
      expect(reg.has(p.id), p.id).toBe(false);
      expect(p.blockedBy).toContain("T16");
    }
  });
});

describe("tanggal: batas", () => {
  const OK: string[] = ["29/02/2024", "1990-01-01", "2100-12-31", "31 Maret 2026", "1 Jan 2026", "12 maret 2026", "1 Maret 2026 (01/03/2026)"];
  it.each(OK)("terbaca: %s", (s) => expect(parseDate(s).ok).toBe(true));

  const FAIL: [string, string][] = [
    ["29/02/2026", "tidak-ada"], // bukan tahun kabisat
    ["31/04/2026", "tidak-ada"],
    ["00/03/2026", "tidak-ada"],
    ["12/13/2026", "tidak-ada"],
    ["30 Februari 2026", "tidak-ada"],
    ["1989-12-31", "tahun"], // satu hari di bawah rentang
    ["2101-01-01", "tahun"], // satu hari di atas rentang
    ["kemarin", "format"],
    ["", "format"],
    ["2026", "format"],
    ["1 Maret 2026 dan 2 Maret 2026", "banyak"],
  ];
  it.each(FAIL)("ditolak: %j -> %s", (s, reason) => {
    const p = parseDate(s);
    expect(p.ok).toBe(false);
    expect(p.ok ? "" : p.reason).toBe(reason);
  });

  it("tanggal numerik dibaca hari lebih dulu; ambigu hanya bila kedua bacaan sah dan berbeda", () => {
    const amb = (s: string) => {
      const p = parseDate(s);
      return p.ok ? p.ambiguous : null;
    };
    expect(amb("05/06/2026")).toBe(true);
    expect(amb("13/06/2026")).toBe(false); // 13 bukan bulan
    expect(amb("05/05/2026")).toBe(false); // dua bacaan sama
    expect(amb("2026-06-05")).toBe(false);
    expect(amb("5 Juni 2026")).toBe(false);
    const p = parseDate("05/06/2026");
    expect(p.ok && p.date).toEqual({ y: 2026, m: 6, d: 5 });
  });

  it("aritmatika tanggal: kabisat, akhir bulan, dan pergantian tahun", () => {
    expect(addDays({ y: 2024, m: 2, d: 28 }, 1)).toEqual({ y: 2024, m: 2, d: 29 });
    expect(addDays({ y: 2026, m: 2, d: 28 }, 1)).toEqual({ y: 2026, m: 3, d: 1 });
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
    expect(addMonths({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addMonths({ y: 2024, m: 1, d: 31 }, 1)).toEqual({ y: 2024, m: 2, d: 29 });
    expect(addMonths({ y: 2026, m: 12, d: 15 }, 1)).toEqual({ y: 2027, m: 1, d: 15 });
    expect(addMonths({ y: 2026, m: 1, d: 15 }, -1)).toEqual({ y: 2025, m: 12, d: 15 });
    expect(dayNumber({ y: 2026, m: 3, d: 2 }) - dayNumber({ y: 2026, m: 3, d: 1 })).toBe(1);
  });

  it("localToday memakai tanggal setempat dengan nol di depan", () => {
    expect(localToday(new Date(2026, 10, 24, 23, 59))).toBe("2026-11-24");
    expect(localToday(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
  });
});

describe("HPHT dan TP", () => {
  const hpht = (tp: string) => run({ anc_hpht: HPHT, anc_tp: tp });

  it("TP dari HPHT + 280 hari atau Naegele tidak menghasilkan temuan", () => {
    expect(ids(hpht("6 Desember 2026"))).toEqual([]);
    expect(ids(hpht("8 Desember 2026"))).toEqual([]);
  });

  it("selisih satu hari dari semua hitungan standar hanya 'saran' (TP dari USG wajar berbeda)", () => {
    for (const tp of ["5 Desember 2026", "7 Desember 2026", "9 Desember 2026"]) {
      const r = hpht(tp);
      expect(ids(r), tp).toEqual(["hpht-tp.beda-hitungan"]);
      expect(r.findings[0].level).toBe("saran");
    }
  });

  it("TP pada atau sebelum HPHT = perlu; sehari sesudah HPHT lolos pemeriksaan urutan", () => {
    expect(ids(hpht(HPHT))).toEqual(["kronologi.tp-sebelum-hpht"]);
    expect(ids(hpht("28 Februari 2026"))).toEqual(["kronologi.tp-sebelum-hpht"]);
    const next = ids(hpht("2 Maret 2026"));
    expect(next).not.toContain("kronologi.tp-sebelum-hpht");
    expect(next).toContain("hpht-tp.beda-hitungan");
  });

  it("akhir bulan dan tahun kabisat: hitungan kandidat TP tepat", () => {
    const d = (x: { date: { y: number; m: number; d: number } }) => `${x.date.y}-${x.date.m}-${x.date.d}`;
    expect(tpCandidates({ y: 2025, m: 5, d: 31 }).map(d)).toEqual(["2026-3-7", "2026-3-7", "2026-3-7"]);
    expect(tpCandidates({ y: 2024, m: 2, d: 29 }).map(d)).toEqual(["2024-12-5", "2024-12-7", "2024-12-6"]);
  });

  it("TP yang cocok dengan salah satu dari tiga hitungan tidak ditandai (kasus HPHT 29 Februari)", () => {
    for (const tp of ["5 Desember 2024", "6 Desember 2024", "7 Desember 2024"]) expect(ids(run({ anc_hpht: "29 Februari 2024", anc_tp: tp })), tp).toEqual([]);
  });
});

describe("kronologi terhadap hari ini", () => {
  it("HPHT hari ini lolos; besok = perlu", () => {
    expect(ids(run({ anc_hpht: "24 November 2026" }))).toEqual([]);
    expect(ids(run({ anc_hpht: "25 November 2026" }))).toEqual(["kronologi.hpht-masa-depan"]);
  });

  it("tanggal pengkajian hari ini lolos; besok = perlu", () => {
    expect(ids(run({ tanggal: "24 November 2026" }))).toEqual([]);
    expect(ids(run({ tanggal: "25 November 2026" }))).toEqual(["kronologi.pengkajian-masa-depan"]);
  });

  it("tanggal pengkajian sama dengan HPHT lolos; sehari sebelumnya = perlu", () => {
    expect(ids(run({ anc_hpht: HPHT, tanggal: HPHT }))).toEqual([]);
    expect(ids(run({ anc_hpht: HPHT, tanggal: "28 Februari 2026" }))).toEqual(["kronologi.pengkajian-sebelum-hpht"]);
  });

  it("tanpa 'today' pemeriksaan masa depan tidak dijalankan dan dilaporkan sebagai tidak dievaluasi (bukan 'lolos')", () => {
    const r = run({ anc_hpht: "25 November 2099" }, null);
    expect(ids(r)).toEqual([]);
    expect(r.evaluated).not.toContain("kronologi.hpht-masa-depan");
    expect(r.notEvaluated).toContain("kronologi.hpht-masa-depan");
    const withToday = run({ anc_hpht: "25 November 2099" });
    expect(withToday.evaluated).toContain("kronologi.hpht-masa-depan");
  });

  it("'today' yang tidak terbaca diabaikan, bukan dianggap hari ini", () => {
    expect(ids(validateAnc({ ...base, anc_hpht: "25 November 2099" }, { today: "kemarin" }))).toEqual([]);
  });
});

describe("usia kehamilan", () => {
  const uk = (s: string) => parseUk(s);

  it("format yang dikenal", () => {
    expect(uk("28+3")).toEqual({ kind: "minggu", weeks: 28, days: 3 });
    expect(uk("28 minggu 3 hari")).toEqual({ kind: "minggu", weeks: 28, days: 3 });
    expect(uk("28 mgg")).toEqual({ kind: "minggu", weeks: 28, days: 0 });
    expect(uk("28 minggu + 3 hari")).toEqual({ kind: "minggu", weeks: 28, days: 3 });
    expect(uk("7 bulan")).toEqual({ kind: "bulan" });
    expect(uk("28")).toEqual({ kind: "angka" });
    expect(uk("dua puluh")).toEqual({ kind: "tidak-terbaca" });
  });

  it("hari 6 sah, hari 7 = perlu", () => {
    expect(ids(run({ anc_uk: "28 minggu 6 hari" }))).not.toContain("uk.hari-tidak-sah");
    const r = run({ anc_uk: "28 minggu 7 hari" });
    expect(ids(r)).toContain("uk.hari-tidak-sah");
    expect(r.findings.find((f) => f.ruleId === "uk.hari-tidak-sah")!.level).toBe("perlu");
  });

  it("penulisan yang tidak bisa dicocokkan = saran", () => {
    expect(ids(run({ anc_uk: "28" }))).toEqual(["uk.tanpa-satuan"]);
    expect(ids(run({ anc_uk: "7 bulan" }))).toEqual(["uk.bulan"]);
    expect(ids(run({ anc_uk: "dua puluh" }))).toEqual(["uk.format"]);
  });

  it("0 minggu 0 hari = perlu (angka nol)", () => {
    expect(ids(run({ anc_uk: "0 minggu" }))).toEqual(["nilai.tidak-positif"]);
  });

  // HPHT 1 Maret 2026 ke 20 September 2026 = 203 hari = 29 minggu 0 hari.
  const cmp = (ukText: string) => run({ anc_hpht: HPHT, tanggal: "20 September 2026", anc_uk: ukText });

  it(`batas toleransi ${UK_TOLERANCE_DAYS} hari: selisih ${UK_TOLERANCE_DAYS} lolos, ${UK_TOLERANCE_DAYS + 1} = saran`, () => {
    expect(ids(cmp("29 minggu"))).toEqual([]); // selisih 0
    expect(ids(cmp("30 minggu"))).toEqual([]); // 210 hari: selisih 7
    expect(ids(cmp("28 minggu"))).toEqual([]); // 196 hari: selisih 7
    expect(ids(cmp("30 minggu 1 hari"))).toEqual(["uk.beda-hpht"]); // selisih 8
    expect(ids(cmp("27 minggu 6 hari"))).toEqual(["uk.beda-hpht"]); // selisih 8
    expect(cmp("27 minggu 6 hari").findings[0].level).toBe("saran");
  });

  it("belum bisa dicocokkan bila HPHT atau tanggal pengkajian kosong: dilaporkan 'belum-bisa', bukan lolos", () => {
    const cases: Input[] = [{ anc_uk: "28 minggu" }, { anc_uk: "28 minggu", anc_hpht: HPHT }, { anc_uk: "28 minggu", tanggal: "20 September 2026" }];
    for (const extra of cases) {
      const r = run(extra);
      expect(ids(r)).toEqual(["uk.belum-bisa-dicek"]);
      expect(r.findings[0].level).toBe("belum-bisa");
      expect(r.counts["belum-bisa"]).toBe(1);
    }
  });

  it("tanggal pengkajian sebelum HPHT tidak dibandingkan dengan usia kehamilan (sudah dilaporkan sebagai urutan)", () => {
    const r = run({ anc_hpht: HPHT, tanggal: "28 Februari 2026", anc_uk: "10 minggu" });
    expect(ids(r)).toEqual(["kronologi.pengkajian-sebelum-hpht"]);
  });
});

describe("kunjungan, gravida, para, abortus", () => {
  it("nomor kunjungan: bilangan bulat mulai 1", () => {
    for (const v of ["1", "4", "ke-4", "12"]) expect(ids(run({ anc_kunjungan: v })), v).toEqual([]);
    for (const v of ["0", "abc", "1,5", "-1"]) expect(ids(run({ anc_kunjungan: v })), v).toEqual(["kunjungan.format"]);
  });

  it("G tepat P + A + 1 lolos; kurang satu = perlu", () => {
    expect(ids(run({ anc_gravida: "3", anc_para: "1", anc_abortus: "1" }))).toEqual([]);
    const r = run({ anc_gravida: "2", anc_para: "1", anc_abortus: "1" });
    expect(ids(r)).toEqual(["gpa.tidak-konsisten"]);
    expect(r.findings[0].level).toBe("perlu");
  });

  it("G saja diperiksa terhadap P dan A yang kosong (dianggap 0), G=0 tidak sah", () => {
    expect(ids(run({ anc_gravida: "1" }))).toEqual([]);
    expect(ids(run({ anc_gravida: "0" }))).toEqual(["gpa.tidak-konsisten"]);
    expect(ids(run({ anc_para: "2" }))).toEqual([]); // tanpa G tidak ada yang diperiksa
  });

  it("bukan bilangan bulat = saran dan tidak dihitung", () => {
    expect(ids(run({ anc_gravida: "dua", anc_para: "1" }))).toEqual(["gpa.format"]);
    expect(ids(run({ anc_gravida: "G2", anc_para: "P1", anc_abortus: "A0" }))).toEqual([]);
  });

  it("G/P/A di riwayat kebidanan dipakai bila formulir kosong, dan dibandingkan bila keduanya ada", () => {
    expect(ids(run({ riwayat_obstetri: "G2P1A0" }))).toEqual([]);
    expect(ids(run({ riwayat_obstetri: "G1P1A0" }))).toEqual(["gpa.tidak-konsisten"]);
    const r = run({ anc_gravida: "2", anc_para: "1", anc_abortus: "0", riwayat_obstetri: "G3P1A0" });
    expect(ids(r)).toEqual(["gpa.beda-sumber"]);
    expect(r.findings[0].level).toBe("saran");
    expect(ids(run({ anc_gravida: "2", riwayat_obstetri: "G2P1A0" }))).toEqual([]);
  });
});

describe("satuan dan bentuk nilai", () => {
  // [kolom, isi, id aturan yang diharapkan atau null]
  const CASES: [string, string, string | null][] = [
    ["td", "110/70 mmHg", null],
    ["td", "110/70", null],
    ["td", "121/120", null], // sistolik tepat satu di atas diastolik
    ["td", "120/120", "format.td-terbalik"],
    ["td", "70/110", "format.td-terbalik"],
    ["td", "120/80 kPa", "satuan.tidak-sesuai"],
    ["td", "110", "format.td"],
    ["td", "0/70", "nilai.tidak-positif"],
    ["nadi", "80 x/menit", null],
    ["nadi", "80", null],
    ["nadi", "80 x/detik", "satuan.tidak-sesuai"],
    ["nadi", "abc", "nilai.tanpa-angka"],
    ["nadi", "0", "nilai.tidak-positif"],
    ["rr", "20 x/menit", null],
    ["rr", "20 kali/jam", "satuan.tidak-sesuai"],
    ["suhu", "36,5 °C", null],
    ["suhu", "36.5", null],
    ["suhu", "98 F", "satuan.tidak-sesuai"],
    ["suhu", "310 K", "satuan.tidak-sesuai"],
    ["bb", "60 kg", null],
    ["bb", "60000 g", "satuan.tidak-sesuai"],
    ["bb", "132 lb", "satuan.tidak-sesuai"],
    ["tb", "155 cm", null],
    ["tb", "1,55 m", "satuan.tidak-sesuai"],
    ["anc_tfu", "28 cm", null],
    ["anc_tfu", "280 mm", "satuan.tidak-sesuai"],
    ["anc_djj", "140 x/menit", null],
    ["anc_djj", "2,3 Hz", "satuan.tidak-sesuai"],
  ];

  it.each(CASES)("%s = %j -> %s", (field, value, expected) => {
    const r = run({ [field]: value });
    expect(ids(r)).toEqual(expected ? [expected] : []);
    if (expected) expect(r.findings[0].level).toBe(REGISTRY.find((x) => x.id === expected)!.levels[0]);
  });

  it("satuan tak dikenal tidak ditandai (hindari salah tanda)", () => {
    expect(ids(run({ bb: "60 kilo" }))).toEqual([]);
    expect(ids(run({ suhu: "36,5 derajat" }))).toEqual([]);
  });

  it("saran perbaikan tidak mengubah angka untuk pengguna", () => {
    const [issue] = checkValue("bb", "60000 g");
    expect(issue.suggestion).toContain("Konversikan");
    expect(issue.suggestion).toContain("tidak mengubah angka");
  });
});

describe("tanpa ambang klinis", () => {
  const NORMAL: Input = { td: "110/70 mmHg", nadi: "80 x/menit", rr: "20 x/menit", suhu: "36,5 °C", bb: "60 kg", tb: "155 cm", anc_tfu: "28 cm", anc_djj: "140 x/menit" };
  const EXTREME: Input = { td: "300/200 mmHg", nadi: "250 x/menit", rr: "80 x/menit", suhu: "45 °C", bb: "300 kg", tb: "250 cm", anc_tfu: "90 cm", anc_djj: "30 x/menit" };

  it("nilai klinis ekstrem menghasilkan temuan yang sama persis dengan nilai biasa (tidak ada)", () => {
    const a = run(NORMAL);
    const b = run(EXTREME);
    expect(a.findings).toEqual([]);
    expect(b.findings).toEqual([]);
    expect(b.evaluated).toEqual(a.evaluated);
  });

  it("pengukuran serial ekstrem (Hb, LiLA, DJJ, TD) juga tidak dinilai", () => {
    const s = serial(item("m1", "2026-10-01T08:00", "hb", "2 g/dL"), item("m2", "2026-10-01T08:00", "lila", "5 cm"), item("m3", "2026-10-01T08:00", "djj", "30"), item("m4", "2026-10-01T08:00", "td", "300/200 mmHg"));
    expect(ids(run({ [SERIAL_KEY]: s }))).toEqual([]);
  });

  it("usia kehamilan ekstrem tidak dinilai (hanya dicocokkan dengan HPHT bila ada)", () => {
    expect(ids(run({ anc_uk: "60 minggu" }))).toEqual(["uk.belum-bisa-dicek"]);
    expect(ids(run({ anc_uk: "1 minggu" }))).toEqual(["uk.belum-bisa-dicek"]);
  });

  it("pesan temuan tidak memuat kata penilaian klinis atau diagnosis", () => {
    const FORBIDDEN = /\b(normal|abnormal|diagnosis|aman|sehat|berbahaya|hipertensi|hipotensi|anemia|preeklamsia|demam|takikardi|prematur|aterm|gawat)\b/i;
    for (const [rule, input] of Object.entries(TRIGGERS)) {
      for (const f of run(input).findings) {
        expect(`${f.reason} ${f.suggestion}`, rule).not.toMatch(FORBIDDEN);
      }
    }
    expect(VALIDATOR_NOTE).toContain("bukan penilaian klinis");
  });
});

describe("pengukuran serial", () => {
  const H: Input = { anc_hpht: HPHT };

  it("rangkaian bersih tidak menghasilkan temuan", () => {
    const s = serial(item("m1", "2026-10-01T08:00", "td", "110/70 mmHg"), item("m2", "2026-10-01T08:30", "td", "112/72"), item("m3", "2026-10-01T08:00", "bb", "60 kg"));
    expect(ids(run({ ...H, [SERIAL_KEY]: s }))).toEqual([]);
  });

  it("isi rusak atau entri tidak sah dilaporkan, bukan diam-diam dibuang", () => {
    const broken = run({ [SERIAL_KEY]: "{bukan json" });
    expect(ids(broken)).toEqual(["serial.rusak"]);
    expect(broken.findings[0].level).toBe("perlu");
    const dropped = run({ [SERIAL_KEY]: serial(item("m1", "2026-10-01T08:00", "bb", "60 kg"), item("m2", "2026-10-01T08:00", "tidak-ada", "1")) });
    expect(ids(dropped)).toEqual(["serial.rusak"]);
    expect(dropped.findings[0].reason).toContain("1 pengukuran");
  });

  it("pengukuran bertanggal masa depan: sampai hari ini lolos, besok = perlu", () => {
    expect(ids(run({ [SERIAL_KEY]: serial(item("m1", "2026-11-24T23:59", "bb", "60 kg")) }))).toEqual([]);
    expect(ids(run({ [SERIAL_KEY]: serial(item("m1", "2026-11-25T00:00", "bb", "60 kg")) }))).toEqual(["kronologi.pengukuran-masa-depan"]);
  });

  it("sebelum HPHT: DJJ dan TFU (hanya ada saat hamil) = perlu, jenis lain = saran, hari HPHT lolos", () => {
    const at = (kind: string, value: string, day: string) => run({ ...H, [SERIAL_KEY]: serial(item("m1", `${day}T08:00`, kind, value)) });
    expect(ids(at("djj", "140", "2026-03-01"))).toEqual([]);
    const djj = at("djj", "140", "2026-02-28");
    expect(ids(djj)).toEqual(["kronologi.pengukuran-sebelum-hpht"]);
    expect(djj.findings[0].level).toBe("perlu");
    expect(at("tfu", "28 cm", "2026-02-28").findings[0].level).toBe("perlu");
    const bb = at("bb", "55 kg", "2026-02-28");
    expect(ids(bb)).toEqual(["kronologi.pengukuran-sebelum-hpht"]);
    expect(bb.findings[0].level).toBe("saran");
  });

  it("temuan pada satu pengukuran menunjuk pengukuran itu (id, waktu, jenis)", () => {
    const r = run({ [SERIAL_KEY]: serial(item("m1", "2026-10-01T08:00", "bb", "60 kg"), item("m7", "2026-10-02T09:15", "td", "70/110")) });
    expect(ids(r)).toEqual(["format.td-terbalik"]);
    expect(r.findings[0].item).toEqual({ id: "m7", at: "2026-10-02T09:15", kind: "td" });
    expect(r.findings[0].field).toBe(SERIAL_KEY);
  });

  it("pengukuran ganda: persis sama (jenis, waktu, hasil) = saran; hasil berbeda pada waktu yang sama bukan ganda", () => {
    const same = run({ [SERIAL_KEY]: serial(item("m1", "2026-10-01T08:00", "td", "110/70"), item("m2", "2026-10-01T08:00", "td", "110 / 70")) });
    expect(ids(same)).toEqual(["serial.ganda"]);
    expect(same.findings[0].level).toBe("saran");
    const comma = run({ [SERIAL_KEY]: serial(item("m1", "2026-10-01T08:00", "suhu", "36,5"), item("m2", "2026-10-01T08:00", "suhu", "36.5")) });
    expect(ids(comma)).toEqual(["serial.ganda"]);
    const differ = run({ [SERIAL_KEY]: serial(item("m1", "2026-10-01T08:00", "td", "110/70"), item("m2", "2026-10-01T08:00", "td", "120/80")) });
    expect(ids(differ)).toEqual([]);
  });
});

describe("cakupan, urutan, dan keamanan pemakaian", () => {
  it("bukan ANC dan tanpa kolom ANC: tidak berlaku, tidak ada temuan", () => {
    const r = validateAnc({ jenis_asuhan: "Asuhan nifas" }, { today: TODAY });
    expect(r.applicable).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(r.findings).toEqual([]);
    expect(r.evaluated).toEqual([]);
    expect(r.notEvaluated).toEqual(REGISTRY.map((x) => x.id));
    expect(r.note).toBe(VALIDATOR_NOTE);
  });

  it("jenis lain tetapi ada kolom ANC terisi = berlaku", () => {
    expect(validateAnc({ jenis_asuhan: "Asuhan nifas", anc_hpht: HPHT }, { today: TODAY }).applicable).toBe(true);
  });

  it("ANC tanpa isian: tidak ada temuan, tetapi tidak ada yang 'dievaluasi' (kosong bukan 'dicek dan benar')", () => {
    const r = run({});
    expect(r.applicable).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.evaluated).toEqual([]);
    expect(r.notEvaluated).toHaveLength(REGISTRY.length);
    expect(r.pending).toBe(PENDING_RULES);
  });

  it("evaluated dan notEvaluated saling lepas dan bersama-sama sama dengan registri", () => {
    const r = run({ anc_hpht: HPHT, anc_tp: "6 Desember 2026", td: "110/70 mmHg" });
    expect(r.evaluated.filter((x) => r.notEvaluated.includes(x))).toEqual([]);
    expect([...r.evaluated, ...r.notEvaluated].sort()).toEqual(REGISTRY.map((x) => x.id).sort());
    expect(r.evaluated).toContain("hpht-tp.beda-hitungan");
    expect(r.evaluated).toContain("format.td");
  });

  it("aturan yang dijalankan tetapi lolos tetap tercatat 'dievaluasi' (bukan 'tidak dicek')", () => {
    const ok = run({ anc_uk: "28 minggu", anc_gravida: "2", riwayat_obstetri: "G2P1A0", [SERIAL_KEY]: serial(item("m1", "2026-10-01T08:00", "bb", "60 kg")) });
    expect(ids(ok)).toEqual(["uk.belum-bisa-dicek"]);
    for (const id of ["uk.format", "uk.tanpa-satuan", "uk.bulan", "uk.hari-tidak-sah", "gpa.beda-sumber", "gpa.tidak-konsisten", "serial.rusak", "serial.ganda"]) expect(ok.evaluated, id).toContain(id);
    // Kolom yang kosong atau satu sumber saja: tidak ada yang bisa dibandingkan.
    const none = run({ anc_gravida: "2" });
    expect(none.notEvaluated).toContain("gpa.beda-sumber");
    expect(none.notEvaluated).toContain("serial.ganda");
    expect(none.notEvaluated).toContain("uk.format");
  });

  it("temuan diurutkan perlu, lalu saran, lalu belum-bisa; hitungan cocok", () => {
    const r = run({ anc_hpht: "05/06/2026", anc_gravida: "1", anc_para: "2", anc_uk: "28 minggu" });
    expect(r.findings.map((f) => f.level)).toEqual(["perlu", "saran", "belum-bisa"].filter((l) => r.counts[l as keyof typeof r.counts] > 0).flatMap((l) => Array(r.counts[l as keyof typeof r.counts]).fill(l)));
    expect(r.counts.perlu).toBeGreaterThan(0);
    expect(r.counts.saran).toBeGreaterThan(0);
    expect(r.findings[0].level).toBe("perlu");
    expect(r.counts.perlu + r.counts.saran + r.counts["belum-bisa"]).toBe(r.findings.length);
  });

  it("tidak mengubah isian dan hasilnya sama pada pemanggilan berulang", () => {
    const input: Input = { ...base, anc_hpht: HPHT, anc_tp: "10 Desember 2026", td: "70/110", [SERIAL_KEY]: serial(item("m1", "2026-10-01T08:00", "bb", "60 kg")) };
    const before = JSON.stringify(input);
    const a = validateAnc(input, { today: TODAY });
    const b = validateAnc(input, { today: TODAY });
    expect(JSON.stringify(input)).toBe(before);
    expect(a).toEqual(b);
  });

  it("teks isian sangat panjang dipotong di pesan dan tidak membuat galat", () => {
    const r = run({ anc_hpht: "x".repeat(5000), anc_uk: "y".repeat(5000), anc_kunjungan: "z".repeat(5000) });
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) expect(f.reason.length).toBeLessThan(400);
  });
});

/** Satu masukan yang memicu tiap aturan (bukti tidak ada aturan mati dan tiap aturan punya test). */
const TRIGGERS: Record<string, Input> = {
  "tanggal.format": { anc_hpht: "kemarin" },
  "tanggal.tidak-ada": { anc_hpht: "31/04/2026" },
  "tanggal.tahun": { anc_hpht: "1 Maret 1980" },
  "tanggal.ambigu": { anc_hpht: "05/06/2026" },
  "kronologi.tp-sebelum-hpht": { anc_hpht: HPHT, anc_tp: HPHT },
  "kronologi.hpht-masa-depan": { anc_hpht: "25 November 2026" },
  "kronologi.pengkajian-sebelum-hpht": { anc_hpht: HPHT, tanggal: "28 Februari 2026" },
  "kronologi.pengkajian-masa-depan": { tanggal: "25 November 2026" },
  "kronologi.pengukuran-masa-depan": { [SERIAL_KEY]: serial(item("m1", "2026-11-25T08:00", "bb", "60 kg")) },
  "kronologi.pengukuran-sebelum-hpht": { anc_hpht: HPHT, [SERIAL_KEY]: serial(item("m1", "2026-02-28T08:00", "djj", "140")) },
  "hpht-tp.beda-hitungan": { anc_hpht: HPHT, anc_tp: "10 Desember 2026" },
  "uk.format": { anc_uk: "dua puluh" },
  "uk.tanpa-satuan": { anc_uk: "28" },
  "uk.bulan": { anc_uk: "7 bulan" },
  "uk.hari-tidak-sah": { anc_uk: "28 minggu 7 hari" },
  "uk.beda-hpht": { anc_hpht: HPHT, tanggal: "20 September 2026", anc_uk: "27 minggu 6 hari" },
  "uk.belum-bisa-dicek": { anc_uk: "28 minggu" },
  "kunjungan.format": { anc_kunjungan: "0" },
  "gpa.format": { anc_gravida: "dua" },
  "gpa.tidak-konsisten": { anc_gravida: "1", anc_para: "1" },
  "gpa.beda-sumber": { anc_gravida: "2", riwayat_obstetri: "G3P1A0" },
  "satuan.tidak-sesuai": { bb: "60000 g" },
  "format.td": { td: "abc" },
  "format.td-terbalik": { td: "70/110" },
  "nilai.tidak-positif": { nadi: "0" },
  "nilai.tanpa-angka": { nadi: "abc" },
  "serial.rusak": { [SERIAL_KEY]: "{bukan json" },
  "serial.ganda": { [SERIAL_KEY]: serial(item("m1", "2026-10-01T08:00", "bb", "60 kg"), item("m2", "2026-10-01T08:00", "bb", "60 kg")) },
};

describe("setiap aturan terdaftar bisa terpicu dan temuannya konsisten dengan registri", () => {
  it("tidak ada aturan terdaftar tanpa pemicu, dan tidak ada pemicu untuk aturan yang tidak terdaftar", () => {
    expect(Object.keys(TRIGGERS).sort()).toEqual(REGISTRY.map((r) => r.id).sort());
  });

  it.each(REGISTRY.map((r) => r.id))("%s", (id) => {
    const rule = REGISTRY.find((r) => r.id === id)!;
    const r = run(TRIGGERS[id]);
    const mine = r.findings.filter((f) => f.ruleId === id);
    expect(mine.length, `pemicu ${id} tidak menghasilkan temuan`).toBeGreaterThan(0);
    for (const f of r.findings) {
      const own = REGISTRY.find((x) => x.id === f.ruleId);
      expect(own, f.ruleId).toBeTruthy();
      expect(own!.levels, f.ruleId).toContain(f.level);
      expect(f.source, f.ruleId).toEqual(own!.source);
      expect(f.reason.length, f.ruleId).toBeGreaterThan(0);
      expect(f.suggestion.length, f.ruleId).toBeGreaterThan(0);
      expect(f.label.length, f.ruleId).toBeGreaterThan(0);
    }
    expect(r.evaluated).toContain(rule.id);
  });
});
