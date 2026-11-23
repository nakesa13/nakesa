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
| `routes.test.ts` | Route `/api/doi`, `/api/extract-source` (termasuk PDF berteks, PDF tanpa teks, tipe palsu, ukuran), `/api/template/analyze`, `/api/docx` (JSON dan multipart dengan template) |
| `docx.test.ts` | Builder .docx |
| lainnya | Lihat `docs/audit/BASELINE.md` bagian 5 |

Catatan:
- PDF di `routes.test.ts` dibuat oleh kode (`makePdf`), tanpa berkas biner.
- Isi .docx di `routes.test.ts` diperiksa dengan `pizzip`, tidak butuh `pandoc`.
- Pembatas laju memakai `Map` tingkat modul. Test memakai IP unik per permintaan agar tidak saling memengaruhi.

## Temuan yang dikunci test tetapi belum diperbaiki

- `template/xml.ts` `parseXml`: XML rusak di `word/document.xml` melempar `ParseError` fatal dari xmldom yang lolos dari `onError`. Route `/api/template/analyze` membalas **500**, seharusnya **422**. Test hanya mengunci bahwa berkas ditolak (status >= 400). Perbaikan dan test regresi masuk T11.
- `guard.ts`: hitungan laju dibagi antar route (satu bucket per IP). Dicatat untuk T25.

## Belum tercakup

Test komponen/UI, E2E, jalur Anthropic, PDF scan sungguhan (hanya PDF tanpa lapisan teks sintetis), dan `/api/extract-pdf` (route tidak dipakai klien, lihat R7 di BASELINE).
