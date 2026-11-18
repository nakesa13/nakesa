"use client";
import type { DocType } from "@/lib/types";
import { DRAFT_PREFIX } from "@/lib/client";
import { useLocalState } from "@/lib/useLocalState";

interface HintDraft {
  texts?: Record<string, string>;
  input?: Record<string, string>;
}
const NONE: HintDraft | null = null;

export function DraftHint({ docType }: { docType: DocType }) {
  const [d] = useLocalState<HintDraft | null>(DRAFT_PREFIX + docType, NONE);
  const filled = d ? Object.values(d.texts ?? {}).filter((t) => t.trim()).length : 0;
  const title = d?.input?.judul || d?.input?.j_title;
  if (!d || (!title && !filled)) return <span className="badge badge-mute">Belum ada draf</span>;
  return <span className="badge badge-ok">Draf tersimpan{title ? `: ${title.slice(0, 40)}` : ""}</span>;
}
