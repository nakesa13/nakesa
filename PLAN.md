# NAKESA — Analisis Produk & Rencana Pengembangan

Status: v3 — direvisi setelah review menyeluruh (folder proyek masih kosong, mulai dari nol)
Perubahan dari v2: tiering model AI demi biaya, catatan batas eksekusi serverless & backup, retensi data kasus, ketahanan proses generasi per bagian, beta tertutup pada Fase 1, metrik keberhasilan, bagian etika akademik, dan penandaan pertanyaan yang bersifat blokir.
Fokus saat ini: **Generator LP, LK, dan Reading Journal untuk asuhan kebidanan**, dengan tampilan admin/dashboard modern ala AdminLTE.
Prinsip: sederhana, aman, murah, mudah dirawat, bisa berkembang. Tidak ada microservice, tidak ada infrastruktur yang belum dibutuhkan.

Perubahan dari v1: (1) pilihan template UI, (2) struktur dokumen kebidanan dirinci, (3) urutan fase diubah agar generator didahulukan, (4) ada tahap intake template contoh dari Anda.

---

## 1. Analisis Produk

### Masalah yang diselesaikan
Mahasiswa kebidanan menghabiskan banyak waktu untuk tugas berformat baku: LP, LK, reading journal. Formatnya berulang, tetapi isinya menuntut akurasi klinis dan rujukan yang valid. Alat AI umum sering mengarang referensi dan data klinis, sehingga tidak aman dipakai untuk tugas akademik kesehatan.

### Pembeda NAKESA
1. **Referensi hanya dari sumber yang bisa diverifikasi.** AI tidak pernah menulis daftar pustaka sendiri.
2. **Data klinis tidak dikarang.** Isian yang tidak diberikan mahasiswa ditandai `[belum diisi]`.
3. **Hasil .docx rapi dan siap kumpul**, mengikuti format dari contoh template kampus.
4. **Sekaligus media belajar.** Setiap bagian dokumen punya panduan mengisi dan contoh hasil, bukan sekadar tombol "generate".
5. **Mahasiswa tetap penulis.** Ada pratinjau dan editor per bagian sebelum unduh.

### Pengguna
- Mahasiswa kebidanan (awal) → keperawatan, kedokteran, farmasi (nanti).
- Admin: verifikasi pembayaran, kelola materi, sumber, dan template.

### Risiko utama dan mitigasinya
| Risiko | Mitigasi |
|---|---|
| AI mengarang referensi / data klinis | Sitasi hanya via ID sumber dari database, divalidasi sebelum render (bagian 6) |
| Ringkasan jurnal tidak sesuai isi jurnal | Reading Journal diringkas dari teks PDF/abstrak yang benar-benar diunggah, bukan dari ingatan model |
| Data pasien nyata bocor (LK memakai kasus pasien) | Hanya inisial/kode, peringatan di form, tidak ada kolom nama lengkap/NIK/alamat |
| Template tiap kampus berbeda | Template berbasis data (JSON), admin bisa menambah varian tanpa ubah kode |
| Biaya AI membengkak | Kuota per paket, model kecil untuk chat, model menengah hanya untuk generator, pencatatan pemakaian |
| Bukti bayar palsu / dobel | Kode unik per transaksi, verifikasi manual, bukti di storage privat, log audit admin |
| Penyalahgunaan (kecurangan akademik) | Dokumen berstatus draf yang wajib ditinjau, disclaimer, data kasus diisi mahasiswa sendiri |

---

## 2. Keputusan Teknologi

| Lapisan | Pilihan | Alasan |
|---|---|---|
| App | **Next.js (App Router) + TypeScript**, satu monolit | Frontend + backend dalam satu repo, mudah dirawat sendiri |
| UI | **Tailwind CSS + shadcn/ui**, layout admin dibangun sendiri bergaya AdminLTE | Lihat bagian 3 |
| Database, Auth, Storage | **Supabase** (Postgres) | Auth siap pakai, Row Level Security, storage privat untuk bukti bayar, PDF jurnal, dan file docx |
| Generate Word | Pustaka **`docx`** (Node) di sisi server | Kontrol penuh atas format, tanpa layanan eksternal |
| Ekstrak teks PDF jurnal | Pustaka PDF di server (`unpdf`, alternatif `pdf-parse`) | Untuk Reading Journal; OCR tidak dibutuhkan di MVP |
| AI | **Claude API** via route server — model kecil untuk chat/validator, model menengah hanya untuk generator | Bahasa Indonesia baik, output terstruktur (JSON); tiering menjaga biaya |
| Hosting | Vercel (Pro bila sudah komersial) atau VPS kecil | Deploy mudah; plan gratis Vercel tidak untuk penggunaan komersial |
| Pembayaran | QRIS statis + unggah bukti + verifikasi manual | Sesuai kebutuhan tahap awal |
| Tes | Vitest (validator sitasi, builder docx), Playwright (alur utama) | Hanya di bagian yang berisiko |

Sengaja **tidak dipakai** di MVP: vector database, antrean job, microservice, payment gateway, state management berat. Pencarian materi memakai full-text search Postgres dulu.

> Catatan operasional: batas eksekusi fungsi serverless aman karena generasi dilakukan per bagian, bukan satu dokumen penuh sekaligus. Backup otomatis Supabase baru tersedia di plan berbayar — sebelum komersial, gunakan prosedur ekspor manual berkala.

> Catatan biaya: harga plan Vercel/Supabase/Claude perlu dicek ulang saat akan rilis karena bisa berubah.

---

## 3. Template Admin / UI

### Pilihan
AdminLTE asli berbasis Bootstrap + jQuery. Memakainya langsung di Next.js/React akan bentrok dengan Tailwind dan menambah kerumitan. Rekomendasi: **bangun layout bergaya AdminLTE dengan shadcn/ui + Tailwind**, yaitu sidebar kiri yang bisa dilipat, topbar, kartu statistik, tabel data, form bertahap (wizard), mode gelap. Tampilannya setara, tetapi satu sistem desain untuk halaman mahasiswa dan admin sehingga konsisten dan mudah dirawat.

Jika Anda tetap ingin tampilan persis AdminLTE (atau template sejenis seperti Tabler), beri tahu saya dan kita bahas konsekuensinya sebelum Fase 0.

### Kerangka tampilan
Satu layout bersama, menu berbeda menurut peran.

**Mahasiswa**
- Beranda (ringkasan, sisa kuota, dokumen terakhir)
- **Buat Dokumen**: LP · LK · Reading Journal
- Dokumen Saya
- **Belajar**: Bank Materi · Asisten AI · Referensi
- Langganan

**Admin**
- Dashboard (pengguna, pembayaran pending, dokumen dibuat)
- Pembayaran · Pengguna
- Template · Materi · Sumber/Referensi · Paket

### Prinsip "media pembelajaran"
- Form generator berbentuk **langkah bertahap** (wizard), tiap kolom punya teks bantu: apa yang harus ditulis dan kenapa.
- Setiap jenis dokumen punya halaman **Contoh Hasil** (kasus fiktif) berisi anotasi per bagian.
- Pratinjau dan editor per bagian sebelum unduh.
- Desain mobile-first; ramah layar kecil.

---

## 4. Arsitektur

```
Browser (mahasiswa / admin)
        │
   Next.js app
   ├─ halaman: landing, auth, dashboard, generator, belajar, /admin
   ├─ route server: /api/generate, /api/chat, /api/docx, /api/payments
   └─ lib: ai/, docx/, citations/, quota/, journal/
        │
   Supabase
   ├─ Auth (email + Google)
   ├─ Postgres + RLS
   └─ Storage privat: bukti-bayar/, jurnal/, dokumen/
        │
   Claude API
```

Struktur folder yang direncanakan:

```
nakesa/
  contoh-template/   # contoh LP/LK/RJ dari Anda (input untuk saya)
  src/
    app/             # (student), (admin), api/
    components/
    lib/
      ai/            # prompt, skema output, pemanggilan model
      citations/     # validator sitasi, builder daftar pustaka
      docx/          # builder dokumen LP / LK / RJ
      journal/       # ekstrak teks PDF jurnal
      quota/
      supabase/
    templates/       # definisi struktur dokumen (JSON/TS)
  supabase/migrations/
  tests/
  PLAN.md
```

---

## 5. Struktur Dokumen Kebidanan

Berikut **kerangka umum** yang lazim dipakai. Ini hanya titik awal; struktur final mengikuti contoh template yang Anda berikan.

### LP — Laporan Pendahuluan
1. Konsep dasar kasus (definisi, etiologi, patofisiologi/pathway, manifestasi klinis, pemeriksaan penunjang, penatalaksanaan, komplikasi)
2. Konsep asuhan kebidanan pada kasus tersebut (pengkajian, diagnosa, intervensi)
3. Daftar pustaka

### LK — Laporan Kasus
Asuhan kebidanan pada satu pasien, memakai manajemen 7 langkah Varney dan/atau SOAP:
pengkajian data subjektif & objektif → interpretasi data (diagnosa, masalah, kebutuhan) → diagnosa/masalah potensial → tindakan segera/kolaborasi → perencanaan → implementasi → evaluasi → pembahasan (kesenjangan teori dan praktik) → penutup → daftar pustaka.

Jenis asuhan sebagai pilihan awal form: kehamilan (ANC), persalinan (INC), nifas (PNC), bayi baru lahir/neonatus, bayi-balita, KB, ginekologi.

### Reading Journal
Identitas jurnal → latar belakang → tujuan → metode (desain, sampel, instrumen) → hasil → pembahasan → kesimpulan → kelebihan dan kekurangan → implikasi untuk praktik kebidanan → daftar pustaka.
Sumber: mahasiswa mengunggah PDF jurnal **atau** memasukkan DOI; ringkasan hanya boleh berasal dari teks jurnal tersebut.

### Mesin template
Setiap dokumen = daftar **bagian** (id, judul, panduan mengisi, kolom input, apakah perlu sitasi, instruksi AI). Disimpan sebagai data, sehingga varian kampus ditambah lewat admin.

---

## 6. Model Data (Postgres)

- `profiles` — id (= auth.users), nama, kampus, prodi, jenjang, role (`student` | `admin`)
- `plans` — nama, harga, durasi_hari, kuota_dokumen_bulanan, kuota_chat_harian
- `payments` — user_id, plan_id, nominal, kode_unik, bukti_path, status (`pending` | `approved` | `rejected`), catatan_admin, reviewed_by, reviewed_at
- `subscriptions` — user_id, plan_id, mulai, berakhir, payment_id
- `templates` — tipe (`LP` | `LK` | `RJ`), nama, kampus (nullable), jenis_asuhan (nullable), struktur (jsonb), aktif
- `documents` — user_id, template_id, tipe, judul, input (jsonb), konten (jsonb per bagian), status (`draft` | `final`), docx_path
- `journal_uploads` — user_id, file_path atau doi, teks_ekstrak, metadata (judul, penulis, tahun, jurnal)
- `sources` — tipe (buku / jurnal / pedoman), judul, penulis, tahun, penerbit, doi, url, terverifikasi (bool), ditambahkan_oleh
- `materials` — judul, topik, isi, source_id, terbit (bool)
- `chat_sessions`, `chat_messages`
- `usage_logs` — user_id, jenis, token_in, token_out, waktu
- `admin_audit_log` — admin_id, aksi, target, waktu

Keamanan data: RLS aktif di semua tabel. Mahasiswa hanya mengakses barisnya sendiri. Fungsi admin dicek di server. Bucket storage privat, akses lewat signed URL berumur pendek.

Retensi data: `documents` dan `journal_uploads` memuat data kasus/pasien. Sediakan tombol hapus mandiri untuk mahasiswa dan rencanakan penghapusan otomatis setelah masa tenggang (mis. 24 bulan) — diimplementasikan sebagai pekerjaan terjadwal mulai Fase 4.

---

## 7. Strategi AI yang Tidak Mengarang

**Alur generator (LP / LK / RJ):**
1. Mahasiswa mengisi form bertahap (kasus/topik, data pasien untuk LK, jurnal untuk RJ).
2. Server mengambil sumber relevan dari `sources`/`materials` (hanya yang terverifikasi).
3. Model dipanggil **per bagian**, output JSON terstruktur. Rujukan hanya boleh berupa penanda ID, misalnya `[S12]`.
4. **Validator**: setiap penanda harus ada di `sources`; yang tidak dikenal ditolak lalu bagian dibuat ulang atau ditandai.
5. **Daftar pustaka dibuat kode** dari metadata `sources`, bukan oleh model.
6. **Data klinis** (TTV, hasil lab, anamnesis, tindakan) **hanya dari input mahasiswa**. Kosong → `[belum diisi]`.
7. Pratinjau → edit → unduh .docx.

**Reading Journal:** teks jurnal diekstrak dari PDF yang diunggah. Setiap bagian ringkasan hanya dari teks itu; bila bagian (mis. instrumen) tidak ditemukan di teks, ditulis "tidak dijelaskan dalam jurnal", bukan ditebak.

**Ketahanan proses:** generasi berjalan per bagian dan hasil per bagian disimpan sementara; jika koneksi terputus, pengguna melanjutkan dari bagian yang belum selesai, tidak mengulang dari awal.

**Sumber referensi:**
- Admin menambah buku/pedoman/jurnal ke bank sumber.
- Mahasiswa bisa menambah jurnal lewat DOI; server memverifikasi ke Crossref/PubMed lalu menyimpan metadata resmi.
- Tidak ada sumber → bagian ditulis tanpa sitasi dengan catatan "perlu referensi", bukan dikarang.

**Asisten belajar (fase belakangan):** menjawab dari materi di bank, menampilkan sumber, dan jujur bila materi tidak ditemukan.

**Keamanan prompt:** input pengguna diperlakukan sebagai data, bukan instruksi; batasi panjang input; rate limit per pengguna.

---

## 8. Roadmap Bertahap (diurutkan ulang)

Setiap fase selesai dan diuji sebelum lanjut. Estimasi waktu kasar.

### Fase 0 — Intake template & fondasi (± 3–4 hari)
- **Anda memberi contoh template** LP, LK, Reading Journal (.docx) ke folder `contoh-template/`; saya menganalisis strukturnya dan membuat definisi template
- Inisialisasi Next.js + TypeScript + Tailwind + shadcn/ui
- Layout admin/dashboard (sidebar, topbar, kartu, tabel) sebagai kerangka seluruh halaman
- Supabase: migrasi awal, RLS, login, peran admin
- **Selesai bila:** bisa daftar/masuk, layout tampil konsisten di HP dan desktop, mahasiswa tidak bisa membuka /admin

### Fase 1 — Generator LP end-to-end (± 1–2 minggu)
- Mesin template + builder .docx dasar (gaya dokumen terpusat)
- Wizard LP → generate per bagian → validator sitasi → editor → unduh .docx
- Bank sumber minimal + tambah jurnal via DOI
- Halaman Contoh Hasil LP
- **Selesai bila:** satu LP lengkap dari form sampai .docx yang cocok dengan contoh kampus, daftar pustaka valid
- Uji beta tertutup dengan satu kohort mahasiswa kebidanan; kumpulkan umpan balik format, bahasa, dan kemudahan pengisian

### Fase 2 — Generator LK (± 1–2 minggu)
- Form data pasien terstruktur (Varney/SOAP), pilihan jenis asuhan, pembahasan teori vs praktik
- Aturan "data klinis hanya dari input" diuji khusus
- Halaman Contoh Hasil LK

### Fase 3 — Generator Reading Journal (± 1 minggu)
- Unggah PDF / DOI, ekstrak teks, ringkasan terstruktur
- Halaman Contoh Hasil Reading Journal

### Fase 4 — Akun, langganan, dan pembayaran (± 1–2 minggu)
- Paket, QRIS, unggah bukti, antrean verifikasi admin → aktivasi otomatis
- Pembatasan akses dan kuota di server
- Dashboard mahasiswa: riwayat dokumen, status paket

> Selama Fase 1–3, akses generator dibuka untuk akun uji supaya fokus pada kualitas dokumen. Jika Anda ingin pembayaran lebih dulu, urutan ini mudah ditukar.

### Fase 5 — Belajar & admin penuh
- Bank materi + asisten AI berbasis materi
- Admin: kelola pengguna, konten, template, paket; log audit; pemantauan biaya AI
- Kebijakan privasi, syarat layanan, cadangan database, pemeriksaan keamanan

### Fase 6+ — Ekspansi
- Keperawatan, kedokteran, farmasi (template + materi baru, mesin yang sama)
- Pembayaran otomatis bila volume membenarkan

---

## 9. Kualitas Dokumen Word
- Satu builder per tipe dokumen, gaya terpusat (font, spasi, margin, penomoran halaman, daftar isi)
- Default sementara: Times New Roman 12, spasi 1,5, margin 4-3-3-3 cm — **akan diganti mengikuti contoh template Anda**
- Tes otomatis: file valid, struktur heading benar, setiap sitasi punya entri daftar pustaka
- Uji manual membuka di Word dan LibreOffice tiap rilis

---

## 10. Yang Dibutuhkan dari Anda
1. **Contoh template LP, LK, Reading Journal (.docx)** → taruh di `C:\APP\nakesa\contoh-template\` (idealnya 2–3 kampus; beri nama jelas, mis. `LP_ANC_kampusA.docx`)
2. Konfirmasi pendekatan UI (bagian 3): shadcn/Tailwind bergaya AdminLTE, atau persis AdminLTE/Tabler
3. Standar rujukan: APA atau Vancouver
4. Rencana harga paket dan batas kuota (dibutuhkan di Fase 4)
5. Siapa yang menyiapkan materi dan sumber awal
6. Nama domain dan anggaran bulanan AI + hosting

Nomor 1 dan 3 bersifat **blokir** untuk Fase 0–1; nomor 2 menentukan tampilan; nomor 4–6 bisa dijawab sampai Fase 4.

---

## 11. Metrik Keberhasilan (MVP)

- Aktivasi: ≥70% akun uji berhasil membuat minimal satu dokumen
- Waktu hingga dokumen LP pertama selesai: <30 menit
- Kesesuaian format: .docx lolos uji manual terhadap contoh template kampus pada seluruh kasus uji
- Nol referensi palsu: validator sitasi menolak 100% penanda tak dikenal dalam tes otomatis
- Retensi beta: pengguna kembali membuat dokumen kedua dalam 14 hari

---

## 12. Etika Akademik

- Setiap keluaran berstatus **draf**, dengan penegasan bahwa mahasiswa wajib meninjau, memverifikasi, dan menyesuaikan dengan kasus nyata sebelum dikumpulkan.
- NAKESA membantu menyusun, bukan menggantikan pengkajian klinis; kebenaran data kasus tetap tanggung jawab akademik mahasiswa.
- Pernyataan ini tampil saat registrasi, di halaman generator, dan pada bagian akhir setiap dokumen yang dihasilkan.
