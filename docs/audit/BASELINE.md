# NAKESA — Audit Baseline (T00)

Tanggal audit: 2026-11-24
Jenis: pembacaan statis kode dan dokumen. Tidak ada kode produk yang diubah.

## 0. Batas audit (baca dulu)

- **Test, lint, typecheck, dan build TIDAK dijalankan.** Sesi ini tidak punya akses terminal. Semua status "tested" di bawah berarti *ada file test untuk fungsi itu*, bukan *test itu lulus*. Hasil sebenarnya wajib dicek lewat T01.
- `git status` tidak dijalankan. Riwayat commit dibaca dari `.git/logs/HEAD` (5 entri: 2 commit awal, Tahap B, Tahap C, dan satu entri lain).
- `.env.local` sengaja tidak dibuka. Hanya `.env.example` yang dibaca.
- File komponen UI dibaca selektif (Wizard, KasusPage, SourceManager, JournalField, AppShell). Komponen lain (LibraryPage, SettingsPage, TemplateStep, OutlineStep, DraftHint, Icon), halaman `/lp` dan `/rj`, `docx-builder.ts`, `outline.ts`, `markup.ts`, dan modul `src/lib/template/*` selain `package.ts` tidak dibaca baris demi baris. Statusnya di bawah disimpulkan dari file test, README, nav, dan PLAN-UPDATE.

## 1. Arsitektur

Next.js (App Router) + TypeScript, satu monolit, tanpa database dan tanpa login. Semua state pengguna ada di peramban; server hanya memproses permintaan (AI, DOCX, ekstraksi file, DOI) dan tidak menyimpan apa pun.

```
Peramban (localStorage + IndexedDB)
   |  fetch (header x-access-code opsional)
Next.js route handler  /api/*
   |-- guard.ts           (kode akses, rate limit per IP di memori, validasi input)
   |-- ai.ts              (Groq via fetch, atau Anthropic SDK; NAKESA_MOCK_AI=1 = teks contoh)
   |-- case.ts, citations.ts, outline.ts   (aturan di kode)
   |-- docx-builder.ts, template/*         (DOCX bawaan atau di atas template kampus)
   |-- extract.ts, crossref.ts             (ekstraksi file, metadata DOI)
Layanan luar: Groq API / Anthropic API / Crossref API
```

Dependensi utama (versi lihat `package.json`): next, react, docx, pizzip, unpdf, @anthropic-ai/sdk, vitest, tailwind.

## 2. Route halaman dan API

Halaman (dari `AppShell.tsx` dan `src/app`): `/` beranda, `/lp`, `/lk`, `/rj`, `/kasus`, `/sumber`, `/pengaturan`.

| Endpoint | File | Fungsi | Pelindung | Catatan |
|---|---|---|---|---|
| POST /api/generate | `src/app/api/generate/route.ts` | Tulis satu bagian (AI atau susunan kode) | guard 200/jam, validasi input, sumber diparse ketat | Instruksi AI dibangun ulang di server dari ref baku; klien tidak bisa menyuntik instruksi |
| POST /api/docx | `src/app/api/docx/route.ts` | Susun .docx (bawaan atau template unggahan) | guard 100/jam, batas 60 bagian, template maks 8 MB, cek magic "PK" | Template dikirim per permintaan |
| POST /api/doi | `src/app/api/doi/route.ts` | Metadata dari Crossref | guard 60/jam | Host tujuan tetap (api.crossref.org) |
| POST /api/extract-source | `src/app/api/extract-source/route.ts` | Teks dari PDF/DOCX/TXT | guard 60/jam, maks 10 MB | Dipakai JournalField dan SourceManager |
| POST /api/extract-pdf | `src/app/api/extract-pdf/route.ts` | Teks dari PDF | guard 60/jam, maks 10 MB | Tampak duplikat dan tidak dipakai komponen yang dibaca; kandidat dihapus |
| POST /api/template/analyze | `src/app/api/template/analyze/route.ts` | Analisis struktur template .docx | guard 60/jam, maks 8 MB, ekstensi dan magic | |

Tidak ada route untuk: impor URL, login, penyimpanan, admin, atau reviewer akademik.

## 3. Penyimpanan

| Data | Lokasi | Key | Catatan |
|---|---|---|---|
| Draf dokumen (isian, sumber, teks, langkah, outline) | localStorage | `nakesa.draft.LP/LK/RJ` | Draf LK memuat data klinis pasien (isian mahasiswa) |
| Kasus bersama | localStorage | `nakesa.case` | Satu kasus saja; sumber migrasi untuk T06 |
| Pengaturan (identitas, gaya rujukan, **kode akses**) | localStorage | `nakesa.settings` | Kode akses tersimpan polos |
| Pustaka Saya | localStorage | `nakesa.library` | Isi sumber dipotong 12.000 karakter |
| Template kampus | IndexedDB | db `nakesa`, store `templates` | Dikirim ke server tiap generate DOCX |
| Tema | localStorage | `nakesa.theme` | |

Server tidak menyimpan data. Batas localStorage (sekitar 5 MB) belum ditangani selain try/catch diam-diam di `useLocalState.ts`.

## 4. Test, lint, build

| Item | Status |
|---|---|
| Runner | Vitest, `vitest.config.mts`, pola `src/**/*.test.ts`, environment node |
| File test (9) di `src/lib/__tests__/` | `case`, `citations`, `clinical`, `consistency`, `docx`, `extract`, `groq`, `outline`, `template`; plus `fixtures.ts` |
| Script npm | `test`, `lint`, `build` ada; **script `typecheck` tidak ada** (`tsconfig.json` strict, `noEmit`; `npx tsc --noEmit` bisa dijalankan langsung) |
| Lint | ESLint flat config (`eslint.config.mjs`, next core-web-vitals + typescript) |
| Mock AI | `NAKESA_MOCK_AI=1` hanya dihormati di `generateSection` (`ai.ts`). Test Groq memakai `fetch` palsu (`vi.stubGlobal`), jadi tidak butuh kunci atau jaringan |
| Test komponen/UI, test route API, E2E, CI | **tidak ada** |
| Hasil terakhir test/lint/tsc/build | **tidak diketahui** (tidak dijalankan di audit ini) |
| Kelemahan test | `docx.test.ts` memeriksa isi hanya bila `pandoc` terpasang; bila tidak, test selesai diam-diam tanpa memeriksa isi |

## 5. Status fitur

Legenda: tested = ada file test (hasil belum diverifikasi); partial = sebagian jalan/teruji; untested = kode ada tanpa test; missing = belum ada.

| Fitur | Status | Lokasi | Catatan |
|---|---|---|---|
| Wizard LP/LK/RJ, edit per bagian, tulis ulang | partial | `components/Wizard.tsx`, `templates/*` | Tidak ada test UI. Generate berurutan; refresh tidak menghilangkan draf (localStorage) |
| Generate per bagian (route) | untested | `api/generate/route.ts`, `lib/ai.ts` | Provider Groq teruji dengan fetch palsu; route dan prompt tidak |
| Penanda sitasi [S#] dan penghapusan ID tak dikenal | tested | `lib/citations.ts` | `citations.test.ts` |
| Daftar pustaka APA/Vancouver oleh kode | tested | `lib/citations.ts` | Kasus DOI tak ketemu, duplikat, yatim belum ada |
| Data klinis tidak dikarang (`[belum diisi]`, angka asing ditandai) | tested | `lib/case.ts` | `case.test.ts`; bukan jaminan, hanya penanda |
| Ringkasan RJ: angka harus ada di teks jurnal | tested | `lib/case.ts` | `findUnsupportedAny`; p-value dan penulis tidak diperiksa terpisah |
| DOCX bawaan | tested | `lib/docx-builder.ts` | Pemeriksaan isi bergantung pandoc |
| Template kampus Tahap A | tested | `lib/template/*` | `template.test.ts` (3 fixture). Batas ukuran total terbuka di `package.ts`; tes zip bomb dan path traversal belum ada |
| Outline dinamis Tahap B | tested | `lib/outline.ts` | `outline.test.ts` lengkap; menurut `PLAN-UPDATE.md` belum pernah dijalankan (T02) |
| Kasus bersama dan pemeriksa konsistensi Tahap C | tested | `lib/kasus.ts`, `lib/consistency.ts`, `components/KasusPage.tsx` | `consistency.test.ts`; menurut `PLAN-UPDATE.md` belum diverifikasi (T03) |
| Ekstraksi PDF/DOCX/TXT | partial | `lib/extract.ts` | Teruji: docx, txt, biner palsu, docx rusak, terlalu pendek, terlalu panjang. Belum teruji: PDF valid, PDF scan, PDF rusak, file terlalu besar (cek ada di route) |
| Impor DOI (Crossref) | untested | `lib/crossref.ts` | Tidak ada test. Metadata ditandai `verified: true`; tidak ada pencocokan isi PDF dengan DOI |
| Impor URL | missing | — | Kolom URL hanya teks manual; server tidak mengambil URL (jadi belum ada permukaan SSRF) |
| Provenance sumber (asal, tanggal, metode ekstraksi, hash) | missing | `lib/types.ts` | Hanya `origin` (crossref/manual) dan `verified` (boolean) |
| Status sumber bertingkat (imported ... guideline-approved) | missing | — | T13 |
| Reading Journal dari PDF/DOCX/TXT/DOI | partial | `components/JournalField.tsx` | Ada. Belum ada: tanda "tidak dilaporkan", deteksi DOI tidak cocok, pemisahan ringkasan vs critical appraisal |
| Critical appraisal | missing | — | T18 |
| Telaah klinis Lapis 1 (Hb, LiLA) | tested | `lib/clinical/review.ts`, `parse.ts`, `KasusPage.tsx` | `clinical.test.ts`. **Berbeda dari rancangan T15–T17**, lihat bagian 6 |
| Telaah klinis Lapis 2 (LLM + kutipan pedoman) | missing | — | T17 |
| Bank pedoman klinis | missing | — | T16 |
| Validator data ANC (tanggal, HPHT, TP) | missing | — | T15 |
| Academic Reviewer | missing | — | T14 |
| Multi-workspace / multi-kasus | missing | `lib/kasus.ts` | Satu key `nakesa.case` |
| Tiga generator mandiri dari dashboard | partial | `app/page.tsx`, `/lp` `/lk` `/rj` | LP/LK memakai kasus bersama, tapi tidak ada alur "buat tanpa dokumen lain" yang eksplisit dan tidak ada reuse opt-in |
| Export PDF | missing | — | Hanya .docx; pratinjau browser belum ada |
| Auth, role, database, RLS, storage privat | missing | — | Fase 3 |
| Quota/rate limit terdistribusi | missing | `lib/guard.ts` | Rate limit `Map` di memori |
| CI, E2E, monitoring, backup, staging | missing | — | Tidak ada `.github/`, Playwright, atau konfigurasi env bertingkat |
| Privasi: data inventory, ekspor/hapus data, notice | missing | — | Belum diperiksa apakah form LK memuat peringatan data pasien |

## 6. Temuan dan risiko (urut prioritas)

1. **Tidak ada login; akses hanya `ACCESS_CODE` opsional** (`lib/guard.ts`). Bila env kosong, semua API terbuka. Perbandingan kode memakai `!==` (tidak constant-time). Kode akses tersimpan polos di localStorage. Cukup untuk uji lokal, tidak cukup untuk internet.
2. **Rate limit lemah** (`lib/guard.ts`): `Map` di memori (hilang saat restart, tidak jalan di multi-instance) dan kunci memakai header `x-forwarded-for` yang bisa dipalsukan klien bila server tidak di belakang proxy tepercaya.
3. **Telaah klinis memuat ambang klinis di kode** (`lib/clinical/review.ts`): Hb per trimester (WHO 2024) dan LiLA 23,5 cm. Ini bertentangan dengan prinsip T15 ("jangan menetapkan ambang klinis sebelum ada pedoman approved") dan T16 (hanya pedoman approved yang boleh dipakai). `BASIS_HB` juga merujuk "menurut jurnal yang mengutipnya" (sumber sekunder). Status keluaran (`sesuai` / `periksa` / `belum-bisa`) berbeda dari empat status T17, dan label UI "Sesuai data" perlu ditinjau terhadap larangan "diagnosis benar". Fitur ini sudah tampil di `/kasus`, jadi perlu keputusan: disembunyikan, diberi label eksperimental, atau dimigrasi ke bank pedoman.
4. **Ekstraksi DOCX tanpa batas ukuran sebelum dekompresi** (`lib/extract.ts`, `docxToText`): `zip.file(...).asText()` dijalankan sebelum cek 30 juta karakter; zip bomb kecil bisa menghabiskan memori. `lib/template/package.ts` sudah punya cek ukuran total, `extract.ts` belum.
5. **Injeksi prompt: sebagian terlindungi.** Instruksi server dipisah, isi sumber dibungkus tag, dan marker palsu dibuang (`sanitizeMarkers`). Tetapi isi sumber dan isian tidak di-escape, sehingga teks seperti `</isi_sumber>` di dalam PDF dapat menutup tag lebih awal. Teks sumber dari klien bisa sampai 80.000 karakter per sumber (`lib/guard.ts`). Belum ada test injeksi (T19).
6. **Metadata Crossref ditandai `verified: true`, dan abstrak otomatis menjadi `content`** (`lib/crossref.ts`). DOI valid tidak berarti isi yang dipakai AI cocok dengan DOI itu; DOI yang ditemukan di teks PDF langsung dipakai tanpa pencocokan judul.
7. **Ambang "teks tidak terbaca" tidak konsisten:** 500 karakter di `api/extract-pdf`, 200 di `lib/extract.ts`, sementara wizard RJ meminta 500.
8. **Kode mati/duplikat:** `api/extract-pdf/route.ts`.
9. **`NAKESA_MOCK_AI=1` tidak dikunci terhadap produksi** (hanya peringatan di `.env.example`).
10. **Data pasien di localStorage tanpa enkripsi** (draf LK). Belum diperiksa ada tidaknya peringatan "jangan isi nama/NIK/alamat" di form LK; `lib/client.ts` tidak membatasi kolom itu.
11. **Test lemah di tepi:** tidak ada test untuk route API, `crossref.ts`, PDF nyata, zip bomb, path traversal, dan `docx.test.ts` bisa lolos tanpa memeriksa apa pun.

## 7. Yang dicatat sebagai sudah baik

- Instruksi AI dibangun ulang di server dari struktur baku (`resolveSection`, `parseOutlineItem`); klien tidak bisa menyuntik instruksi atau mengubah bagian data menjadi bagian AI (diuji di `outline.test.ts`).
- Bagian LK yang tak terpetakan menjadi isi-sendiri (`manual`), bukan ditulis AI.
- Daftar pustaka dan sitasi dibuat kode; penanda ke sumber tanpa isi dibuang.
- Metadata Crossref yang diedit tangan otomatis kehilangan status terverifikasi (`SourceManager.tsx`).
- Telaah klinis tidak menebak: nilai ganda, trimester tidak terbaca, dan Hb kosong menghasilkan "belum bisa dicek"; selalu menampilkan daftar "belum dicek".
- Pemeriksa konsistensi hanya memeriksa data, tidak klinis, dan menandai data pasien LK yang muncul di LP/Jurnal.

## 8. Rekomendasi urutan

1. T01: tambah script `typecheck`, jalankan empat perintah, pastikan mock AI menutup semua jalur, dokumentasikan. Catat hasil nyata di dokumen ini.
2. T02 dan T03: verifikasi Tahap B dan C yang kodenya sudah ada.
3. T04: tutup temuan 4, 6, 7, 8 dan tambah provenance.
4. Putuskan nasib telaah klinis Lapis 1 (temuan 3) sebelum T14–T17.
5. T05 (ADR) sebelum menyentuh penyimpanan multi-kasus (T06).
