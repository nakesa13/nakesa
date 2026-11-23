# NAKESA: Audit Baseline (T00)

Tanggal audit: 24 November 2026. Basis: kode di working tree setelah commit T09.
Metode: membaca kode sumber dan test. README dan PLAN tidak dijadikan acuan; bila berbeda dengan kode, kode yang benar.
Batas audit: tidak ada kode yang diubah, `npm test`/`lint`/`tsc`/`build` tidak dijalankan oleh audit ini, `.env.local` tidak dibuka.
Berkas yang dibaca baris per baris dan yang tidak ditandai di bagian 9.

Legenda status: **tested** = ada test otomatis yang mengunci perilakunya; **partial** = ada kodenya tetapi sebagian atau tanpa test; **missing** = belum ada.

---

## 1. Arsitektur

| Aspek | Kondisi |
|---|---|
| Framework | Next.js 16.4.6 (App Router, `cacheComponents` dan `partialPrefetching` aktif), React 19.3.0, TypeScript 5, Tailwind 4 (turbopack loader) |
| Pola | Aplikasi satu paket. Klien (wizard, localStorage) + route handler server yang stateless |
| Database | Tidak ada. Tidak ada Supabase/ORM di `package.json` |
| Auth | Tidak ada. Satu-satunya pagar: header `x-access-code` bila env `ACCESS_CODE` diisi |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) atau Groq lewat `fetch`. Mode uji `NAKESA_MOCK_AI=1` tanpa AI sungguhan |
| Dokumen | `docx` (buat dari nol), `pizzip` + `@xmldom/xmldom` (bangun di atas template kampus), `unpdf` (baca PDF) |
| Test | Vitest 5, `environment: "node"`, pola `src/**/*.test.ts`. Tidak ada jsdom, jadi komponen React tidak diuji |
| CI/CD | Tidak ada (`.github` tidak ada). Gate dijalankan manual |

Pembagian kode:

- `src/templates/`: definisi LP/LK/RJ sebagai data (langkah formulir, bagian dokumen, instruksi AI). `lk.ts` memuat langkah `anc` dan tipe field `serial` (T09).
- `src/lib/`: logika murni (tanpa React): `ai.ts` (prompt, Groq/Anthropic, mock), `case.ts` (penyusun bagian data, DATA KASUS, pemeriksa angka AI), `anc.ts` (T09), `lp.ts` (T08), `kasus.ts` (kasus bersama, opt-in), `consistency.ts`, `clinical/` (parse + review Hb/LiLA), `citations.ts`, `crossref.ts`, `extract.ts`, `outline.ts`, `docx-builder.ts`, `markup.ts`, `guard.ts`, `client.ts`, `useLocalState.ts`, `templateStore.ts`, `draft.ts`.
- `src/lib/template/`: `analyze.ts`, `build.ts`, `mapping.ts`, `package.ts`, `xml.ts`, `types.ts` (membaca dan mengisi template .docx).
- `src/components/`: `Wizard.tsx` (inti UI semua dokumen), `SerialField`, `JournalField`, `SourceManager`, `TemplateStep`, `OutlineStep`, `KasusPage`, `LibraryPage`, `SettingsPage`, `AppShell`, `DraftHint`, `Icon`.

Alur utama: pengguna mengisi wizard (draf di localStorage) -> klien memanggil `/api/generate` per bagian -> server membangun prompt dari `DATA KASUS` + sumber berisi, memanggil AI, membuang penanda `[S#]` yang tidak sah, mengembalikan teks + peringatan -> pengguna meninjau -> `/api/docx` menyusun .docx (sitasi dan daftar pustaka disusun kode).

## 2. Halaman dan route API

Halaman: `/` (beranda), `/lp`, `/lk`, `/rj` (ketiganya memakai `Wizard`), `/kasus` (kasus bersama, konsistensi, telaah klinis), `/sumber` (Pustaka Referensi), `/pengaturan`.

Route API (semua `POST`, semua lewat `guard()`):

| Route | Batas/jam per IP | Fungsi | Validasi utama | Test |
|---|---|---|---|---|
| `/api/generate` | 200 (default) | Tulis satu bagian AI atau susun bagian data | `docType`, `sectionId`/`item` (diparse ulang di server), `isInput` (maks 120 kolom, 80 rb karakter), `parseSources` (maks 40 sumber); RJ: kolom pasien dibuang, teks jurnal minimal 500 karakter | **tested** langsung lewat `POST` (`standalone-generate.test.ts`) |
| `/api/docx` | 100 | Susun .docx, opsional di atas template (multipart) | Maks 60 bagian, panjang teks dipotong, template maks 8 MB + magic `PK` + `parseMapping` | builder **tested**; route **tidak** diuji |
| `/api/doi` | 60 | Metadata Crossref | Regex DOI, host tetap `api.crossref.org`, timeout 12 dtk | **tidak ada test** (`crossref.ts` tanpa test) |
| `/api/extract-source` | 60 | Baca teks PDF/.docx/.txt unggahan | Maks 10 MB, deteksi tipe dari isi, teks minimal 200 karakter, potong 60 rb karakter | logika (`extract.ts`) **tested** tanpa PDF; route **tidak** diuji |
| `/api/extract-pdf` | 60 | Baca teks PDF | Maks 10 MB, magic `%PDF-` | **tidak ada test**. **Tidak dipanggil klien mana pun** (kode mati, lihat risiko R7) |
| `/api/template/analyze` | 60 | Analisis template .docx | Maks 8 MB, ekstensi `.docx`, magic `PK` | analisis **tested** dengan 3 fixture; route **tidak** diuji |

`guard.ts`: bila `ACCESS_CODE` terisi, header `x-access-code` harus sama persis. Pembatas laju: `Map` di memori proses, kunci IP dari `x-forwarded-for` (elemen pertama), default 200/jam (`RATE_LIMIT_PER_HOUR`).

## 3. Penyimpanan

Server tidak menyimpan apa pun (file diproses di memori; `Cache-Control: no-store` pada respons berisi data).

Peramban:

| Penyimpanan | Kunci | Isi |
|---|---|---|
| localStorage | `nakesa.settings` | Identitas penyusun, gaya rujukan, **`accessCode` dalam teks biasa** |
| localStorage | `nakesa.draft.LP` / `.LK` / `.RJ` | `Draft`: `input`, `sources`, `texts`, `step`, `outline` |
| localStorage | `nakesa.case` | Kasus bersama: `jenis_asuhan`, `kasus`, `linked` per dokumen |
| localStorage | `nakesa.library` | Pustaka Referensi (daftar `Source`) |
| localStorage | `nakesa.theme` | Terang/gelap |
| IndexedDB | db `nakesa`, store `templates`, kunci = jenis dokumen | Template kampus: nama, ukuran, byte file, analisis, mapping, `savedAt` |

Catatan: tidak ada versi skema, migrasi, atau pemilik data. Satu "ruang kerja" per peramban. `useLocalState` memakai nilai awal bila JSON rusak, dan tulisan berikutnya menimpa data rusak itu.

## 4. Variabel lingkungan (hanya nama)

`AI_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_MODEL_LONG`, `GROQ_JOURNAL_CHARS`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ACCESS_CODE`, `RATE_LIMIT_PER_HOUR`, `CROSSREF_MAILTO`, `NAKESA_MOCK_AI`. Khusus test: `NAKESA_OUT` (menulis berkas contoh dari `template.test.ts`). Tidak ada validasi env saat start.

## 5. Test

14 berkas di `src/lib/__tests__/` (+ `fixtures.ts`):

| Berkas | Cakupan |
|---|---|
| `anc.test.ts` | T09: waktu, serial tidak saling menimpa, `[belum diisi]`, anti-fabrication, data pasien tidak ke RJ |
| `case.test.ts` | Penyusun bagian data, angka klinis/angka jurnal tak berdukungan |
| `citations.test.ts` | Penanda, sanitasi, APA/Vancouver, daftar pustaka |
| `clinical.test.ts` | Pembaca Hb/LiLA/trimester, klasifikasi Hb, `reviewClinical` |
| `consistency.test.ts` | Kasus bersama dan `checkConsistency` |
| `docx.test.ts` | Builder .docx (isi hanya diperiksa bila `pandoc` terpasang, lihat R8) |
| `extract.test.ts` | .docx, .txt, pemotongan, tipe palsu, .docx rusak |
| `groq.test.ts` | Klien Groq (fetch di-stub), pemilihan penyedia/model |
| `lp.test.ts` | T08 |
| `outline.test.ts` | Pembacaan struktur template, klasifikasi, keamanan butir dari klien |
| `standalone.test.ts` | T07: tiga generator mandiri, opt-in, tanpa data pasien ke RJ |
| `standalone-generate.test.ts` | Route `/api/generate` dengan mock AI (T07/T08/T09) |
| `template.test.ts` | Template bergaya Word, format langsung, placeholder, karakter kontrol, entri folder ZIP |

Semua test berjalan tanpa API key (AI di-mock atau `fetch` di-stub). Tidak ada: test komponen/UI, test E2E, test route `docx`/`doi`/`extract-*`/`template/analyze`, test PDF nyata (tidak ada fixture PDF), test jalur Anthropic.

Hasil `npm test`/`lint`/`tsc`/`build` terakhir: dilaporkan pengguna hijau setelah T09; tidak diverifikasi ulang oleh audit ini.

## 6. Status fitur terhadap peta tugas

| Tugas | Fitur | Status | Lokasi | Catatan |
|---|---|---|---|---|
| T01 | Test gate tanpa API key | **partial** | `vitest.config.mts`, `NAKESA_MOCK_AI`, `__tests__/` | Berjalan tanpa key. Test inti belum lengkap (lihat bagian 5). README mendokumentasikan perintahnya |
| T02 | Outline dinamis | **partial** | `lib/outline.ts`, `OutlineStep.tsx`, `outline.test.ts` | Heading Word, pola BAB/huruf/angka, bertingkat, batas 60: tested. **Celah**: hanya LK zona "kasus" yang tak terpetakan menjadi *manual*; judul asing di zona lain (dan di LP/RJ) tetap **ditulis AI** (`genericSection`), bertentangan dengan aturan T02 |
| T03 | Kasus bersama dan consistency | **partial** | `lib/consistency.ts`, `lib/kasus.ts`, `KasusPage.tsx` | Consistency tested. Ekstraksi: .docx/.txt/tipe palsu/pendek/panjang tested; **PDF tidak diuji**. `PATIENT_FIELDS` di `consistency.ts` belum memuat kolom ANC |
| T04 | Impor sumber URL, provenance | **missing** | - | Tidak ada impor URL. Hanya DOI ke host tetap (Crossref). `url` di `Source` hanya metadata. Provenance hanya `origin` + `verified`. DOI di unggahan langsung dipasangkan ke isi tanpa cek kecocokan |
| T05 | ADR workspace/case/document | **missing** | - | Tidak ada `docs/architecture/` |
| T06 | Multi-workspace lokal | **missing** | - | Satu ruang kerja per peramban, kunci tetap |
| T07 | Tiga generator mandiri | **tested** | `lib/kasus.ts`, `Wizard.tsx` | Reuse opt-in dengan konfirmasi; RJ membuang kolom pasien di klien dan server |
| T08 | LP standalone | **tested** | `lib/lp.ts`, `templates/lp.ts` | Tanda `[perlu referensi]` oleh kode; resume per subbab |
| T09 | LK ANC terstruktur | **tested** | `lib/anc.ts`, `SerialField.tsx`, `templates/lk.ts` | 12 kolom + serial bertimestamp; `[belum diisi]`; angka dan tanggal karangan ditandai |
| T10 | Reading Journal | **partial** | `templates/rj.ts`, `case.ts` (`findUnsupportedAny`), `JournalField.tsx` | Ringkasan dari teks artikel, angka asing ditandai, PDF scan ditolak dengan pesan. Belum: test DOI mismatch, penandaan eksplisit "tidak dilaporkan" di semua bagian, test PDF scan |
| T11 | Template engine | **partial** | `lib/template/*`, `TemplateStep.tsx`, `templateStore.ts` | Tanpa hardcode kampus (default A4, TNR 12, margin 4-3-3-3 hanya bila tanpa template); koreksi manual ada; mapping tersimpan di IndexedDB tetapi **tanpa `templateId`**. Penolakan zip bomb bergantung pada properti internal pizzip (R5); path traversal tidak diperiksa; tidak ada test berkas berbahaya |
| T12 | Export DOCX/PDF | **partial** | `docx-builder.ts`, `template/build.ts`, `/api/docx` | DOCX dengan sitasi + pustaka dari kode. **PDF tidak ada**, pratinjau berlabel "perkiraan" tidak ada, isi DOCX hanya diperiksa bila pandoc ada |
| T13 | Reference manager | **partial** | `citations.ts`, `SourceManager.tsx`, `crossref.ts` | Sitasi hanya ke ID yang ada, bibliografi dari kode: tested. Belum: status sumber bertingkat, status turun saat diubah (hanya `verified` -> false saat metadata diedit di UI, tanpa test), test DOI mismatch/duplikat/yatim |
| T14 | Academic Reviewer | **missing** | - | `consistency.ts` bukan reviewer akademik (tidak menilai bahasa/struktur/kelengkapan isi) |
| T15 | Data Validator ANC | **partial** | `lib/clinical/` | Ada pembaca Hb/LiLA/trimester dan aturan ber-id + `basis`, tested. **Belum ada**: validasi tanggal/satuan/kronologi/HPHT-TP; kolom ANC terstruktur dan serial **tidak dibaca** oleh `reviewClinical`. Ambang klinis (WHO 2024) tertanam di kode tanpa alur approval (R9) |
| T16 | Bank pedoman | **missing** | - | Acuan hanya string `BASIS_*` di kode |
| T17 | Clinical Reviewer ANC | **partial** | `clinical/review.ts`, `KasusPage.tsx` | Hanya lapis aturan deterministik, advisory, tidak menyatakan diagnosis benar. Tanpa lapis LLM, tanpa kutipan pedoman approved, tanpa output JSON bukti + halaman, tanpa test adversarial |
| T18 | Critical Appraisal | **missing** | - | |
| T19 | AI safety | **partial** | `ai.ts` (`SYSTEM`), `citations.ts`, `guard.ts` | Aturan "isi dalam tag = data", `[S#]` palsu dibuang server, batas ukuran input. Belum: skema JSON, timeout Anthropic, test prompt injection, perlindungan tag penutup (R4), kebijakan log data pasien |
| T20 | Evaluasi reviewer | **missing** | - | |
| T21-T26 | Supabase, auth/role, RLS, cloud, kuota, admin | **missing** | - | Tidak ada dependensi maupun kode. Kuota = `Map` memori |
| T27 | Billing | **missing** | - | Opsional; model bisnis belum diputuskan di kode/dokumen yang saya baca |
| T28 | Privasi dan hapus data | **partial** | `templates/lk.ts` (`PRIVASI`), `SettingsPage.tsx` | Hanya teks bantuan "pakai inisial". Tidak ada penegakan, export, retensi, atau dokumen privasi/terms. Hapus draf/pustaka ada; tidak menghapus `nakesa.case` dan template IndexedDB |
| T29-T32 | CI, E2E, hardening, monitoring, staging | **missing** | - | Tidak ada workflow, Playwright, logging terstruktur, atau pemisahan env |
| T33-T37 | Beta, remediasi, go/no-go, launch, pasca-launch | **missing** | - | |

## 7. Daftar risiko (urut kasar menurut dampak)

- **R1. Akses terbuka bila `ACCESS_CODE` kosong.** Semua API publik; siapa pun bisa memakai kuota AI. `ACCESS_CODE` dibandingkan dengan `!==` (bukan perbandingan waktu-konstan) dan disimpan sebagai teks biasa di localStorage.
- **R2. Pembatas laju lemah.** `Map` di memori (hilang saat restart, tidak dibagi antar instance) dan IP dari `x-forwarded-for` yang bisa dipalsukan bila tidak di belakang proxy tepercaya.
- **R3. Data hanya di peramban.** Tanpa cadangan atau versi; JSON rusak ditimpa saat tulis berikutnya; tidak ada migrasi skema.
- **R4. Injeksi lewat tag penutup.** Isian atau isi sumber yang memuat `</data_kasus>`, `</isi_sumber>`, atau `</topik>` tidak dinetralkan sebelum masuk prompt (`ai.ts`). Berlaku juga untuk catatan/nilai pengukuran serial.
- **R5. Pertahanan zip bomb tidak merata.** `template/package.ts` menjumlah `_data.uncompressedSize` (properti internal pizzip, tidak dijamin ada; bila tak ada, jumlahnya 0 dan pemeriksaan tak berlaku). `extract.ts` (`docxToText`) baru membatasi panjang XML setelah seluruhnya didekompresi. Tidak ada pembatasan jumlah entri atau pemeriksaan path traversal. Tidak ada test berkas berbahaya.
- **R6. DOI di unggahan tidak diverifikasi terhadap isi.** `SourceManager` memasangkan metadata Crossref dari DOI pertama di 4.000 karakter awal ke isi berkas tanpa memeriksa kecocokan (jurnal yang mengutip DOI lain di halaman depan bisa tertukar).
- **R7. Route `/api/extract-pdf` tidak dipakai** (klien memakai `/api/extract-source`). Menambah permukaan serangan tanpa manfaat; belum ada test.
- **R8. Test yang bisa lolos diam-diam.** `docx.test.ts` keluar tanpa asersi isi bila `pandoc` tidak terpasang.
- **R9. Ambang klinis tertanam di kode** (`clinical/review.ts`: Hb WHO 2024, LiLA 23,5 cm) tanpa alur approval pedoman. Bertentangan dengan arah T15/T16 ("tanpa ambang klinis sebelum pedoman approved").
- **R10. Folder `debug/` berisi dua berkas .docx** di akar repo dan tidak ada di `.gitignore`. Belum dibuka; perlu dicek apakah ter-track dan apakah memuat data nyata.
- **R11. Dokumentasi usang.** `README.md` masih menyebut struktur bab tetap ("Tahap B menyusul") dan daftar route tanpa `extract-source`; jangan dipakai sebagai acuan.
- **R12. Penghapusan data tidak lengkap.** "Hapus semua draf" tidak menghapus `nakesa.case` maupun template di IndexedDB (template bisa memuat data pribadi dari contoh kampus).
- **R13. Celah T02.** Bagian yang tak terpetakan di luar zona kasus LK ditulis AI, bukan input manual.

## 8. Rekomendasi urutan (tanpa mengubah rencana)

1. T01: tutup celah test route (`docx`, `doi`, `extract-source`, `template/analyze`), tambah fixture PDF, jadikan pandoc tidak mengikat.
2. T02 dan T03: perbaiki R13, tambah ANC ke `PATIENT_FIELDS` konsistensi, uji PDF.
3. T04 dan T11: tutup R5 dan R6 dengan test berkas berbahaya; hapus atau uji `/api/extract-pdf` (R7).
4. T19: netralkan tag penutup (R4) dengan test injeksi.
5. T05 sebelum T06 dan seluruh fase SaaS.

## 9. Cakupan pembacaan audit

Dibaca penuh: `package.json`, `vitest.config.mts`, `next.config.ts`, `.env.example`, `.gitignore`, `README.md`, seluruh route API, `src/templates/*`, `src/lib/{ai,anc,case,citations,client,consistency,crossref,docx-builder,draft,extract,guard,kasus,lp,markup,outline,templateStore,useLocalState}.ts`, `src/lib/clinical/*`, `src/lib/template/{mapping,package,types,xml}.ts`, seluruh berkas test kecuali yang disebut di bawah, komponen `Wizard`, `SerialField`, `JournalField`, `SourceManager`, `TemplateStep`, `OutlineStep`, `KasusPage`, `SettingsPage`, `LibraryPage`, `AppShell`, `DraftHint`, `app/layout.tsx`, `app/page.tsx`.

Tidak dibaca baris per baris: `src/lib/template/analyze.ts`, `src/lib/template/build.ts` (perilakunya dinilai dari `template.test.ts` dan README), `Icon.tsx`, `globals.css`, `PLAN.md`, `PLAN-UPDATE.md`, isi `debug/`, `.env.local`. Jumlah test dan hasil gate tidak dihitung ulang.
