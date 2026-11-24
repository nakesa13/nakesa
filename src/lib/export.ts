import type { DocSection, DocType, Identity, Input } from "./types";
import type { SectionDef } from "@/templates/types";
import { resolveTitle } from "@/templates";
import { KOSONG } from "./case";
import { IDENTITY_IDS } from "./client";
import { lpTitleFor } from "./kasus";

/**
 * T12: bahan ekspor yang sama untuk unduh .docx dan pratinjau/PDF, supaya pratinjau tidak menyimpang dari file yang diunduh.
 */

/** Judul dokumen: isian judul, lalu judul jurnal (RJ), lalu judul cadangan LP, lalu nama dokumen. */
export function documentTitle(docType: DocType, input: Input, fallback: string): string {
  return (
    (input.judul ?? "").trim() ||
    (docType === "RJ" ? (input.j_title ?? "").trim() : "") ||
    (docType === "LP" ? lpTitleFor(input.jenis_asuhan ?? "", input.kasus ?? "") : "") ||
    fallback
  );
}

export function identityPayload(input: Input): Identity {
  return Object.fromEntries(IDENTITY_IDS.map((k) => [k, input[k] ?? ""])) as unknown as Identity;
}

/** Bagian yang dikirim ke pembuat dokumen. Bagian "isi sendiri" yang kosong ditulis KOSONG, bukan dibiarkan hilang. */
export function sectionPayload(sections: SectionDef[], input: Input, textOf: (s: SectionDef) => string): DocSection[] {
  return sections.map((s) => ({
    id: s.id,
    title: resolveTitle(s, input),
    level: s.level,
    kind: s.kind,
    text: s.kind === "heading" ? "" : s.manual && !textOf(s).trim() ? KOSONG : textOf(s),
  }));
}
