export type DocType = "LP" | "LK" | "RJ";
export type CiteStyle = "APA" | "Vancouver";

/** Isian form: id kolom -> teks. */
export type Input = Record<string, string>;

export interface Author {
  family: string; // nama belakang, atau nama lembaga utuh
  given?: string; // nama depan (kosong untuk lembaga)
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
}
