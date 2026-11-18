# NAKESA — versi uji (tanpa login)

Asisten akademik kebidanan: **LP**, **LK**, dan **Reading Journal** → file Word (.docx).
Rencana lengkap: `PLAN.md`.

## Menjalankan

```bash
npm install
cp .env.example .env.local     # lalu isi GROQ_API_KEY (atau ANTHROPIC_API_KEY)
npm run dev                    # http://localhost:3000
```

Tanpa API key, uji alur dengan teks contoh: `NAKESA_MOCK_AI=1 npm run dev`.

Perintah lain: `npm test` (tes unit), `npm run lint`, `npm run build`.

## Penyedia AI

Dipilih lewat `AI_PROVIDER` (`groq` atau `anthropic`). Paket gratis Groq berkuota kecil (token per menit dan permintaan per hari),
jadi sumber dikirim lebih pendek, bagian ditulis berurutan, dan permintaan diulang otomatis saat kena batas.
Satu dokumen bisa memakan beberapa menit. Untuk pemakaian banyak mahasiswa, gunakan paket berbayar.

## Yang sudah ada

- Layout bergaya AdminLTE (sidebar lipat, mode gelap, responsif HP)
- Wizard LP, LK, Reading Journal → tulis per bagian → edit → unduh .docx
- Referensi: ambil dari DOI (Crossref), isi manual, Pustaka Referensi
- Gaya rujukan APA atau Vancouver (Pengaturan)
- Draf tersimpan di peramban (localStorage), identitas sampul diisi sekali
- **Template kampus (Tahap A):** langkah pertama wizard. Unggah contoh dokumen .docx dari kampus; hasil dibuat di atas file itu
  (sampul/logo, font, ukuran, spasi, margin, header/footer, nomor halaman termasuk romawi, daftar isi). Tanpa template: format bawaan.

## Template kampus: cara kerja

- File .docx adalah paket XML. Sistem **tidak membuat dokumen dari nol**, melainkan membuka template, mempertahankan halaman depan,
  lalu mengganti hanya bagian isi (bab) dengan paragraf yang meniru format paragraf/judul contoh di template.
- Pembacaan otomatis (`src/lib/template/analyze.ts`): awal isi, daftar pustaka, daftar isi, kolom sampul, contoh judul/isi.
  Pengguna bisa mengoreksi di panel "Atur manual".
- Sampul: baris berlabel ("Nama : …") atau penanda `{{judul}} {{nama}} {{nim}} {{prodi}} {{kampus}} {{tahun}} {{pembimbing}}` diisi otomatis.
- Daftar isi: field otomatis; nomor halaman terisi saat dibuka di Word (pilih Ya bila Word menawarkan memperbarui field).
- Template disimpan di peramban (IndexedDB), dikirim ke server per permintaan, tidak disimpan di server. Batas 8 MB.
- Batasan: teks tetap di header/footer/halaman depan template (mis. Kata Pengantar contoh) ikut tersalin apa adanya; struktur bab
  masih mengikuti definisi LP/LK/RJ NAKESA (Tahap B akan membuat bab dinamis mengikuti template). Pratinjau persis (LibreOffice) menyusul.

## Cara sistem menjaga agar tidak mengarang

1. Sitasi hanya lewat penanda `[S#]` untuk sumber yang **isinya** dilampirkan; penanda lain dihapus server.
2. Daftar pustaka disusun kode dari metadata sumber (bukan ditulis AI).
3. LK: data klinis hanya dari isian; kolom kosong tertulis `[belum diisi]`. Angka klinis dalam analisis AI yang tidak ada di isian ditandai.
4. Reading Journal: ringkasan hanya dari teks jurnal; angka yang tidak ada di teks jurnal ditandai.
5. Bagian yang berisi data/analisis pasien diberi tanda "tinjau".

## Batasan versi ini

- **Belum ada login.** Data hanya di peramban pengguna. Siapa pun yang tahu alamat aplikasi bisa memakai kuota AI Anda,
  jadi **isi `ACCESS_CODE`** sebelum dipasang di internet. Batas permintaan per IP hanya di memori (satu server).
- Tanpa template unggahan, format bawaan (Times New Roman 12, spasi 1,5, margin 4-3-3-3, A4) dipakai. Struktur bab masih tetap (Tahap B: dinamis).
- Pembayaran, akun, admin, bank materi, asisten belajar: belum dibangun (lihat PLAN.md).

## Struktur

```
src/templates/   definisi bagian LP / LK / RJ (data, bukan kode)
src/lib/         ai, citations, case (pemeriksa), docx-builder, crossref, guard, templateStore
src/lib/template analyze (baca template), build (susun dokumen di atas template), mapping, xml, package
src/app/api/     generate, docx, doi, extract-pdf, template/analyze
src/components/  AppShell, Wizard, TemplateStep, SourceManager, JournalField
```
