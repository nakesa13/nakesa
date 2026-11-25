export type CoverField = "judul" | "nama" | "nim" | "prodi" | "kampus" | "tahun" | "pembimbing";
import type { CiteStyle } from "../types";

export const COVER_FIELDS: { id: CoverField; label: string }[] = [
  { id: "judul", label: "Judul" },
  { id: "nama", label: "Nama" },
  { id: "nim", label: "NIM" },
  { id: "prodi", label: "Program studi" },
  { id: "kampus", label: "Kampus" },
  { id: "tahun", label: "Tahun" },
  { id: "pembimbing", label: "Pembimbing" },
];

export interface BlockInfo {
  /** Indeks elemen anak langsung w:body. */
  i: number;
  kind: "p" | "tbl" | "toc" | "sdt" | "sectPr" | "other";
  text: string;
  styleId: string | null;
  styleName: string | null;
  level: 0 | 1 | 2 | 3;
  pageBreak: boolean;
  sectBreak: boolean;
  tocLine: boolean;
}

export interface FormatSummary {
  font: string | null;
  sizePt: number | null;
  line: string | null;
  align: string | null;
  bold: boolean;
  autoNumbered: boolean;
}

export type TocMode = "keep" | "replace" | "add" | "none";

export interface Mapping {
  /** Indeks blok pertama isi (bab pertama). Semua sebelum ini (sampul, halaman depan) dipertahankan. */
  bodyStart: number;
  /** Indeks blok judul Daftar Pustaka; isi di antara bodyStart dan ini diganti. Null = sampai akhir dokumen. */
  bodyEnd: number | null;
  bibHeading: number | null;
  /** Akhir area daftar pustaka (mis. awal Lampiran); null = akhir dokumen. */
  bibEnd: number | null;
  /** Indeks blok -> kolom sampul yang menggantikan teksnya. */
  coverFields: Record<string, CoverField>;
  samples: { h1: number | null; h2: number | null; h3: number | null; body: number | null };
  tocMode: TocMode;
  tocHeading: number | null;
  /**
   * T12: gaya sitasi dokumen hasil. Terisi dari deteksi contoh daftar pustaka/sitasi di template dan bisa dikoreksi pengguna.
   * null/tidak ada = ikut Pengaturan (APA atau Vancouver).
   */
  citeStyle?: CiteStyle | null;
}

export interface Analysis {
  total: number;
  blocks: BlockInfo[];
  suggested: Mapping;
  formats: { h1: FormatSummary | null; h2: FormatSummary | null; h3: FormatSummary | null; body: FormatSummary | null };
  page: { widthTwips: number | null; heightTwips: number | null; left: number | null; right: number | null; top: number | null; bottom: number | null };
  sections: number;
  hasHeader: boolean;
  hasFooter: boolean;
  hasToc: boolean;
  placeholders: string[];
  warnings: string[];
  /** T12: gaya sitasi yang terdeteksi dari template beserta alasannya. Tidak ada pada analisis lama yang tersimpan di peramban. */
  citeStyle?: { style: CiteStyle | null; evidence: string };
}
