import type { DocType } from "@/lib/types";

export type FieldType = "text" | "textarea" | "select" | "journal" | "serial";

export interface FieldDef {
  id: string;
  label: string;
  help?: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  rows?: number;
  /** Lebar setengah baris pada layar lebar. */
  half?: boolean;
}

export interface StepDef {
  id: string;
  title: string;
  description?: string;
  fields: FieldDef[];
}

export interface SectionDef {
  id: string;
  /** Boleh memuat {kasus}, {jenis_asuhan}, {judul} yang diganti dari isian. */
  title: string;
  level: 1 | 2 | 3;
  /** ai = ditulis AI; data = disusun kode dari isian; heading = hanya judul. */
  kind: "ai" | "data" | "heading";
  /** Panduan untuk mahasiswa (media belajar). */
  guide: string;
  /** Instruksi untuk AI (hanya kind=ai). */
  instruction?: string;
  /** Target panjang (kata). */
  words?: number;
  /** Bagian ini seharusnya punya rujukan. */
  needsCitation?: boolean;
  /** Bagian berisi analisis atas pasien -> angka klinis diperiksa terhadap isian. */
  patientSpecific?: boolean;
  /** Tahap B: id bagian baku yang dipakai untuk menyusun isi (bila berbeda dari id). */
  ref?: string;
  /** Tahap B: bagian diisi mahasiswa sendiri (kind=data tanpa sumber otomatis). */
  manual?: boolean;
  /** T10 (Reading Journal): bagian telaah kritis, yaitu penilaian yang terpisah dari ringkasan isi artikel. */
  appraisal?: boolean;
}

export interface TemplateDef {
  type: DocType;
  name: string;
  short: string;
  description: string;
  coverTitle: string;
  /** center = judul bab di tengah (BAB I ...); left = judul rata kiri (A. ...). */
  chapterStyle: "center" | "left";
  steps: StepDef[];
  sections: SectionDef[];
}
