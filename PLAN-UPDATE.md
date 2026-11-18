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

## Tahap B (kode selesai, BELUM dijalankan/diuji): bab dan formulir mengikuti template
Keputusan: judul bab dibaca dari template dengan KODE (tanpa AI, gratis), diklasifikasi dengan aturan kata kunci, lalu dikonfirmasi/diubah mahasiswa. AI untuk menafsirkan judul yang ambigu bisa ditambahkan nanti bila aturan kata kunci terbukti kurang.
- `src/lib/outline.ts`: baca judul (gaya Heading Word, atau pola BAB/A./1.; "BAB I" + "PENDAHULUAN" digabung), klasifikasi per jenis dokumen dan zona bab (pendahuluan/teori/kasus/pembahasan/penutup), bangun definisi bagian, validasi butir dari klien.
- Peran tiap bagian: Judul saja, Ditulis AI, Dari isian (data subjektif/objektif/implementasi/evaluasi/identitas jurnal), Isi sendiri.
- Aturan keselamatan: judul tak dikenal di bab kasus LK = "Isi sendiri" (AI tidak menulis data pasien). Instruksi AI TIDAK diterima dari klien; server membangun ulang dari id bagian baku atau aturan umum. Judul dibersihkan dari karakter kontrol.
- Langkah baru "Struktur" di wizard (`OutlineStep.tsx`): baca dari template, ubah judul/tingkat/sumber isi, urutkan, tambah/hapus. Maks. 60 bagian (batas API docx).
- Formulir dinamis (LK): langkah subjektif/objektif/tindakan hanya tampil bila struktur membutuhkannya; bila ada bagian analisis pasien oleh AI, semuanya tampil.
- Saat struktur dipakai, contoh format judul per tingkat diambil dari judul nyata di template.
- Struktur disimpan di draf (localStorage); template tetap di IndexedDB. Template dihapus/diganti = struktur direset.
- Tes baru: `src/lib/__tests__/outline.test.ts`.
- Belum: pratinjau persis (LibreOffice), penafsiran AI untuk judul ambigu, struktur yang dibagi antar dokumen (rencana Tahap C: satu "Kasus" untuk LK/LP/Jurnal + pemeriksa konsistensi).
- Pratinjau persis via LibreOffice menunggu keputusan VPS/Docker; sementara pratinjau perkiraan di peramban (docx-preview).

## Sebelum dipublikasikan (hasil audit)
- Ganti GROQ_API_KEY (kunci lama sempat tertempel di chat), wajib ACCESS_CODE atau login, rate limit terpusat, header keamanan.
- Turunkan status `verified` sumber bila isi/jurnal/halaman diubah; rinci peringatan sebelum unduh.
- Git + CI (lint, tipe, tes).
