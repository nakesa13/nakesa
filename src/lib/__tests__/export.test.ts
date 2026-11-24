import { describe, expect, it } from "vitest";
import type { SectionDef } from "@/templates/types";
import { KOSONG } from "../case";
import { documentTitle, identityPayload, sectionPayload } from "../export";

// T12: bahan ekspor yang sama dipakai unduh .docx dan pratinjau/PDF.

const def = (o: Record<string, unknown>) => ({ id: "x", title: "Judul", level: 2, kind: "ai", guide: "", ...o }) as unknown as SectionDef;

describe("documentTitle", () => {
  it("urutan: isian judul, judul jurnal (RJ), judul cadangan LP, nama dokumen", () => {
    expect(documentTitle("LK", { judul: "  Judul Saya " }, "Laporan Kasus")).toBe("Judul Saya");
    expect(documentTitle("RJ", { j_title: " Judul Jurnal " }, "Reading Journal")).toBe("Judul Jurnal");
    expect(documentTitle("LP", { jenis_asuhan: "Kehamilan (ANC)", kasus: "Anemia" }, "Laporan Pendahuluan")).toBe("Asuhan Kebidanan pada Ibu Hamil dengan Anemia");
    expect(documentTitle("LK", {}, "Laporan Kasus")).toBe("Laporan Kasus");
    expect(documentTitle("LP", { kasus: "  " }, "Laporan Pendahuluan")).toBe("Laporan Pendahuluan");
  });

  it("judul jurnal hanya dipakai untuk Reading Journal; judul yang hanya spasi dilewati", () => {
    expect(documentTitle("LK", { j_title: "Judul Jurnal" }, "Laporan Kasus")).toBe("Laporan Kasus");
    expect(documentTitle("RJ", { j_title: "   " }, "Reading Journal")).toBe("Reading Journal");
  });
});

describe("identityPayload", () => {
  it("hanya enam kolom identitas; yang tidak ada menjadi teks kosong; kolom pasien tidak ikut", () => {
    const id = identityPayload({ nama: "Siti", nim: "1", td: "110/70 mmHg", inisial: "Ny. S" });
    expect(id).toEqual({ nama: "Siti", nim: "1", prodi: "", kampus: "", pembimbing: "", tahun: "" });
  });
});

describe("sectionPayload", () => {
  const texts: Record<string, string> = { a: "Isi A", d: "Isi data", m: "  " };
  const text = (s: SectionDef) => texts[s.id] ?? "";

  it("judul memakai isian ({kasus}), judul bab tanpa teks, bagian data/AI membawa teksnya", () => {
    const out = sectionPayload(
      [def({ id: "h", title: "Konsep {kasus}", level: 1, kind: "heading" }), def({ id: "a", title: "A. Isi", kind: "ai" }), def({ id: "d", title: "B. Data", kind: "data" })],
      { kasus: "Anemia" },
      text
    );
    expect(out).toEqual([
      { id: "h", title: "Konsep Anemia", level: 1, kind: "heading", text: "" },
      { id: "a", title: "A. Isi", level: 2, kind: "ai", text: "Isi A" },
      { id: "d", title: "B. Data", level: 2, kind: "data", text: "Isi data" },
    ]);
  });

  it("bagian 'isi sendiri' yang kosong ditulis penanda kosong, bukan dibiarkan hilang atau diisi", () => {
    const [m, f] = sectionPayload([def({ id: "m", kind: "data", manual: true }), def({ id: "zz", kind: "data", manual: true })], {}, text);
    expect(m.text).toBe(KOSONG); // hanya spasi = kosong
    expect(f.text).toBe(KOSONG); // tidak ada teks sama sekali
  });

  it("bagian 'isi sendiri' yang sudah diisi memakai isinya", () => {
    const [x] = sectionPayload([def({ id: "a", kind: "data", manual: true })], {}, text);
    expect(x.text).toBe("Isi A");
  });
});
