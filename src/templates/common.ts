import type { StepDef } from "./types";

export const JENIS_ASUHAN = [
  "Kehamilan (ANC)",
  "Persalinan (INC)",
  "Nifas (PNC)",
  "Bayi Baru Lahir",
  "Bayi dan Balita",
  "Keluarga Berencana (KB)",
  "Ginekologi",
];

export const identitasStep: StepDef = {
  id: "identitas",
  title: "Identitas Penyusun",
  description:
    "Dipakai untuk halaman sampul. Bisa diisi sekali di menu Pengaturan agar otomatis terisi.",
  fields: [
    { id: "nama", label: "Nama mahasiswa", type: "text", half: true },
    { id: "nim", label: "NIM", type: "text", half: true },
    { id: "prodi", label: "Program studi", type: "text", half: true, placeholder: "mis. D3 Kebidanan" },
    { id: "kampus", label: "Institusi / kampus", type: "text", half: true },
    { id: "pembimbing", label: "Dosen pembimbing (opsional)", type: "text", half: true },
    { id: "tahun", label: "Tahun", type: "text", half: true },
  ],
};
