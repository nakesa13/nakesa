# ADR: Workspace, Case, Document, Version, Source, Template

- **Status:** DIUSULKAN (T05). Perlu ditinjau dan disetujui manusia sebelum T06 dikerjakan. Bagian 13 memuat pertanyaan yang butuh keputusan Anda.
- **Tanggal:** 24 November 2026
- **Tugas terkait:** T05 (ADR ini), T06 (implementasi lokal), T11 (template), T13 (reference manager), T21 s.d. T24 (cloud), T28 (privasi).
- **Dasar fakta:** kode di working tree setelah commit T04. Bila berbeda dengan `PLAN.md` atau `README.md`, kode yang benar.

---

## 1. Konteks

Kondisi sekarang (dari kode, bukan dari rencana):

| Aspek | Kondisi | Sumber |
|---|---|---|
| Satuan data | Satu draf per jenis dokumen: `nakesa.draft.LP`, `.LK`, `.RJ`. Tidak bisa punya dua LK | `Wizard.tsx`, `client.ts` |
| Isi draf | `input`, `sources` (salinan penuh `Source` termasuk isi hingga 80 rb karakter), `texts`, `step`, `outline` | `draft.ts` |
| Kasus bersama | Satu objek `nakesa.case` (`jenis_asuhan`, `kasus`, `linked`). Tautan per **jenis dokumen**, bukan per dokumen | `kasus.ts` |
| Pustaka | `nakesa.library`: daftar `Source` dengan id `S1...` sendiri, terpisah dari id di draf | `LibraryPage.tsx` |
| Template | IndexedDB `nakesa` / store `templates`, kunci = jenis dokumen. Satu template per jenis, tanpa id | `templateStore.ts` |
| Pengaturan | `nakesa.settings`: identitas, gaya rujukan, dan **`accessCode` dalam teks biasa** dalam satu objek | `client.ts` |
| Versi | Tidak ada. "Mulai baru" menimpa draf. Menghapus template mengosongkan `outline` dan teks dinamis tanpa cadangan | `Wizard.tsx` |
| Skema | Tidak ada nomor versi skema. JSON rusak diganti nilai awal, lalu ditimpa saat tulis berikutnya | `useLocalState.ts` |
| Pemilik | Tidak ada. Satu ruang kerja tersirat per peramban | `BASELINE.md` bagian 3 |
| Server | Stateless. Klien mengirim payload lengkap (`input`, `sources`) ke `/api/generate` dan `/api/docx`. `parseSources` mewajibkan id `^S\d{1,3}$` dan maksimal 40 sumber | `guard.ts` |

Masalah yang harus diselesaikan model baru:

1. Mahasiswa memegang banyak kasus dan banyak dokumen (mis. dua LK untuk dua pasien) dan butuh lebih dari satu ruang kerja (T06).
2. LP, LK, dan Reading Journal harus tetap bisa dimulai sendiri-sendiri (T07). Tautan antar dokumen bersifat pilihan.
3. Riwayat versi dan pemulihan (T24) belum punya tempat.
4. Fase SaaS (T21 s.d. T26) butuh pemilik data pada setiap baris, tanpa menulis ulang logika dokumen.
5. localStorage berbatas sekitar 5 MB. Satu draf dengan 40 sumber berisi bisa mendekati itu sendirian.

## 2. Keputusan ringkas

| # | Keputusan |
|---|---|
| D1 | Enam entitas: **Workspace, Case, Document, Version, Source, Template**, ditambah **Profile** (identitas pengguna) di luar workspace. |
| D2 | **Document** adalah satuan kerja. Ada tiga jenis (`LP`, `LK`, `RJ`), tiap jenis independen. Satu workspace boleh punya banyak dokumen dari jenis yang sama. |
| D3 | **Case** adalah entitas opsional yang hanya memuat metadata topik (`jenis_asuhan`, `kasus`). Case **tidak pernah** memuat data pasien. Data pasien hanya ada di Document LK. |
| D4 | Tautan Case-Document bersifat opsional, **per dokumen**, lewat `Document.caseId` yang boleh `null`, dengan konfirmasi pratinjau (perilaku `kasus.ts` dipertahankan). |
| D5 | **Source** milik workspace (satu salinan, id stabil). Dokumen merujuknya lewat `citeKey` lokal (`S1`, `S2`, ...) yang tetap menjadi penanda `[S#]` di teks dan id yang dikirim ke server. |
| D6 | **Template** milik workspace, punya id, dan dipilih per dokumen lewat `Document.templateId` (boleh `null` = format bawaan NAKESA). |
| D7 | **Version** adalah snapshot tak berubah dari isi dokumen. Dokumen punya satu keadaan kerja (`head`) yang berubah, dan daftar Version. |
| D8 | Semua id adalah UUID v4 yang dibuat di klien, dan id yang sama dibawa ke cloud. Setiap baris privat membawa `workspaceId` dan `ownerId`. |
| D9 | Penyimpanan lokal pindah ke **IndexedDB database baru `nakesa-v2`** di balik antarmuka repository. Data lama (`nakesa.*` dan IndexedDB `nakesa`) **tidak diubah dan tidak dihapus** oleh migrasi. |
| D10 | Server tetap stateless dan menerima payload yang sudah di-resolve klien (seperti sekarang). Kontrak API `/api/*` tidak berubah oleh ADR ini. |

## 3. Model data

Notasi: `?` = boleh kosong. Semua entitas membawa `id` (UUID), `createdAt`, `updatedAt` (ISO 8601 UTC), dan `rev` (bilangan bulat naik 1 setiap tulis, untuk mendeteksi tulis yang bertabrakan).

### 3.1 Profile (tingkat pengguna, bukan workspace)

| Field | Keterangan |
|---|---|
| `ownerId` | Lokal: konstanta `"local"`. Cloud: `auth.users.id` |
| `identity` | `nama`, `nim`, `prodi`, `kampus`, `pembimbing`, `tahun` (sekarang di `Settings`) |

`accessCode` **bukan** bagian Profile maupun workspace. Ia tetap rahasia perangkat (kunci terpisah `nakesa.device`), tidak ikut ekspor, tidak ikut sinkronisasi, dan tidak boleh masuk Version. Ini juga memisahkan rahasia dari data yang nanti bisa diekspor (lihat T28, R1 di `BASELINE.md`).

### 3.2 Workspace

| Field | Keterangan |
|---|---|
| `ownerId` | Pemilik tunggal |
| `name` | mis. "Praktik ANC Semester 5" |
| `citeStyle` | `APA` atau `Vancouver` (gaya rujukan mengikuti pedoman kampus, jadi melekat pada workspace) |
| `defaultTemplateIds` | `{ LP?, LK?, RJ? }`, template bawaan untuk dokumen baru di workspace ini |
| `archivedAt?` | Arsip (lihat bagian 9) |

Aturan: tepat satu workspace otomatis dibuat bila belum ada, supaya pengguna yang tidak peduli konsep ini tidak melihat langkah tambahan (invarian I1).

### 3.3 Case (opsional)

| Field | Keterangan |
|---|---|
| `workspaceId`, `ownerId` | |
| `jenisAsuhan?`, `kasus?` | Sama dengan `SharedCase` sekarang (`jenis_asuhan`, `kasus`) |

Larangan (invarian I6): Case tidak menyimpan nama, inisial, umur, tanggal, tempat, hasil pemeriksaan, atau kolom apa pun dari `PATIENT_FIELD_IDS`. Perluasan field Case wajib melewati ADR baru dan tinjauan privasi (T28).

### 3.4 Document

| Field | Keterangan |
|---|---|
| `workspaceId`, `ownerId` | |
| `type` | `LP` \| `LK` \| `RJ` (tidak bisa diubah setelah dibuat) |
| `title` | Judul tampilan. Turunan dari `judul`, `j_title`, atau `lpTitleFor(...)` bila kosong |
| `caseId?` | Tautan opsional ke Case di workspace yang sama |
| `templateId?` | Template di workspace yang sama; `null` = format bawaan |
| `head` | Keadaan kerja: `input`, `texts`, `outline`, `step`, `sourceRefs` |
| `sourceRefs` | Daftar `{ citeKey, sourceId }`; `citeKey` unik per dokumen dan **tidak pernah dipakai ulang** setelah dihapus |
| `archivedAt?` | Arsip |

`head` adalah bentuk `Draft` hari ini, dengan satu perubahan: `sources` (salinan penuh) diganti `sourceRefs` (rujukan). Isi `input` dan `texts` tidak berubah, supaya `buildInput`, `renderDataSection`, `analyzeSection`, dan template yang ada tetap berfungsi tanpa diubah.

Reading Journal: artikel yang diringkas tetap hidup di `head.input` (`j_title`, `j_text`, dst.) dan disusun menjadi satu `Source` sementara oleh `journalSourceFromInput`, seperti sekarang. Memindahkannya ke entitas Source adalah keputusan T10, bukan T05.

### 3.5 Version

| Field | Keterangan |
|---|---|
| `documentId`, `workspaceId`, `ownerId` | |
| `seq` | Nomor urut per dokumen, mulai 1, tidak berlubang |
| `reason` | `manual` \| `ekspor` \| `sebelum-pulihkan` \| `sebelum-ganti-template` \| `migrasi` |
| `content` | Salinan `head` (`input`, `texts`, `outline`) |
| `sourceSnapshot` | Per `citeKey`: metadata sumber lengkap, `provenance`, `contentSha256`, **tanpa isi sumber** (isi ada di Source dan besar) |
| `templateRef` | `{ templateId, templateSha256, mappingSha256 }` (tanpa byte template) |
| `contentSha256` | Hash `content` untuk mendeteksi data rusak |
| `schemaVersion` | Versi skema saat dibuat |

Aturan:

- Version **tidak pernah diubah**; hanya dibuat atau dihapus (hapus hanya lewat pemangkasan, bagian 9).
- Version dibuat: saat pengguna menekan "Simpan versi", otomatis sebelum "Pulihkan versi", sebelum penggantian atau penghapusan template yang akan mengosongkan struktur (perilaku destruktif yang ada di `onTemplateChange`), setelah unduh .docx berhasil, dan satu kali saat migrasi dari v1.
- Pulihkan = buat Version `sebelum-pulihkan`, lalu salin `content` ke `head`. Tidak ada riwayat yang hilang.
- Autosave (T24) menulis ke `head` saja, bukan membuat Version.
- Batas lokal awal: 20 Version per dokumen; pemangkasan membuang yang tertua kecuali `manual` dan `migrasi`. Angka final menunggu keputusan (bagian 13, Q3).
- `sourceSnapshot` menyimpan hash isi, bukan isinya, jadi perubahan isi Source sesudah snapshot **terdeteksi** (dasar status sumber yang turun di T13) tanpa menggandakan data besar.

### 3.6 Source

Bentuk `Source` yang ada sekarang (termasuk `provenance` dari T04) dipertahankan, dengan perubahan identitas:

| Field | Keterangan |
|---|---|
| `id` | UUID, stabil, unik di workspace. **Bukan** `S1...` |
| `workspaceId`, `ownerId` | |
| `contentSha256?` | Hash `content`. Dihitung setiap `content` berubah. Dasar deteksi perubahan |
| (sisanya) | `type`, `title`, `authors`, `year`, ..., `content`, `origin`, `verified`, `provenance` seperti `types.ts` |
| `archivedAt?` | Arsip |

`citeKey` (`S1...`) hidup di `Document.sourceRefs`, bukan di Source. Itu yang membuat satu Source bisa dipakai banyak dokumen dengan penanda berbeda. "Pustaka Saya" tidak lagi entitas terpisah: ia adalah semua Source di workspace; "ambil dari pustaka" menjadi "tambahkan rujukan ke dokumen ini".

Saat dokumen dikirim ke server, klien me-resolve `sourceRefs` menjadi daftar `Source` dengan `id = citeKey`, persis format yang diterima `parseSources` sekarang. Batas 40 rujukan per dokumen mengikuti batas server.

### 3.7 Template

| Field | Keterangan |
|---|---|
| `workspaceId`, `ownerId` | |
| `docType` | Jenis dokumen yang dilayani template ini |
| `name`, `size`, `savedAt` | Seperti `StoredTemplate` |
| `data` | Byte .docx (IndexedDB lokal; bucket privat di cloud) |
| `analysis`, `mapping` | Seperti sekarang, plus koreksi pengguna |
| `dataSha256`, `mappingSha256` | Untuk `Version.templateRef` dan integritas |

Template adalah **masukan tidak tepercaya** (T11): dibaca hanya untuk diurai, tidak pernah dieksekusi, dan tidak pernah dipercaya untuk menentukan isi medis.

Bukan Template milik pengguna: template sistem dan pedoman klinis (T16) berstatus `scope = system`, tanpa pemilik, hanya admin yang menulis, mahasiswa hanya membaca. Mereka tidak dibahas lebih jauh di sini.

## 4. Relasi

```
Profile (ownerId) ──────────────────────────────  identitas, bukan di dalam workspace
   │
   └─ Workspace 1 ──< Case            (opsional, banyak)
                 1 ──< Source         (pustaka workspace)
                 1 ──< Template       (per jenis dokumen)
                 1 ──< Document ──< Version
                          │  ├─ caseId?     ──> Case       (opsional, satu workspace)
                          │  ├─ templateId? ──> Template   (opsional, satu workspace)
                          │  └─ sourceRefs  ──> Source     (citeKey -> sourceId, satu workspace)
```

Aturan yang ditegakkan repository sekarang dan RLS nanti: setiap rujukan (`caseId`, `templateId`, `sourceId`) harus menunjuk entitas dengan `workspaceId` dan `ownerId` yang sama. Rujukan lintas workspace ditolak.

## 5. Tiga generator independen

Invarian yang wajib diuji (T06/T07):

- **I1.** Dokumen bisa dibuat hanya dengan workspace (otomatis). Tidak butuh Case, Source, Template, atau dokumen lain.
- **I2.** Fungsi pembuat konten menerima hanya: `Document.head`, Source hasil resolve, Template terpilih, `Profile.identity`, `Workspace.citeStyle`, dan **metadata Case hanya bila `caseId` terisi**. Tidak ada masukan lain.
- **I3.** Tidak ada dokumen yang membaca isi dokumen lain. Pemeriksa konsistensi (`/kasus`) boleh membandingkan beberapa dokumen, tetapi itu aksi eksplisit pengguna, baca-saja, dan hasilnya tidak ditulis ke dokumen mana pun.
- **I4.** Melepas tautan tidak menghilangkan isian: nilai yang berlaku disalin ke `head.input` lebih dulu (perilaku `unlinkDoc` + `caseDerivedInput` hari ini).
- **I5.** Reading Journal tidak pernah menerima kolom `PATIENT_FIELD_IDS`, di klien (`withoutPatientFields`) dan di server (`/api/generate`), apa pun isi Case atau draf.
- **I6.** Case tidak memuat data pasien (bagian 3.3).
- **I7.** Tidak ada rujukan lintas workspace (bagian 4).
- **I8.** Kontrak payload ke server tidak berubah: `input` + `sources` (id `S#`) tetap yang dikirim. Server tidak membaca store mana pun pada fase lokal.

## 6. Tautan opsional Case-Document

- Satu Case boleh dipakai banyak Document; satu Document punya paling banyak satu Case.
- Menghubungkan: tampilkan pratinjau apa yang berubah (`reusePreview`) dan minta konfirmasi (`linkConfirmMessage`), lalu set `caseId`. Dokumen RJ hanya mendapat usulan topik, tidak pernah data pasien.
- Dokumen terhubung membaca `jenisAsuhan` dan `kasus` dari Case saat render (sama dengan `sharedInput` hari ini); perubahan Case ikut ke dokumen terhubung.
- Melepas: salin nilai berlaku ke `head.input`, lalu `caseId = null`.
- Menghapus Case: semua dokumen yang menautnya dilepas dengan prosedur yang sama, tidak ada dokumen yang ikut terhapus.
- Perubahan dari model sekarang: tautan **per dokumen**, bukan per jenis. Dua LK boleh menaut dua Case berbeda, atau satu menaut dan satu mandiri.

## 7. Kepemilikan dan izin

**Lokal (T06):** `ownerId = "local"` pada semua baris. Tidak ada autentikasi; izin = siapa pun yang memegang peramban. Field `ownerId` sudah ada supaya migrasi ke cloud tidak mengubah bentuk data.

**Cloud (T21 s.d. T23):**

- `ownerId` = `auth.users.id`, ditetapkan **server** dari sesi. Nilai `ownerId` dari klien tidak pernah dipercaya.
- Setiap tabel privat membawa `owner_id` (di-denormalisasi di anak-anak workspace supaya kebijakan RLS sederhana: `owner_id = auth.uid()`), dengan kunci asing komposit `(workspace_id, owner_id)` agar anak tidak bisa menunjuk workspace milik orang lain.
- Satu workspace punya tepat satu pemilik. Berbagi (mis. pembimbing membaca) **di luar cakupan** ADR ini; desain tidak menghalanginya (tabel `workspace_members` bisa ditambah tanpa mengubah entitas di atas).
- Peran (`student`, `admin`) ditentukan server (T22) dan terpisah dari kepemilikan. Usulan bawaan: **admin tidak bisa membaca isi dokumen pengguna** (isinya berisi kasus klinis); konsol admin melihat metadata, kuota, dan log. Perlu keputusan (bagian 13, Q2).
- Berkas template dan lampiran: bucket privat, path diawali `ownerId/workspaceId/`, URL bertanda tangan singkat (T23).

## 8. Penyimpanan lokal dan antarmuka repository

**Keputusan:** database IndexedDB baru `nakesa-v2`, dengan object store `meta`, `workspaces`, `cases`, `documents`, `versions`, `sources`, `templates`. Database lama `nakesa` tidak disentuh.

Alasan IndexedDB dan bukan localStorage berkunci: Version menggandakan data, isi Source bisa mencapai megabita, dan migrasi butuh transaksi atomik antar-store. localStorage sinkron, tanpa transaksi, dan berbatas sekitar 5 MB.

Alasan database baru dan bukan menaikkan versi database lama: store `templates` lama tetap utuh sebagai sumber migrasi dan titik mundur; tidak ada `onupgradeneeded` yang bisa merusaknya.

Antarmuka yang dipakai kode domain dan UI (diimplementasikan IndexedDB di T06, Supabase di T24):

```
WorkspaceRepository: list / get / create / update / archive / remove
CaseRepository:      list(ws) / get / create / update / remove
DocumentRepository:  list(ws) / get / create / saveHead(id, head, expectedRev) / archive / remove
VersionRepository:   list(doc) / get / create / prune(doc)
SourceRepository:    list(ws) / get / create / update / archive / remove
TemplateRepository:  list(ws) / get / put / remove
MetaRepository:      schemaVersion, migrations, quarantine
```

Aturan implementasi:

- `saveHead` memakai `expectedRev` (kunci optimis). Tabrakan antar tab atau perangkat ditolak, tidak ditimpa diam-diam. Antar tab: `BroadcastChannel` memberi tahu tab lain agar memuat ulang.
- Kode domain (`buildInput`, `renderDataSection`, `analyzeSection`, pembuat docx) tetap fungsi murni yang menerima data, bukan repository, supaya tetap diuji tanpa penyimpanan.
- Perubahan konsekuensi untuk UI: pemuatan menjadi asinkron. Skeleton `useHydrated` yang sudah ada dipakai; `useLocalState` tetap untuk preferensi kecil (tema) saja.
- Skema bernomor di `meta.schemaVersion`. Migrasi maju bernomor, masing-masing idempoten dan dijalankan berurutan dalam satu transaksi. Aplikasi yang menemukan `schemaVersion` lebih baru dari yang dikenalnya membuka mode baca-saja dan tidak menulis apa pun.

## 9. Migrasi key lokal v1 ke v2

### 9.1 Sumber dan tujuan

| Sumber v1 | Menjadi | Catatan |
|---|---|---|
| `nakesa.settings` (`nama` ... `tahun`) | `Profile.identity` | |
| `nakesa.settings.style` | `Workspace.citeStyle` | |
| `nakesa.settings.accessCode` | kunci `nakesa.device` | Tetap lokal, di luar `nakesa-v2` dan di luar ekspor |
| `nakesa.draft.LP/LK/RJ` | `Document` per draf yang tidak kosong | Draf yang sama dengan `EMPTY_DRAFT` dilewati. `head.input/texts/outline/step` disalin apa adanya |
| `Draft.sources[]` | `Source` + `Document.sourceRefs` | `citeKey` = id lama (`S1`...), jadi penanda `[S#]` di teks tetap sah |
| `nakesa.case` | `Case` (bila ada `kasus` atau `jenis_asuhan`) | Dokumen dengan `linked[type] === true` mendapat `caseId`; sisanya `null`. Case tetap dibuat walau tak ada dokumen yang menaut |
| `nakesa.library[]` | `Source` di workspace | Tidak ada rujukan dokumen |
| IndexedDB `nakesa`/`templates` (kunci = jenis) | `Template` + `Workspace.defaultTemplateIds[jenis]` | Dokumen hasil migrasi berjenis itu mendapat `templateId` tersebut. Template tanpa dokumen tetap disimpan |
| `nakesa.theme` | tidak dipindah | Preferensi perangkat |

Satu `Workspace` bernama "Ruang kerja saya" dibuat untuk seluruh data lama.

### 9.2 Aturan penyatuan Source

Dua Source disatukan **hanya bila** metadata, `content`, dan `provenance`-nya identik (setelah normalisasi spasi). Kecocokan DOI atau judul saja **tidak cukup**. Bila berbeda, keduanya dipertahankan sebagai Source terpisah. Tidak ada isi yang dibuang atau digabung diam-diam; kemungkinan duplikat dilaporkan untuk T13. Alasan: salah gabung merusak sitasi, sedangkan duplikat hanya merepotkan.

### 9.3 Idempoten dan atomik

1. Baca **semua** sumber v1 ke memori lebih dulu (localStorage dan IndexedDB lama). Jangan menunggu promise non-IndexedDB di tengah transaksi tulis, karena transaksi IndexedDB berakhir otomatis saat tidak ada permintaan tertunda.
2. Hitung hasil migrasi di memori (fungsi murni, mudah diuji).
3. Buka **satu** transaksi `readwrite` di `nakesa-v2` atas semua store, tulis semua entitas dan satu catatan `meta.migrations["v1->v2"] = { selesai, tanggal, ringkasan, hashSumber }` di transaksi yang sama.
4. Bila `meta.migrations["v1->v2"]` sudah ada, lewati. Bila transaksi gagal, tidak ada yang tersimpan, dan percobaan berikutnya mengulang dari awal. Tidak ada keadaan setengah jadi.
5. Satu Version `migrasi` (seq 1) dibuat per dokumen sebagai titik pulih awal.

### 9.4 Data lama aman

- Migrasi hanya **membaca** `nakesa.*` dan database `nakesa`. Tidak ada yang ditulis, diubah, atau dihapus.
- Data lama tetap ada sampai pengguna memilih "Hapus data lama" dengan konfirmasi, tersedia hanya setelah migrasi selesai. Tombol "Hapus semua data" (T28) menghapus **v2 dan v1 sekaligus**; ini menutup R12 di `BASELINE.md` (hapus draf sekarang tidak menyentuh `nakesa.case` dan template).
- JSON v1 yang rusak tidak diganti nilai awal lalu ditimpa. String mentahnya disimpan di `meta.quarantine` dan pengguna diberi tahu; bagian itu dimulai kosong.
- Mundur ke versi aplikasi lama tetap bekerja (kunci v1 utuh), tetapi perubahan yang dibuat di v2 sesudah migrasi tidak terlihat di versi lama. Ini diterima dan dicatat di catatan rilis.

### 9.5 Uji yang wajib (T06)

- Migrasi dua kali = hasil sama (idempoten); data lama byte-identik sebelum dan sesudah.
- Ekuivalensi perilaku: untuk tiap draf lama, `buildInput` v1 (draf + `nakesa.case` + settings) sama dengan `buildInput` v2 (Document + Case + Profile) untuk LP, LK, dan RJ, termasuk kasus terhubung dan terlepas.
- Penanda `[S#]` di `texts` tetap menunjuk sumber yang sama.
- Draf kosong tidak membuat dokumen; Case tanpa dokumen tetap dibuat.
- JSON rusak masuk `quarantine`, bagian lain tetap termigrasi.
- Sumber dengan DOI sama tetapi isi berbeda tidak digabung.
- Kegagalan di tengah (transaksi dibatalkan) tidak meninggalkan data parsial.

## 10. Arsip dan hapus

| Entitas | Arsip (dapat dipulihkan, tersembunyi) | Hapus permanen |
|---|---|---|
| Workspace | `archivedAt`; semua isinya ikut tersembunyi | Konfirmasi dengan mengetik nama. Menghapus seluruh isinya, termasuk Version dan Source |
| Document | Ya | Konfirmasi. Version ikut terhapus |
| Case | Tidak perlu | Dokumen yang menaut dilepas (bagian 6), tidak ada dokumen terhapus |
| Source | Ya | Bila dirujuk dokumen: tampilkan daftar dokumen terdampak dan minta konfirmasi. Penanda `[S#]` yang tertinggal ditandai "tidak ada di daftar sumber" oleh pemeriksa yang sudah ada (`analyzeSection`), dan oleh deteksi sumber yatim di T13 |
| Template | Tidak perlu | Dokumen yang memakainya kembali ke format bawaan; Version `sebelum-ganti-template` dibuat lebih dulu |
| Version | Tidak | Hanya lewat pemangkasan atau hapus dokumen |

Hapus permanen bersifat menyeluruh (kaskade) dan harus menghapus Version, karena Version LK memuat data kasus (T28).

## 11. Jalur ke cloud

- Entitas, nama field, dan UUID **sama**. Tabel: `profiles`, `workspaces`, `cases`, `documents`, `document_versions`, `sources`, `templates`, ditambah `document_sources` bila `sourceRefs` dinormalkan. Bentuk SQL dan RLS adalah pekerjaan T21 dan T23; ADR ini hanya menetapkan model.
- Migrasi draf lokal ke cloud (T24): ekspor v2, **pratinjau** (jumlah dokumen, Source, Template, ukuran), konfirmasi pengguna, lalu unggah dengan upsert idempoten berdasarkan `id`. Server menetapkan `ownerId` dari sesi. Bila `id` sudah dipakai milik pemilik lain, server menolak tanpa mengungkap keberadaannya, dan klien membuat id baru lalu memetakan ulang rujukan.
- `rev` dan `expectedRev` dipakai ulang untuk autosave berdebounce tanpa duplikat (T24).
- Server tetap menerima payload yang di-resolve (I8). Bila kelak generasi dilakukan dari id di server, server wajib memeriksa kepemilikan setiap id dan membaca Source dari database, bukan dari klien.
- Data pasien tetap hanya berada di `Document.head` LK dan Version-nya. Minimisasi (larangan nama, NIK, alamat, nomor RM), ekspor, hapus, dan retensi adalah T28.

## 12. Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| Tetap kunci `nakesa.draft.<jenis>`, hanya tambah awalan workspace | Tetap satu dokumen per jenis, tak ada Version, dan Source tetap tersalin di tiap draf; kuota 5 MB tetap menjadi batas |
| Hierarki Workspace -> Case -> Document (dokumen wajib punya Case) | Melanggar T07: LP dari topik dan Reading Journal tidak terikat kasus. Generator tidak lagi mandiri |
| Case menyimpan data pasien bersama untuk LK dan LP | Melanggar T03 dan T28 (data pasien tidak otomatis ke dokumen lain) dan memperbesar dampak kebocoran |
| Satu blob JSON per workspace | Penulisan ulang seluruh blob tiap ketikan, tabrakan sulit dideteksi, tidak cocok dengan baris per baris di Postgres |
| Menaikkan versi database IndexedDB `nakesa` ke 2 | `onupgradeneeded` bisa merusak data lama dan menghilangkan titik mundur |
| Langsung membangun di cloud | T06 mendahului T21; aplikasi harus tetap berjalan tanpa akun. Antarmuka repository menjaga jalur ke cloud tetap terbuka |
| Source disalin per dokumen (seperti sekarang) | Perubahan di satu salinan tidak terlihat di salinan lain, status verifikasi tidak konsisten, dan penyimpanan membengkak |

## 13. Pertanyaan terbuka (butuh keputusan manusia)

- **Q1.** Satu workspace mewakili apa: satu semester/stase, satu kampus, atau satu pengguna secara keseluruhan? ADR ini menyiapkan banyak workspace tetapi tidak memaksa jawabannya. Bawaan: satu workspace otomatis.
- **Q2.** Bolehkah admin pernah membaca isi dokumen pengguna (mis. untuk bantuan)? Usulan: tidak sama sekali di v1.
- **Q3.** Berapa Version yang disimpan per dokumen, dan berapa lama di cloud? Usulan awal: 20 per dokumen, tertua dipangkas kecuali `manual` dan `migrasi`.
- **Q4.** Pembimbing perlu membaca (baca-saja) dokumen mahasiswa? Di luar cakupan sekarang; jawabannya menentukan `workspace_members`.
- **Q5.** Identitas pengguna (`nama`, `nim`, `kampus`) milik Profile (satu untuk semua workspace, usulan ini) atau milik workspace? Bila mahasiswa pindah kampus, ini berpengaruh.

## 14. Konsekuensi

**Positif:** banyak dokumen per jenis; riwayat dan pemulihan; Source tunggal dengan status yang konsisten; jalur cloud tanpa menulis ulang logika dokumen; `accessCode` terpisah dari data yang bisa diekspor; kuota localStorage tidak lagi menjadi batas.

**Biaya:** pemuatan data menjadi asinkron di UI; satu lapisan repository dan satu migrasi harus dibangun dan diuji (T06); sementara waktu data tersimpan di dua tempat (v1 utuh, v2 aktif) sampai pengguna menghapus data lama.

**Risiko dan mitigasi:**

| Risiko | Mitigasi |
|---|---|
| Migrasi mengubah perilaku `buildInput` | Uji ekuivalensi bagian 9.5 |
| Penanda `[S#]` tidak lagi cocok setelah migrasi | `citeKey` = id lama; `citeKey` tidak pernah dipakai ulang |
| Data lama tetap tersimpan setelah pengguna menganggapnya terhapus | "Hapus semua data" mencakup v1 dan v2; peringatan di UI |
| Dua tab menulis bersamaan | `rev` + `expectedRev` + `BroadcastChannel` |
| IndexedDB diblokir (mode privat) | Aplikasi memberi tahu bahwa data tidak akan tersimpan; tidak diam-diam jatuh ke memori |
| Version LK menyimpan data kasus lebih lama dari yang disadari | Kaskade hapus; masuk cakupan T28 |

## 15. Dampak ke tugas lain

| Tugas | Dampak |
|---|---|
| T06 | Mengimplementasikan bagian 3, 6, 8, 9, 10 di penyimpanan lokal. Uji bagian 9.5 wajib |
| T11 | Template mendapat `id`, `dataSha256`, `mappingSha256`; `Document.templateId` menyimpan pilihan. Mapping tersimpan per template |
| T13 | `Source.contentSha256` dan `Version.sourceSnapshot` menjadi dasar status sumber turun saat berubah |
| T21 | Skema mengikuti bagian 3 dan 11 |
| T22, T23 | `ownerId` diisi server; RLS memakai `owner_id` dan kunci asing komposit |
| T24 | `rev`, `expectedRev`, dan migrasi dengan pratinjau mengikuti bagian 8 dan 11 |
| T26 | Admin tidak membaca isi dokumen kecuali Q2 diputuskan lain |
| T28 | Kaskade hapus mencakup Version; "hapus semua data" mencakup v1; Case tidak boleh memuat data pasien |

Catatan: `docs/audit/BASELINE.md` ditulis sebelum T04 dan masih menandai T04 sebagai `missing`; itu bukan cakupan T05 dan dibiarkan.
