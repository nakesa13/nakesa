import type { DocType, Input, Source } from "./types";
import type { SectionDef } from "@/templates/types";
import { TEMPLATES } from "@/templates";
import { resolveSection, type OutlineItem } from "./outline";

/** Draf satu dokumen (disimpan di localStorage per jenis dokumen). */
export interface Draft {
  input: Input;
  sources: Source[];
  texts: Record<string, string>;
  step: number;
  /** Tahap B: struktur bab dari template mahasiswa. null = struktur bawaan NAKESA. */
  outline?: OutlineItem[] | null;
}

export const EMPTY_DRAFT: Draft = { input: {}, sources: [], texts: {}, step: 0, outline: null };

/** Bagian dokumen yang berlaku untuk draf ini (struktur template mahasiswa bila ada, bila tidak struktur bawaan). */
export function sectionsOf(docType: DocType, d: Draft): SectionDef[] {
  return d.outline ? d.outline.map((i) => resolveSection(docType, i)) : TEMPLATES[docType].sections;
}
