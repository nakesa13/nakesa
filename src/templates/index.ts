import type { DocType, Input } from "@/lib/types";
import type { SectionDef, TemplateDef } from "./types";
import { LP } from "./lp";
import { LK } from "./lk";
import { RJ } from "./rj";

export const TEMPLATES: Record<DocType, TemplateDef> = { LP, LK, RJ };

export function getTemplate(type: string): TemplateDef | null {
  return type === "LP" || type === "LK" || type === "RJ" ? TEMPLATES[type] : null;
}

/** Ganti {kasus}, {jenis_asuhan}, {judul} pada judul bagian. */
export function resolveTitle(section: SectionDef, input: Input): string {
  return section.title.replace(/\{(\w+)\}/g, (_, key: string) => input[key]?.trim() || "…");
}
