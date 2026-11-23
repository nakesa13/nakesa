import type { DocType } from "./types";
import type { Analysis, Mapping } from "./template/types";
import type { SectionDef } from "@/templates/types";
import { TEMPLATES } from "@/templates";

/**
 * Tahap B: struktur bab mengikuti template kampus.
 * Judul bab dibaca dari template (tanpa AI, gratis), diklasifikasi dengan aturan kata kunci,
 * lalu dikonfirmasi/diubah mahasiswa. Instruksi untuk AI TIDAK pernah berasal dari klien:
 * server membangun ulang instruksi dari id bagian baku atau dari aturan umum di sini.
 */

export type OutlineRole = "heading" | "ai" | "data" | "manual";
export type Zone = "pendahuluan" | "teori" | "kasus" | "pembahasan" | "penutup" | "lain";

export interface OutlineItem {
  id: string; // "o1", "o2", ...
  title: string;
  level: 1 | 2 | 3;
  role: OutlineRole;
  /** role "data": jenis isian. role "ai": id bagian baku yang instruksinya dipakai. */
  ref?: string;
  zone?: Zone;
}

export interface Heading {
  block: number;
  text: string;
  level: 1 | 2 | 3;
}

export interface Extracted {
  items: Heading[];
  samples: { h1: number | null; h2: number | null; h3: number | null };
  truncated: boolean;
}

/** Batas yang sama dengan API /api/docx (maks. 60 bagian). */
export const MAX_OUTLINE = 60;
const MAX_TITLE = 150;
const ROLES: OutlineRole[] = ["heading", "ai", "data", "manual"];
const ZONES: Zone[] = ["pendahuluan", "teori", "kasus", "pembahasan", "penutup", "lain"];

/** Jenis isian yang boleh disusun kode dari formulir, per jenis dokumen. */
export const DATA_REFS: Record<DocType, string[]> = {
  LP: [],
  LK: ["subjektif", "objektif", "pengkajian", "implementasi", "evaluasi"],
  RJ: ["identitas_jurnal"],
};

export const DATA_REF_LABEL: Record<string, string> = {
  subjektif: "Dari isian: data subjektif",
  objektif: "Dari isian: data objektif",
  pengkajian: "Dari isian: subjektif + objektif",
  implementasi: "Dari isian: implementasi",
  evaluasi: "Dari isian: evaluasi",
  identitas_jurnal: "Dari isian: identitas jurnal",
};

// ---------- membaca judul dari template ----------

const CHAPTER = /^BAB\s+([IVXLC]+|\d+)\b/i;
const CHAPTER_ONLY = /^BAB\s+([IVXLC]+|\d+)\.?$/i;
const LETTER = /^[A-Z]\.\s+\S/;
const NUM = /^(?:\d+(?:\.\d+)*\.|\d+(?:\.\d+)+)\s+\S/;

type PatKind = "chapter" | "letter" | "num" | null;

function patKind(t: string): PatKind {
  if (CHAPTER.test(t)) return "chapter";
  if (LETTER.test(t)) return "letter";
  if (NUM.test(t)) return "num";
  return null;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]+/g;
const clean = (s: string): string => s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();

interface Cand {
  block: number;
  text: string;
  level: 0 | 1 | 2 | 3;
}

function candidates(a: Analysis, m: Mapping): Cand[] {
  const end = m.bodyEnd ?? m.bibHeading ?? a.total;
  const body = a.blocks.filter((b) => b.i >= m.bodyStart && b.i < end && b.kind === "p" && !b.tocLine && b.text.trim());
  const out: Cand[] = [];
  for (let k = 0; k < body.length; k++) {
    const b = body[k];
    let text = clean(b.text);
    // "BAB I" dan "PENDAHULUAN" sering diketik pada dua paragraf: digabung.
    if (CHAPTER_ONLY.test(text)) {
      const nx = body[k + 1];
      if (nx) {
        const nt = clean(nx.text);
        if (nt.length <= 100 && patKind(nt) === null) {
          text = `${text} ${nt}`;
          k++;
        }
      }
    }
    out.push({ block: b.i, text, level: b.level });
  }
  return out;
}

/**
 * Ambil judul bab/subbab dari area isi template.
 * Bila template memakai gaya Heading Word, gaya itu yang dipakai; bila tidak, pola penomoran
 * (BAB I, A., 1.) dengan tingkat ditentukan dari pola yang ada.
 */
export function extractHeadings(a: Analysis, m: Mapping): Extracted {
  const cands = candidates(a, m).filter((c) => c.text.length <= MAX_TITLE);
  const styled = cands.filter((c) => c.level > 0);
  let heads: Heading[];
  if (styled.length >= 2) {
    heads = styled.map((c) => ({ block: c.block, text: c.text, level: c.level as 1 | 2 | 3 }));
  } else {
    const withPat = cands
      .map((c) => ({ c, k: patKind(c.text) }))
      .filter((x): x is { c: Cand; k: "chapter" | "letter" | "num" } => x.k !== null && x.c.text.length <= (x.k === "num" ? 100 : 120));
    const order = (["chapter", "letter", "num"] as const).filter((k) => withPat.some((x) => x.k === k));
    heads = withPat.map((x) => ({ block: x.c.block, text: x.c.text, level: (order.indexOf(x.k) + 1) as 1 | 2 | 3 }));
  }
  const truncated = heads.length > MAX_OUTLINE;
  heads = heads.slice(0, MAX_OUTLINE);
  const first = (lv: 1 | 2 | 3) => heads.find((h) => h.level === lv)?.block ?? null;
  return { items: heads, samples: { h1: first(1), h2: first(2), h3: first(3) }, truncated };
}

// ---------- klasifikasi ----------

const normalize = (t: string): string =>
  t
    .toLowerCase()
    .replace(/^bab\s+[ivxlc\d]+\.?\s*/, "")
    .replace(/^(?:[a-z]\.|\d+(?:\.\d+)*\.?|[ivx]+\.)\s+/, "")
    .replace(/^langkah\s+[ivx\d]+\s*[:.\-–]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

function zoneOf(norm: string): Zone {
  if (/pendahuluan|latar belakang/.test(norm)) return "pendahuluan";
  if (/tinjauan (pustaka|teori)|landasan|kajian|konsep|dasar teori|teori/.test(norm)) return "teori";
  if (/pembahasan/.test(norm)) return "pembahasan";
  if (/penutup|kesimpulan|saran/.test(norm)) return "penutup";
  if (/kasus|asuhan kebidanan|pengkajian|manajemen/.test(norm)) return "kasus";
  return "lain";
}

interface Rule {
  z?: Zone[];
  re: RegExp;
  role: "ai" | "data";
  ref: string;
}
const ai = (re: RegExp, ref: string, z?: Zone[]): Rule => ({ re, role: "ai", ref, z });
const data = (re: RegExp, ref: string, z?: Zone[]): Rule => ({ re, role: "data", ref, z });

const RULES: Record<DocType, Rule[]> = {
  LK: [
    data(/subjektif|anamnesa|anamnesis/, "subjektif", ["kasus"]),
    data(/objektif|pemeriksaan (fisik|umum|penunjang)/, "objektif", ["kasus"]),
    data(/pengkajian|pengumpulan data/, "pengkajian", ["kasus"]),
    ai(/interpretasi|diagnosa kebidanan|diagnosis kebidanan|masalah dan kebutuhan/, "interpretasi", ["kasus"]),
    ai(/potensial/, "potensial", ["kasus"]),
    ai(/tindakan segera|antisipasi|kolaborasi|rujukan/, "segera", ["kasus"]),
    ai(/perencanaan|rencana asuhan|intervensi/, "perencanaan", ["kasus"]),
    data(/implementasi|pelaksanaan/, "implementasi", ["kasus"]),
    data(/evaluasi/, "evaluasi", ["kasus"]),
    ai(/latar belakang/, "latar", ["pendahuluan", "lain"]),
    ai(/tujuan/, "tujuan", ["pendahuluan", "lain"]),
    ai(/konsep (dasar )?asuhan|teori asuhan|manajemen (asuhan )?kebidanan/, "teori_asuhan", ["teori", "lain"]),
    ai(/konsep dasar|konsep teori|landasan teori|teori kasus|tinjauan teori/, "teori_kasus", ["teori", "lain"]),
    ai(/pembahasan|kesenjangan/, "pembahasan", ["pembahasan", "lain"]),
    ai(/kesimpulan/, "kesimpulan", ["penutup", "lain"]),
    ai(/saran/, "saran", ["penutup", "lain"]),
  ],
  LP: [
    ai(/pengertian|definisi/, "pengertian"),
    ai(/etiologi|penyebab|faktor risiko/, "etiologi"),
    ai(/patofisiologi|pathway|woc/, "patofisiologi"),
    ai(/manifestasi|tanda dan gejala|gejala/, "manifestasi"),
    ai(/penunjang|diagnostik/, "penunjang"),
    ai(/penatalaksanaan|penanganan|terapi/, "penatalaksanaan"),
    ai(/komplikasi/, "komplikasi"),
    ai(/pengkajian/, "pengkajian"),
    ai(/interpretasi/, "interpretasi"),
    ai(/potensial/, "potensial"),
    ai(/tindakan segera|antisipasi|kolaborasi/, "segera"),
    ai(/perencanaan|rencana asuhan|intervensi/, "perencanaan"),
    ai(/implementasi|pelaksanaan/, "implementasi"),
    ai(/evaluasi/, "evaluasi"),
  ],
  RJ: [
    data(/identitas/, "identitas_jurnal"),
    ai(/latar belakang/, "latar"),
    ai(/tujuan/, "tujuan"),
    ai(/metode/, "metode"),
    ai(/hasil/, "hasil"),
    ai(/pembahasan|diskusi/, "pembahasan"),
    ai(/kesimpulan|simpulan/, "kesimpulan"),
    ai(/kelebihan|keunggulan/, "kelebihan"),
    ai(/kekurangan|keterbatasan|kelemahan/, "kekurangan"),
    ai(/implikasi|praktik/, "implikasi"),
  ],
};

/** Ubah daftar judul menjadi struktur bagian. Judul yang punya anak hanya menjadi judul (tanpa isi). */
export function buildOutline(docType: DocType, heads: Heading[]): OutlineItem[] {
  let zone: Zone = "lain";
  return heads.slice(0, MAX_OUTLINE).map((h, i) => {
    const norm = normalize(h.text);
    if (h.level === 1) zone = zoneOf(norm);
    const base = { id: `o${i + 1}`, title: h.text, level: h.level, zone };
    const next = heads[i + 1];
    if (next && next.level > h.level) return { ...base, role: "heading" as const };
    const r = RULES[docType].find((x) => (!x.z || x.z.includes(zone)) && x.re.test(norm));
    if (r) return { ...base, role: r.role, ref: r.ref };
    // Bagian kasus yang tidak dikenal berisi data pasien: tidak boleh ditulis AI, diisi mahasiswa sendiri.
    if (docType === "LK" && zone === "kasus") return { ...base, role: "manual" as const };
    return { ...base, role: "ai" as const };
  });
}

// ---------- dari struktur ke definisi bagian ----------

const GUIDE_DATA = "Disusun otomatis dari isian Anda. Tidak ditulis AI.";
const GUIDE_MANUAL = "Bagian ini menyangkut data pasien/kasus sehingga tidak ditulis AI. Ketik sendiri dari data yang sebenarnya.";

function genericSection(docType: DocType, item: OutlineItem): SectionDef {
  const base = { id: item.id, title: item.title, level: item.level, kind: "ai" as const };
  if (docType === "RJ") {
    return {
      ...base,
      guide: "Ringkasan hanya dari teks jurnal yang Anda unggah. Tinjau hasilnya.",
      instruction:
        "Ringkas isi jurnal yang sesuai dengan judul bagian ini. Angka, persentase, dan nilai p hanya boleh disalin persis dari teks jurnal. Bila tidak dijelaskan di jurnal, tulis 'Tidak dijelaskan dalam jurnal.'",
      words: 150,
    };
  }
  if (docType === "LK" && item.zone === "kasus") {
    return {
      ...base,
      guide: "Dirumuskan dari data yang Anda isi. Periksa kesesuaiannya dengan kondisi pasien.",
      instruction:
        "Susun uraian untuk bagian ini HANYA berdasarkan DATA KASUS. Setiap butir harus dapat ditelusuri ke data yang diberikan. Jika data belum cukup, tulis bahwa data belum cukup.",
      words: 150,
      patientSpecific: true,
    };
  }
  if (docType === "LK" && item.zone === "pembahasan") {
    return {
      ...base,
      guide: "Bandingkan teori dengan kasus untuk aspek ini. Tinjau dengan teliti.",
      instruction:
        "Bahas kesesuaian dan kesenjangan antara teori dan kasus untuk aspek yang sesuai dengan judul bagian ini. Rujuk data pasien HANYA dari DATA KASUS. Jangan menambah fakta tentang pasien.",
      words: 250,
      needsCitation: true,
      patientSpecific: true,
    };
  }
  if (docType === "LK" && item.zone === "penutup") {
    return {
      ...base,
      guide: "Ringkasan dari hasil asuhan Anda. Tinjau hasilnya.",
      instruction: "Tulis bagian penutup yang sesuai dengan judul bagian ini berdasarkan DATA KASUS dan hasil asuhan yang tercantum. Jangan menambah fakta baru.",
      words: 100,
      patientSpecific: true,
    };
  }
  return {
    ...base,
    guide: "Judul ini berasal dari template kampus Anda. Tinjau tulisan AI dan sesuaikan dengan kebutuhan.",
    instruction:
      "Uraikan isi bagian ini sesuai dengan judul bagian, dalam konteks kasus/topik dan jenis asuhan secara umum atau teoretis. Jangan menyebut data pasien tertentu.",
    words: 150,
    needsCitation: true,
  };
}

/** Bangun SectionDef dari satu butir struktur. Dipakai klien (tampilan) dan server (instruksi AI). */
export function resolveSection(docType: DocType, item: OutlineItem): SectionDef {
  const base = { id: item.id, title: item.title, level: item.level };
  if (item.role === "heading") return { ...base, kind: "heading", guide: "Judul dari template Anda." };
  if (item.role === "data" && item.ref && DATA_REFS[docType].includes(item.ref)) {
    return { ...base, kind: "data", ref: item.ref, guide: GUIDE_DATA };
  }
  if (item.role !== "ai") return { ...base, kind: "data", manual: true, guide: GUIDE_MANUAL };
  const std = item.ref ? TEMPLATES[docType].sections.find((s) => s.id === item.ref && s.kind === "ai") : undefined;
  if (std) return { ...std, ...base, ref: std.id };
  return genericSection(docType, item);
}

/** Validasi satu butir dari klien. Judul dibersihkan (tanpa baris baru/karakter kontrol). */
export function parseOutlineItem(v: unknown): OutlineItem | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^o\d{1,4}$/.test(o.id)) return null;
  if (typeof o.title !== "string") return null;
  const title = clean(o.title).slice(0, MAX_TITLE);
  if (!title) return null;
  const level = o.level === 1 || o.level === 2 || o.level === 3 ? o.level : null;
  if (!level) return null;
  if (typeof o.role !== "string" || !ROLES.includes(o.role as OutlineRole)) return null;
  const ref = typeof o.ref === "string" && /^[a-z_]{1,30}$/.test(o.ref) ? o.ref : undefined;
  const zone = typeof o.zone === "string" && (ZONES as string[]).includes(o.zone) ? (o.zone as Zone) : "lain";
  return { id: o.id, title, level, role: o.role as OutlineRole, ref, zone };
}

/** Langkah formulir yang perlu tampil. null = semua (struktur bawaan). Hanya LK yang formulirnya berbeda-beda. */
export function visibleStepIds(docType: DocType, outline: OutlineItem[] | null): Set<string> | null {
  if (!outline || docType !== "LK") return null;
  const secs = outline.map((i) => resolveSection(docType, i));
  const needAll = secs.some((s) => s.kind === "ai" && s.patientSpecific);
  const refs = new Set(secs.filter((s) => s.kind === "data" && !s.manual).map((s) => s.ref));
  const ids = new Set<string>(["kasus", "identitas"]);
  if (needAll || refs.has("subjektif") || refs.has("pengkajian")) ids.add("subjektif");
  if (needAll || refs.has("objektif") || refs.has("pengkajian")) ids.add("objektif");
  // T09: data ANC terstruktur (tampil hanya bila jenis asuhan ANC; disaring di formulir).
  if (needAll || refs.has("subjektif") || refs.has("objektif") || refs.has("pengkajian")) ids.add("anc");
  if (needAll || refs.has("implementasi") || refs.has("evaluasi")) ids.add("tindakan");
  return ids;
}

/** Hapus teks bagian dinamis (id "o1", "o2", ...) saat struktur diganti, agar tidak tertukar. */
export function dropDynamicTexts(texts: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(texts).filter(([k]) => !/^o\d+$/.test(k)));
}
