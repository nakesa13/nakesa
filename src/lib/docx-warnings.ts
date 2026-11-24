/**
 * T12: teks peringatan pemeriksa .docx. Dipisah dari docx-check.ts (yang membawa pizzip) supaya klien bisa menampilkannya
 * tanpa ikut memuat pustaka server.
 */
export const DOCX_WARNING_TEXT: Record<string, string> = {
  "penanda-mentah": "Masih ada penanda rujukan mentah seperti [S1] di dokumen (mis. di judul bagian). Penanda hanya diubah menjadi sitasi di isi bagian, jadi hapus dari judul.",
  "jenis-konten": "Jenis konten utama template bukan dokumen Word (.docx) biasa. Word mungkin menolak membukanya; simpan template sebagai .docx biasa.",
};

export const warningText = (code: string): string => DOCX_WARNING_TEXT[code] ?? code;
