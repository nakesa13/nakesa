import type { Source } from "./types";
import type { SectionDef } from "@/templates/types";
import { extractMarkerIds } from "./citations";

/**
 * T08: LP mandiri. Aturan sumber kosong:
 * - AI hanya boleh mengutip sumber yang isinya dilampirkan (lihat ai.ts).
 * - Bila tidak ada satu pun sumber berisi, paragraf teori diberi tanda "[perlu referensi]" oleh KODE (bukan AI),
 *   supaya teks tanpa rujukan tidak terkumpul tanpa disadari. Tanda hilang setelah bagian ditulis ulang dengan sumber.
 */

export const PERLU_REFERENSI = "[perlu referensi]";

/** Panjang isi minimum agar sumber boleh dikutip (sama dengan ai.ts). */
export const MIN_SOURCE_CONTENT = 200;

/** Paragraf lebih pendek dari ini tidak diberi tanda (judul kecil, butir singkat). */
const MIN_BODY = 80;

export function hasUsableSource(sources: Source[]): boolean {
  return sources.some((s) => (s.content ?? "").trim().length >= MIN_SOURCE_CONTENT);
}

/** Bagian LP yang perlu ditandai bila tidak ada sumber berisi. */
export function needsReferenceMark(docType: string, def: SectionDef, sources: Source[]): boolean {
  return docType === "LP" && def.kind === "ai" && !!def.needsCitation && !hasUsableSource(sources);
}

/**
 * Tambahkan "[perlu referensi]" di akhir tiap paragraf/daftar yang belum punya rujukan.
 * Tabel, sub-judul tebal, blok pendek, dan blok yang sudah bertanda dibiarkan. Aman dipanggil berulang.
 */
export function markNeedsReference(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trimEnd();
      const s = t.trim();
      if (!s) return t;
      if (s.startsWith("|")) return t;
      if (/^\*\*[^*]+\*\*:?$/.test(s)) return t;
      if (t.includes(PERLU_REFERENSI)) return t;
      if (extractMarkerIds(t).length > 0) return t;
      if (s.replace(/\*\*/g, "").replace(/\s+/g, " ").length < MIN_BODY) return t;
      return `${t} ${PERLU_REFERENSI}`;
    })
    .join("\n\n");
}

export function countNeedsReference(text: string): number {
  return text.split(PERLU_REFERENSI).length - 1;
}

/** Bagian AI yang belum ada teksnya: dasar untuk melanjutkan (resume) penulisan. */
export function pendingAiSections(sections: SectionDef[], texts: Record<string, string>): SectionDef[] {
  return sections.filter((s) => s.kind === "ai" && !(texts[s.id] ?? "").trim());
}
