import { describe, expect, it } from "vitest";
import { ExtractError, docxToText, extractSourceText } from "../extract";
import { styledTemplate } from "./fixtures";

describe("unggah jurnal/referensi: ekstraksi teks", () => {
  it("membaca teks dari file Word; kode field daftar isi tidak ikut", async () => {
    const buf = await styledTemplate();
    const r = await extractSourceText(new Uint8Array(buf), "jurnal.docx");
    expect(r.kind).toBe("docx");
    expect(r.pages).toBeNull();
    expect(r.text).toContain("A. Latar Belakang");
    expect(r.text).toContain("Isi lampiran contoh yang harus tetap ada.");
    expect(r.text).not.toMatch(/TOC\s+\\o/);
    expect(r.text).not.toContain("<w:");
    expect(r.chars).toBeGreaterThanOrEqual(200);
  });

  it("membaca file teks dan menolak yang terlalu pendek", async () => {
    const ok = await extractSourceText(new TextEncoder().encode("Anemia adalah kondisi kekurangan hemoglobin. ".repeat(10)), "catatan.txt");
    expect(ok.kind).toBe("txt");
    expect(ok.truncated).toBe(false);
    await expect(extractSourceText(new TextEncoder().encode("terlalu pendek"), "a.txt")).rejects.toThrow(/terlalu pendek/i);
  });

  it("memotong teks yang sangat panjang pada 60.000 karakter", async () => {
    const r = await extractSourceText(new TextEncoder().encode("kalimat uji panjang. ".repeat(5000)), "panjang.txt");
    expect(r.text.length).toBe(60_000);
    expect(r.truncated).toBe(true);
    expect(r.chars).toBeGreaterThan(60_000);
  });

  it("menolak format yang tidak didukung dan file biner berekstensi txt", async () => {
    await expect(extractSourceText(new Uint8Array([1, 2, 3, 4, 5, 6, 7]), "a.exe")).rejects.toMatchObject({ status: 400 });
    const bin = new Uint8Array(400);
    bin.fill(65);
    bin[10] = 0;
    await expect(extractSourceText(bin, "palsu.txt")).rejects.toBeInstanceOf(ExtractError);
  });

  it("menolak file .docx yang rusak", () => {
    expect(() => docxToText(new Uint8Array([0x50, 0x4b, 1, 2, 3, 4]))).toThrow(ExtractError);
  });
});
