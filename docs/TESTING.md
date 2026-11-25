# NAKESA: Test gate (T01)

Semua test berjalan lokal **tanpa API key dan tanpa jaringan**.

## Perintah gate

```
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## Cara test dipagari

- `vitest.config.mts` memuat `src/test/setup.ts` sebelum setiap berkas test.
- `setup.ts` menghapus env AI/akses (`GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `ACCESS_CODE`, `NAKESA_MOCK_AI`, dst.), jadi hasil test tidak bergantung pada mesin pengembang.
- `setup.ts` mengganti `fetch` global dengan penolak. Test yang butuh jaringan harus men-stub sendiri (`vi.stubGlobal("fetch", ...)`) dan memanggil `vi.unstubAllGlobals()` di `afterEach`.
- AI diuji lewat `NAKESA_MOCK_AI=1` (lihat `standalone-generate.test.ts`) atau dengan stub `fetch` (`groq.test.ts`).
- Jangan menaruh key sungguhan di test. Data di fixture bersifat fiktif.

## Cakupan

| Berkas | Cakupan |
|---|---|
| `guard.test.ts` | Kode akses, batas laju per IP, `isInput`, `parseSources` |
| `crossref.test.ts` | Normalisasi DOI, `lookupDoi` dengan Crossref di-stub |
| `netguard.test.ts` | T04: pagar SSRF murni (IPv4/IPv6 privat, metadata cloud, bentuk IP aneh, skema, kredensial, port) |
| `urlimport.test.ts` | T04: `fetchPublicUrl`/`importUrlSource` dengan DNS dan transport tiruan (DNS rebinding, pengalihan, batas ukuran, timeout, tipe palsu, HTML patologis) |
| `urlimport-transport.test.ts` | T04: transport `node:http` nyata ke server lokal (IP di-pin, header Host asli), loopback tidak pernah dihubungi, entitas HTML ekstrem |
| `import-url-route.test.ts` | T04: route `/api/import-url` (input berbahaya, kode akses, batas 30/jam, pemetaan galat, galat tak terduga tidak bocor) |
| `provenance.test.ts` | T04: `doiContentCheck` (DOI sah != isi cocok, batas 80%/50%), `parseProvenance` dari klien tak tepercaya, integritas ukuran+sha256 PDF |
| `route-provenance.test.ts` | T04: provenance yang dicatat `/api/extract-source` (nama berkas dibersihkan, ukuran, sha256) dan `/api/doi` (metode `doi`, hanya Crossref) |
| `routes.test.ts` | Route `/api/doi`, `/api/extract-source` (termasuk PDF berteks, PDF tanpa teks, tipe palsu, ukuran), `/api/template/analyze`, `/api/docx` (JSON dan multipart dengan template) |
| `docx.test.ts` | Builder .docx |
| `journal.test.ts` | T10: Reading Journal: teks parsial, DOI tidak cocok, angka statistik, nama penulis, ringkasan vs telaah kritis, "tidak dilaporkan" |
| `journal-extract.test.ts` | T10: PDF yang hanya sebagian terbaca ditandai (unpdf ditiru) |
| `template-safety.test.ts` | T11: zip bomb, path traversal, banyak entri, makro, DOCTYPE/ENTITY, XML rusak = 422, peringatan elemen tak dikenal, tautan template luar dibuang, `mappingIssues`, id/versi/pemetaan template (`ref.ts`) |
| `template-structure.test.ts` | T11/T12: hasil mengisi template asli: urutan heading dan nama style, styles/header/footer/media disalin apa adanya, margin dan penomoran per bagian, TOC field, daftar pustaka di posisi template, gaya sitasi terdeteksi dan bisa dikoreksi, "perlu diisi" tanpa sumber, peringatan elemen yang dibuang |
| `reviewer.test.ts` | T14: Academic Reviewer: tiap aturan (struktur, kelengkapan, bahasa, sitasi) diuji positif dan negatif, tiap temuan punya lokasi + alasan + saran, tanpa skor/label kelayakan/perbaikan otomatis, murni dan deterministik, dokumen rapi = nol temuan, ketahanan terhadap teks patologis (regresi regex kuadratik) |
| `ancvalidator.test.ts` | T15: Data Validator ANC: tiap aturan di `REGISTRY` punya pemicu (tidak ada aturan mati), id unik + sumber, batas tanggal (kabisat, rentang tahun 1990/2100, ambigu), HPHT/TP (tiga hitungan, akhir bulan, kabisat), toleransi usia kehamilan 7 vs 8 hari, G = P+A+1, satuan, "hari ini" +/- 1 hari, pengukuran serial; nilai klinis ekstrem tidak menghasilkan temuan (tanpa ambang sebelum T16); pesan tanpa kata penilaian klinis; `evaluated`/`notEvaluated` jujur; murni dan tidak mengubah isian |
| lainnya | Lihat `docs/audit/BASELINE.md` bagian 5 |

Catatan:
- PDF di `routes.test.ts` dibuat oleh kode (`makePdf`), tanpa berkas biner.
- Isi .docx di `routes.test.ts` diperiksa dengan `pizzip`, tidak butuh `pandoc`.
- Pembatas laju memakai `Map` tingkat modul. Test memakai IP unik per permintaan agar tidak saling memengaruhi.
- `pdf-fixture.ts` (T04) berisi `makePdf`/`wrapLines`; salinan `makePdf` di `routes.test.ts` dibiarkan agar berkas T01 tidak berubah.
- pdf.js memindahkan (detach) buffer yang diberikan padanya. `extract.ts` memberinya salinan (`bytes.slice()`), jika tidak, provenance PDF (`bytes`, `sha256`) tercatat dari buffer kosong. Dikunci oleh `provenance.test.ts`.

## Temuan yang dikunci test tetapi belum diperbaiki

- ~~`template/xml.ts` `parseXml`: XML rusak ... membalas 500~~ **Diperbaiki di T11**: `parseXml` menangkap `ParseError` fatal dan melempar `TemplateError`, jadi route membalas 422. Dikunci oleh `template-safety.test.ts`. Test lama di `routes.test.ts` (status >= 400) tetap lulus.
- `guard.ts`: hitungan laju dibagi antar route (satu bucket per IP). Dicatat untuk T25.

## Belum tercakup

Test komponen/UI, E2E, jalur Anthropic, PDF scan sungguhan (hanya PDF tanpa lapisan teks sintetis), dan `/api/extract-pdf` (route tidak dipakai klien, lihat R7 di BASELINE).
