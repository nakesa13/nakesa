export type DocType = "LP" | "LK" | "RJ";
export type CiteStyle = "APA" | "Vancouver";

/** Isian form: id kolom -> teks. */
export type Input = Record<string, string>;

export interface Author {
  family: string; // nama belakang, atau nama lembaga utuh
  given?: string; // nama depan (kosong untuk lembaga)
}

/** Hasil membandingkan judul metadata DOI dengan isi file/halaman. DOI yang sah belum tentu isinya cocok. */
export type DoiCheck = "cocok" | "tidak-cocok" | "tidak-dapat-dinilai";

export interface Provenance {
  method: "doi" | "url" | "file";
  /** URL yang diminta (tanpa fragmen). */
  url?: string;
  /** URL akhir setelah pengalihan. */
  finalUrl?: string;
  fileName?: string;
  /** Waktu pengambilan, ISO 8601. */
  fetchedAt: string;
  contentType?: string;
  bytes?: number;
  /** SHA-256 byte asli, heksadesimal. */
  sha256?: string;
  /** DOI yang ditemukan di dalam isi, bila ada. */
  doiInText?: string;
  doiCheck?: DoiCheck;
}

export interface Source {
  id: string; // "S1", "S2", ...
  type: "jurnal" | "buku" | "pedoman" | "web";
  title: string;
  authors: Author[];
  year: string;
  publisher?: string;
  edition?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  /** Kutipan/isi sumber yang boleh dipakai AI. Tanpa isi, AI tidak boleh mengutip sumber ini. */
  content?: string;
  origin: "crossref" | "manual";
  verified: boolean;
  /** T04: asal-usul isi/metadata sumber (diisi saat impor DOI, URL, atau file). Sumber lama dan isian manual tidak memilikinya. */
  provenance?: Provenance;
}

export interface DocSection {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  kind: "ai" | "data" | "heading";
  text: string;
}

export interface Identity {
  nama: string;
  nim: string;
  prodi: string;
  kampus: string;
  pembimbing: string;
  tahun: string;
}

export interface SectionWarnings {
  unknownMarkers: string[];
  uncitedParagraphs: number;
  unsupportedNumbers: string[];
  /** T10 (Reading Journal): nama penulis yang disebut tetapi tidak ada di teks jurnal. Hanya ada bila ada temuan. */
  unsupportedNames?: string[];
}
