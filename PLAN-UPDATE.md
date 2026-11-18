# Pembaruan PLAN.md (tempel/gabungkan ke PLAN.md v2)

## Status v0.1 (versi uji, tanpa login)
- LP, LK, Reading Journal -> .docx; referensi DOI/manual; APA/Vancouver; anti-mengarang (penanda [S#], daftar pustaka dari kode, pemeriksa angka).
- Penyedia AI: Groq (gratis) atau Anthropic, dipilih lewat `AI_PROVIDER`. Pemanggilan Groq sungguhan BELUM teruji (sandbox pengembangan tidak bisa menjangkau Groq); uji di komputer sendiri.
- Template unggahan mahasiswa: Tahap A selesai (lihat bawah). 34 tes lulus, lint dan build bersih, E2E browser lulus.

## Keputusan: format dokumen ditentukan mahasiswa, bukan sistem
Format tiap kampus berbeda, jadi template bukan buatan sistem. Mahasiswa mengunggah .docx contoh SEBELUM mengisi data pasien. Template sistem hanya cadangan.
Pendekatan placeholder `{{isi}}` (versi agen lain) DIBUANG: memaksa mahasiswa mengedit template dan tidak mempertahankan daftar isi/nomor halaman.

## Tahap A (selesai): template sebagai dasar dokumen
- Buka .docx (ZIP/OOXML), pertahankan sampul, logo, header/footer, nomor halaman (romawi), daftar isi; ganti hanya isi bab.
- Paragraf baru meniru pPr/rPr paragraf contoh (judul bab, subjudul, isi, daftar pustaka) di template.
- Pembacaan otomatis + konfirmasi/koreksi mahasiswa; tersimpan di IndexedDB; server tidak menyimpan.
- Daftar isi: field otomatis, nomor halaman terisi di Word saat dibuka.
- Tahap A masih memakai susunan bagian LP/LK/RJ tetap dari NAKESA.

## Tahap B (berikutnya): formulir dan bab dinamis dari template
- AI (model gratis cukup, input kecil: daftar judul template) menafsirkan struktur bab/subbab template menjadi bagian dan formulir.
- Mahasiswa mengonfirmasi/mengubah struktur sebelum mengisi data.
- Pratinjau persis via LibreOffice menunggu keputusan VPS/Docker; sementara pratinjau perkiraan di peramban (docx-preview).

## Sebelum dipublikasikan (hasil audit)
- Ganti GROQ_API_KEY (kunci lama sempat tertempel di chat), wajib ACCESS_CODE atau login, rate limit terpusat, header keamanan.
- Turunkan status `verified` sumber bila isi/jurnal/halaman diubah; rinci peringatan sebelum unduh.
- Git + CI (lint, tipe, tes).
