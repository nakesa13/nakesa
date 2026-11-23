import type { TemplateDef } from "./types";
import { identitasStep } from "./common";
import { TIDAK_DILAPORKAN } from "@/lib/journal";

const NA = TIDAK_DILAPORKAN;
const DARI_JURNAL = `Ringkasan hanya berasal dari teks jurnal yang Anda unggah. Bila tidak tercantum, tertulis '${NA}' (tidak ditebak).`;
const BUKAN_NILAI = "Ini ringkasan: laporkan apa yang dinyatakan penulis, tanpa menilai.";

export const RJ: TemplateDef = {
  type: "RJ",
  name: "Reading Journal",
  short: "RJ",
  description:
    "Telaah satu jurnal ilmiah. Ringkasan dibuat hanya dari teks jurnal yang Anda unggah (PDF), bukan dari ingatan AI. Ringkasan dan telaah kritis dipisahkan.",
  coverTitle: "READING JOURNAL",
  chapterStyle: "left",
  steps: [
    {
      id: "jurnal",
      title: "Jurnal",
      description:
        "Unggah PDF jurnal (disarankan) dan/atau cari metadata lewat DOI. Teks jurnal wajib ada. Bila hanya abstrak atau sebagian teks yang tersedia, bagian yang tidak ada ditulis 'Tidak dilaporkan', bukan ditebak.",
      fields: [{ id: "journal", label: "Sumber jurnal", type: "journal", required: true }],
    },
    {
      id: "konteks",
      title: "Konteks",
      fields: [
        {
          id: "judul",
          label: "Judul Reading Journal",
          type: "text",
          placeholder: "Boleh dikosongkan; otomatis memakai judul jurnal.",
        },
        {
          id: "topik",
          label: "Topik kebidanan terkait (opsional)",
          type: "text",
          placeholder: "mis. asuhan nifas, ASI eksklusif",
          help: "Dipakai untuk bagian implikasi bagi praktik kebidanan.",
        },
        { id: "fokus", label: "Catatan fokus (opsional)", type: "textarea", rows: 3, help: "Mis. dosen meminta analisis PICO." },
      ],
    },
    identitasStep,
  ],
  sections: [
    {
      id: "identitas_jurnal",
      title: "A. Identitas Jurnal",
      level: 1,
      kind: "data",
      guide: "Disusun dari metadata jurnal (DOI/isian Anda), bukan oleh AI.",
    },
    {
      id: "latar",
      title: "B. Latar Belakang",
      level: 1,
      kind: "ai",
      guide: `Alasan penelitian dilakukan menurut penulis jurnal. ${BUKAN_NILAI} ${DARI_JURNAL}`,
      instruction: `Ringkas latar belakang/masalah penelitian sebagaimana dijelaskan dalam jurnal. Bila tidak dijelaskan, tulis '${NA}'`,
      words: 150,
    },
    {
      id: "tujuan",
      title: "C. Tujuan Penelitian",
      level: 1,
      kind: "ai",
      guide: `Tujuan yang dinyatakan penulis. ${BUKAN_NILAI} ${DARI_JURNAL}`,
      instruction: `Tuliskan tujuan penelitian sebagaimana dinyatakan dalam jurnal. Bila tidak dinyatakan, tulis '${NA}'`,
      words: 70,
    },
    {
      id: "metode",
      title: "D. Metode Penelitian",
      level: 1,
      kind: "ai",
      guide: `Desain, populasi dan sampel, instrumen, analisis data. ${BUKAN_NILAI} ${DARI_JURNAL}`,
      instruction: `Ringkas metode penelitian dengan sub-judul tebal: **Desain**, **Populasi dan sampel**, **Instrumen/intervensi**, **Analisis data**. Bila salah satu tidak ditulis di jurnal, tulis '${NA}' di bawah sub-judulnya.`,
      words: 200,
    },
    {
      id: "hasil",
      title: "E. Hasil Penelitian",
      level: 1,
      kind: "ai",
      guide: `Temuan utama beserta angka dari jurnal. ${BUKAN_NILAI} ${DARI_JURNAL}`,
      instruction: `Ringkas hasil penelitian. Angka, persentase, dan nilai p hanya boleh disalin persis dari teks jurnal. Jangan menghitung ulang atau memperkirakan angka, dan jangan menulis nilai p, interval kepercayaan, atau ukuran efek yang tidak tertulis di jurnal; bila tidak ada, tulis '${NA}'`,
      words: 220,
    },
    {
      id: "pembahasan",
      title: "F. Pembahasan",
      level: 1,
      kind: "ai",
      guide: `Cara penulis menjelaskan hasilnya. ${BUKAN_NILAI} ${DARI_JURNAL}`,
      instruction: `Ringkas pembahasan penulis jurnal: bagaimana hasil dijelaskan dan dibandingkan dengan penelitian lain yang disebut dalam jurnal. Bila tidak ada pembahasan di teks, tulis '${NA}'`,
      words: 200,
    },
    {
      id: "kesimpulan",
      title: "G. Kesimpulan",
      level: 1,
      kind: "ai",
      guide: `Kesimpulan penulis. ${BUKAN_NILAI} ${DARI_JURNAL}`,
      instruction: `Tuliskan kesimpulan dan saran penulis jurnal. Bila tidak ada di teks, tulis '${NA}'`,
      words: 100,
    },
    {
      id: "telaah_kritis",
      title: "Telaah Kritis (penilaian, bukan ringkasan isi jurnal)",
      level: 1,
      kind: "heading",
      guide: "Bagian di bawah ini adalah penilaian terhadap jurnal, terpisah dari ringkasan di atas. Ini analisis, bukan isi artikel: tinjau dan sesuaikan dengan pendapat Anda.",
    },
    {
      id: "kelebihan",
      title: "H. Kelebihan Jurnal",
      level: 1,
      kind: "ai",
      appraisal: true,
      guide: "Telaah kritis (penilaian, bukan ringkasan). Tinjau dan sesuaikan dengan pendapat Anda.",
      instruction:
        "Sebutkan kelebihan jurnal berdasarkan isi teks yang diberikan saja (mis. kejelasan desain, ukuran sampel yang disebut, instrumen tervalidasi bila disebut). Dasarkan tiap poin pada hal yang tertulis dalam teks.",
      words: 110,
    },
    {
      id: "kekurangan",
      title: "I. Kekurangan Jurnal",
      level: 1,
      kind: "ai",
      appraisal: true,
      guide: "Telaah kritis (penilaian, bukan ringkasan). Tinjau dan sesuaikan.",
      instruction:
        "Sebutkan kekurangan/keterbatasan jurnal berdasarkan isi teks yang diberikan saja (termasuk keterbatasan yang diakui penulis). Jangan mengkritik hal yang tidak dapat dipastikan dari teks.",
      words: 110,
    },
    {
      id: "implikasi",
      title: "J. Implikasi bagi Praktik Kebidanan",
      level: 1,
      kind: "ai",
      appraisal: true,
      guide: "Bagaimana temuan dapat dipakai di praktik. Ini pendapat analitis, tinjau dengan dosen.",
      instruction:
        "Uraikan implikasi temuan jurnal bagi praktik asuhan kebidanan (memakai TOPIK bila ada). Batasi pada apa yang didukung temuan jurnal dan nyatakan dengan hati-hati. Jangan menambah fakta klinis baru di luar jurnal.",
      words: 130,
    },
  ],
};
