/**
 * T12: teks peringatan pemeriksa .docx. Dipisah dari docx-check.ts (yang membawa pizzip) supaya klien bisa menampilkannya
 * tanpa ikut memuat pustaka server.
 */
export const DOCX_WARNING_TEXT: Record<string, string> = {
  "penanda-mentah": "Masih ada penanda rujukan mentah seperti [S1] di dokumen (mis. di judul bagian). Penanda hanya diubah menjadi sitasi di isi bagian, jadi hapus dari judul.",
  "template-elemen-dibuang": "Template memuat tabel, gambar, kotak teks, kontrol konten, atau catatan kaki di area isi/daftar pustaka. Semuanya diganti oleh isi dokumen dan tidak dipertahankan. Pindahkan ke sampul atau lampiran template bila perlu.",
  "template-bagian-digabung": "Template memiliki beberapa pemisah bagian halaman di area isi/daftar pustaka. Hanya yang terakhir dipertahankan, jadi header, footer, atau penomoran halaman dari bagian lain tidak ikut.",
  "pustaka-perlu-diisi": "Belum ada sumber dari Reference Manager yang dikutip, jadi daftar pustaka ditandai \"perlu diisi\". Tidak ada referensi yang dikarang.",
  "sitasi-tak-cocok": "Sitasi di isi dan entri daftar pustaka tidak sepenuhnya cocok (nomor atau nama penulis). Periksa daftar pustaka terhadap sitasi di isi.",
  "jenis-konten": "Jenis konten utama template bukan dokumen Word (.docx) biasa. Word mungkin menolak membukanya; simpan template sebagai .docx biasa.",
};

export const warningText = (code: string): string => DOCX_WARNING_TEXT[code] ?? code;
