import type { DocType, Input, Source } from "./types";
import type { SectionDef } from "@/templates/types";
import { extractMarkerIds } from "./citations";
import { KOSONG } from "./case";
import { PERLU_REFERENSI } from "./lp";
import { analyzeReferences, findDuplicates, isCitable, sourceStatus } from "./refs";

/**
 * T14: Academic Reviewer. Tinjauan struktur, kelengkapan, bahasa, dan sitasi berbasis aturan tetap (tanpa AI).
 *
 * Batas yang disengaja:
 *  - Setiap temuan punya lokasi, alasan, dan saran. Tidak ada skor tunggal, tidak ada label kelayakan, dan tidak ada
 *    perbaikan otomatis: fungsi ini murni, tidak mengubah teks, dan mahasiswa yang memutuskan.
 *  - Tidak menilai isi klinis atau kebenaran teori (itu urusan T15-T17) dan bukan pengganti dosen pembimbing.
 *  - Aturan bahasa sengaja sempit (pola yang hampir pasti salah) agar jarang salah menandai istilah kebidanan yang sah.
 *  - Aturan pasti sama untuk masukan yang sama. Tiap aturan punya id tetap (REVIEW_RULES) agar bisa diuji dan dievaluasi (T20).
 */

export type ReviewCategory = "struktur" | "kelengkapan" | "bahasa" | "sitasi";
/** perlu = sebaiknya diperbaiki sebelum dikumpulkan; saran = pertimbangkan. Bukan tingkat nilai. */
export type ReviewLevel = "perlu" | "saran";

export interface ReviewLocation {
  /** Id bagian di dokumen; null untuk temuan yang bukan milik satu bagian (sampul, daftar pustaka). */
  sectionId: string | null;
  sectionTitle: string;
  /** Urutan paragraf di bagian itu, mulai dari 1. */
  paragraph?: number;
  /** Potongan teks yang dimaksud (maks. 90 karakter). */
  excerpt?: string;
}

export interface ReviewFinding {
  ruleId: string;
  category: ReviewCategory;
  level: ReviewLevel;
  location: ReviewLocation;
  reason: string;
  suggestion: string;
}

export interface ReviewSection {
  def: SectionDef;
  /** Judul sesudah {kasus} dst. diganti. */
  title: string;
  text: string;
}

export interface ReviewInput {
  docType: DocType;
  sections: ReviewSection[];
  sources: Source[];
  input: Input;
}

export interface ReviewReport {
  findings: ReviewFinding[];
  /** Jumlah temuan per kategori. Hanya hitungan, bukan penilaian. */
  counts: Record<ReviewCategory, number>;
  rulesChecked: string[];
  note: string;
}

export const REVIEW_NOTE = "Tinjauan otomatis dari aturan tetap, tanpa AI. Ini daftar temuan untuk Anda timbang sendiri, bukan penilaian dosen atau pembimbing, dan tidak mengubah teks Anda.";

export const CATEGORY_LABEL: Record<ReviewCategory, string> = {
  struktur: "Struktur",
  kelengkapan: "Kelengkapan",
  bahasa: "Bahasa",
  sitasi: "Sitasi dan rujukan",
};

export const REVIEW_RULES: { id: string; category: ReviewCategory; title: string }[] = [
  { id: "struktur.loncat-tingkat", category: "struktur", title: "Tingkat judul melompat" },
  { id: "struktur.judul-ganda", category: "struktur", title: "Judul bagian kembar" },
  { id: "struktur.judul-tanpa-isi", category: "struktur", title: "Judul tanpa isi di bawahnya" },
  { id: "struktur.penomoran", category: "struktur", title: "Penomoran judul tidak berurutan" },
  { id: "kelengkapan.bagian-kosong", category: "kelengkapan", title: "Bagian belum ditulis" },
  { id: "kelengkapan.belum-diisi", category: "kelengkapan", title: "Isian masih [belum diisi]" },
  { id: "kelengkapan.perlu-referensi", category: "kelengkapan", title: "Paragraf bertanda [perlu referensi]" },
  { id: "kelengkapan.terlalu-pendek", category: "kelengkapan", title: "Bagian jauh lebih pendek dari target" },
  { id: "kelengkapan.identitas", category: "kelengkapan", title: "Identitas sampul belum lengkap" },
  { id: "kelengkapan.judul", category: "kelengkapan", title: "Judul dokumen belum diisi" },
  { id: "bahasa.spasi-ganda", category: "bahasa", title: "Spasi ganda" },
  { id: "bahasa.kalimat-panjang", category: "bahasa", title: "Kalimat sangat panjang" },
  { id: "bahasa.kata-berulang", category: "bahasa", title: "Kata berulang berurutan" },
  { id: "bahasa.huruf-kecil-awal", category: "bahasa", title: "Paragraf diawali huruf kecil" },
  { id: "bahasa.tanpa-tanda-akhir", category: "bahasa", title: "Paragraf tanpa tanda baca akhir" },
  { id: "bahasa.tanda-baca", category: "bahasa", title: "Spasi atau tanda baca yang janggal" },
  { id: "bahasa.tidak-baku", category: "bahasa", title: "Kata tidak baku" },
  { id: "bahasa.sudut-pandang", category: "bahasa", title: "Sudut pandang orang pertama" },
  { id: "sitasi.rujukan-yatim", category: "sitasi", title: "Penanda rujukan tanpa sumber" },
  { id: "sitasi.sumber-tanpa-isi", category: "sitasi", title: "Sumber yang dikutip tidak boleh dijadikan dasar" },
  { id: "sitasi.paragraf-tanpa-rujukan", category: "sitasi", title: "Paragraf teori tanpa rujukan" },
  { id: "sitasi.tanpa-sumber", category: "sitasi", title: "Bagian teori ada tetapi belum ada sumber berisi" },
  { id: "sitasi.sumber-tidak-dikutip", category: "sitasi", title: "Sumber tidak dirujuk di isi" },
  { id: "sitasi.sumber-ganda", category: "sitasi", title: "Sumber ganda" },
  { id: "sitasi.metadata-kurang", category: "sitasi", title: "Metadata sumber yang dikutip kurang" },
  { id: "sitasi.manual", category: "sitasi", title: "Sitasi diketik manual" },
];

// ---------- alat bantu teks ----------

const clean = (s: string): string => s.replace(/\s?\[S\d+(?:\s*[,;]\s*S\d+)*\]/g, "").split(PERLU_REFERENSI).join("");
const words = (s: string): number => clean(s).split(/\s+/).filter(Boolean).length;
const paras = (text: string): string[] =>
  text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
const isTable = (p: string): boolean => p.startsWith("|");
const isList = (p: string): boolean => /^\s*([-*•]|\d+[.)])\s/.test(p);
const isLabel = (p: string): boolean => /^\*\*[^*]+\*\*:?$/.test(p);
const isProse = (p: string): boolean => !isTable(p) && !isList(p) && !isLabel(p);
const flat = (p: string): string => p.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const excerpt = (p: string): string => {
  const t = flat(p);
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
};
/** Teks dalam tanda kutip (ucapan pasien, kutipan jurnal) tidak dinilai gayanya. */
const unquoted = (s: string): string => s.replace(/"[^"\n]{1,300}"/g, " ").replace(/“[^”\n]{1,300}”/g, " ");
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Bagian yang isinya prosa tulisan (AI atau isi sendiri). Bagian data yang disusun kode tidak dinilai bahasanya. */
const isWritten = (s: ReviewSection): boolean => s.def.kind === "ai" || !!s.def.manual;

// ---------- penomoran judul ----------

function roman(s: string): number {
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]];
    const b = v[s[i + 1]];
    n += b && a < b ? -a : a;
  }
  return n;
}

function labelOf(title: string): { kind: "bab" | "huruf" | "angka"; n: number; text: string } | null {
  const bab = /^BAB\s+([IVXLC]+)\b/i.exec(title);
  if (bab) return { kind: "bab", n: roman(bab[1].toUpperCase()), text: `BAB ${bab[1].toUpperCase()}` };
  const h = /^([A-Z])\.\s/.exec(title);
  if (h) return { kind: "huruf", n: h[1].charCodeAt(0) - 64, text: `${h[1]}.` };
  const a = /^(\d{1,2})\.\s/.exec(title);
  if (a) return { kind: "angka", n: Number(a[1]), text: `${a[1]}.` };
  return null;
}

// ---------- kata tidak baku (daftar sempit: slang dan salah eja yang jelas) ----------

/**
 * Sengaja TIDAK memuat "diagnosa" dan "analisa": istilah itu lazim dan dipakai pedoman asuhan kebidanan (mis. SOAP, "Diagnosa/masalah").
 */
const TIDAK_BAKU: Record<string, string> = {
  nggak: "tidak",
  ngga: "tidak",
  gak: "tidak",
  enggak: "tidak",
  udah: "sudah",
  gimana: "bagaimana",
  kalo: "kalau",
  banget: "sangat",
  aja: "saja",
  emang: "memang",
  bikin: "membuat",
  cuma: "hanya",
  resiko: "risiko",
  praktek: "praktik",
  apotik: "apotek",
  ijin: "izin",
  nasehat: "nasihat",
  merubah: "mengubah",
  obyektif: "objektif",
  subyektif: "subjektif",
  frekwensi: "frekuensi",
  kwalitas: "kualitas",
  sistim: "sistem",
  tehnik: "teknik",
  aktifitas: "aktivitas",
  efektifitas: "efektivitas",
  hakekat: "hakikat",
  jaman: "zaman",
};
const TIDAK_BAKU_RE = new RegExp(`(?<![\\p{L}])(${Object.keys(TIDAK_BAKU).join("|")})(?![\\p{L}])`, "giu");

const FIRST_PERSON_RE = /(?<![\p{L}])(saya|aku|kami|kita)(?![\p{L}])/iu;
const REPEAT_RE = /(?<![\p{L}\d])(\p{L}{2,})\s+\1(?![\p{L}\d])/iu;
/** Sitasi gaya APA yang diketik tangan, mis. (Rahma, 2022) atau (WHO, 2020). */
const MANUAL_CITE_RE = /\(([A-Z][\p{L}.'’-]*(?:\s(?:&|dan)\s[A-Z][\p{L}.'’-]*|\set al\.)?),\s*(?:19|20)\d{2}[a-z]?\)/u;

/**
 * Pola salah ketik tanda baca yang hampir pasti keliru. Tanda baca di tabel, daftar, dan teks dalam kutipan tidak diperiksa;
 * URL dan DOI dibuang dulu. Angka tidak ikut ("3,5", "08.30") karena semua pola mensyaratkan huruf di kedua sisi.
 */
const PUNCT_RULES: { re: RegExp; reason: string }[] = [
  { re: /\p{L}[ \t]+[,;:!?]/u, reason: "ada spasi sebelum koma, titik koma, titik dua, atau tanda tanya/seru" },
  { re: /\p{L}[ \t]+\.(?!\.)(?=\s|$)/u, reason: "ada spasi sebelum titik" },
  { re: /,,|;;|::|!!|\?\?|(?<!\.)\.\.(?!\.)/, reason: "tanda baca tertulis dua kali berturut-turut" },
  { re: /\p{L}[,;]\p{L}/u, reason: "tidak ada spasi setelah koma atau titik koma" },
  // {2} (bukan {2,}): cukup dua huruf kecil tepat sebelum titik. Kuantifier rakus membuat pola ini kuadratik pada teks panjang tanpa spasi.
  { re: /\p{Ll}{2}\.\p{Lu}\p{Ll}/u, reason: "tidak ada spasi setelah titik" },
];
const NO_URL_RE = /https?:\/\/\S+|www\.\S+|\b10\.\d{4,9}\/\S+/gi;
/** Kutipan langsung diganti satu huruf (bukan spasi) agar `"x", lalu` tidak terbaca sebagai "spasi sebelum koma". */
const QUOTED_RE = /"[^"\n]{1,300}"|\u201C[^\u201D\n]{1,300}\u201D/g;

const LONG_SENTENCE_WORDS = 60;
const MIN_WORDS_FLOOR = 25;
const MIN_WORDS_RATIO = 0.4;

// ---------- pemeriksa ----------

export function reviewDocument(inp: ReviewInput): ReviewReport {
  const findings: ReviewFinding[] = [];
  const add = (f: ReviewFinding) => findings.push(f);
  const at = (s: ReviewSection, paragraph?: number, text?: string): ReviewLocation => ({
    sectionId: s.def.id,
    sectionTitle: s.title,
    ...(paragraph !== undefined ? { paragraph } : {}),
    ...(text ? { excerpt: excerpt(text) } : {}),
  });
  const secs = inp.sections;
  const idSet = new Set(inp.sources.map((s) => s.id));

  // ===== struktur =====
  secs.forEach((s, i) => {
    if (i > 0 && s.def.level > secs[i - 1].def.level + 1) {
      add({
        ruleId: "struktur.loncat-tingkat",
        category: "struktur",
        level: "saran",
        location: at(s),
        reason: `Judul ini bertingkat ${s.def.level} tepat setelah judul bertingkat ${secs[i - 1].def.level}, tanpa tingkat di antaranya.`,
        suggestion: "Periksa apakah ada judul tingkat di antaranya yang terlewat, atau turunkan tingkat judul ini.",
      });
    }
  });

  const seen = new Map<string, string>();
  for (const s of secs) {
    const key = `${s.def.level}|${norm(s.title)}`;
    if (!norm(s.title)) continue;
    if (seen.has(key)) {
      add({
        ruleId: "struktur.judul-ganda",
        category: "struktur",
        level: "saran",
        location: at(s),
        reason: `Judul "${s.title}" sudah dipakai di bagian lain pada tingkat yang sama.`,
        suggestion: "Beri judul yang berbeda agar pembaca dan daftar isi tidak bingung, atau gabungkan kedua bagian bila isinya sama.",
      });
    } else seen.set(key, s.def.id);
  }

  secs.forEach((s, i) => {
    if (s.def.kind !== "heading") return;
    const next = secs[i + 1];
    if (!next || (next.def.kind === "heading" && next.def.level <= s.def.level)) {
      add({
        ruleId: "struktur.judul-tanpa-isi",
        category: "struktur",
        level: "saran",
        location: at(s),
        reason: next ? `Setelah judul ini langsung muncul judul "${next.title}" tanpa isi di antaranya.` : "Judul ini berada di akhir dokumen tanpa isi di bawahnya.",
        suggestion: "Isi bagian di bawah judul ini, atau hapus judul bila memang tidak diperlukan.",
      });
    }
  });

  const last: Record<number, { kind: string; n: number; text: string } | undefined> = {};
  for (const s of secs) {
    const L = s.def.level;
    const lab = labelOf(s.title);
    const prev = last[L];
    if (lab && prev && prev.kind === lab.kind && lab.n !== prev.n + 1) {
      add({
        ruleId: "struktur.penomoran",
        category: "struktur",
        level: "saran",
        location: at(s),
        reason: `Penomoran "${lab.text}" mengikuti "${prev.text}" pada tingkat judul yang sama${lab.n > prev.n + 1 ? ", ada nomor yang terlewat" : ", urutannya tidak naik satu demi satu"}.`,
        suggestion: "Periksa urutan nomor atau huruf judul pada tingkat ini.",
      });
    }
    last[L] = lab ?? prev;
    for (const k of [1, 2, 3]) if (k > L) last[k] = undefined;
  }

  // ===== kelengkapan =====
  for (const s of secs) {
    if (s.def.kind === "heading") continue;
    const t = s.text.trim();
    if (!t && (s.def.kind === "ai" || s.def.manual)) {
      add({
        ruleId: "kelengkapan.bagian-kosong",
        category: "kelengkapan",
        level: "perlu",
        location: at(s),
        reason: s.def.kind === "ai" ? "Bagian ini belum ditulis." : "Bagian ini diisi sendiri dan masih kosong.",
        suggestion: s.def.kind === "ai" ? "Tulis bagian ini dengan tombol Tulis bagian ini, atau ketik sendiri." : "Ketik sendiri dari data yang sebenarnya.",
      });
      continue;
    }
    if (!t) continue;

    const blanks = t.split(KOSONG).length - 1;
    if (blanks > 0) {
      const line = t.split("\n").find((l) => l.includes(KOSONG)) ?? KOSONG;
      add({
        ruleId: "kelengkapan.belum-diisi",
        category: "kelengkapan",
        level: "perlu",
        location: at(s, undefined, line),
        reason: `${blanks} isian di bagian ini masih ${KOSONG}.`,
        suggestion: "Lengkapi isian di langkah formulir yang sesuai, atau tulis sendiri bila datanya memang belum ada. Jangan dibiarkan kosong saat dikumpulkan.",
      });
    }

    const needRef = t.split(PERLU_REFERENSI).length - 1;
    if (needRef > 0) {
      add({
        ruleId: "kelengkapan.perlu-referensi",
        category: "kelengkapan",
        level: "perlu",
        location: at(s),
        reason: `${needRef} paragraf bertanda ${PERLU_REFERENSI} karena belum ada sumber berisi.`,
        suggestion: "Tambahkan buku atau jurnal beserta isinya di langkah Referensi, lalu tulis ulang bagian ini agar teori memiliki rujukan.",
      });
    }

    if (s.def.kind === "ai") {
      const n = words(t);
      const min = Math.max(MIN_WORDS_FLOOR, Math.round((s.def.words ?? 0) * MIN_WORDS_RATIO));
      if (n < min) {
        add({
          ruleId: "kelengkapan.terlalu-pendek",
          category: "kelengkapan",
          level: "saran",
          location: at(s),
          reason: `Bagian ini hanya ${n} kata${s.def.words ? `, target sekitar ${s.def.words} kata` : ""}.`,
          suggestion: "Kembangkan bagian ini sesuai panduan bagian, atau pastikan ringkasnya memang cukup untuk pedoman kampus Anda.",
        });
      }
    }
  }

  const idn = inp.input;
  const missingId = (
    [
      ["nama", "nama"],
      ["nim", "NIM"],
      ["prodi", "program studi"],
      ["kampus", "kampus"],
      ["tahun", "tahun"],
    ] as const
  )
    .filter(([k]) => !(idn[k] ?? "").trim())
    .map(([, label]) => label);
  if (missingId.length) {
    add({
      ruleId: "kelengkapan.identitas",
      category: "kelengkapan",
      level: "saran",
      location: { sectionId: null, sectionTitle: "Sampul" },
      reason: `Identitas pada sampul belum lengkap: ${missingId.join(", ")}.`,
      suggestion: "Isi identitas di menu Pengaturan agar sampul tidak kosong.",
    });
  }
  if (inp.docType !== "RJ" && !(idn.judul ?? "").trim()) {
    add({
      ruleId: "kelengkapan.judul",
      category: "kelengkapan",
      level: "saran",
      location: { sectionId: null, sectionTitle: "Sampul" },
      reason: "Judul dokumen belum diisi, sehingga sampul memakai judul otomatis atau nama dokumen.",
      suggestion: "Isi judul di langkah Kasus (atau Topik) bila kampus Anda mensyaratkan judul tertentu.",
    });
  }

  // ===== bahasa =====
  for (const s of secs) {
    if (!isWritten(s) || !s.text.trim()) continue;
    const ps = paras(s.text);

    const dbl = ps.filter((p) => !isTable(p) && /[^\S\n]{2,}/.test(p)).length;
    if (dbl > 0) {
      add({
        ruleId: "bahasa.spasi-ganda",
        category: "bahasa",
        level: "saran",
        location: at(s),
        reason: `${dbl} paragraf memuat spasi ganda.`,
        suggestion: "Hapus spasi berlebih; spasi ganda terlihat tidak rapi setelah dicetak.",
      });
    }

    ps.forEach((p, idx) => {
      if (!isProse(p)) return;
      const body = unquoted(clean(p));

      const long = body.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).find((sent) => sent.split(/\s+/).filter(Boolean).length > LONG_SENTENCE_WORDS);
      if (long) {
        add({
          ruleId: "bahasa.kalimat-panjang",
          category: "bahasa",
          level: "saran",
          location: at(s, idx + 1, long),
          reason: `Ada kalimat dengan lebih dari ${LONG_SENTENCE_WORDS} kata.`,
          suggestion: "Pecah menjadi dua atau tiga kalimat agar mudah dibaca dan tidak ambigu.",
        });
      }

      const rep = REPEAT_RE.exec(body);
      if (rep) {
        add({
          ruleId: "bahasa.kata-berulang",
          category: "bahasa",
          level: "saran",
          location: at(s, idx + 1, rep[0]),
          reason: `Kata "${rep[1]}" tertulis dua kali berturut-turut.`,
          suggestion: "Hapus salah satunya bila itu salah ketik. Bila memang kata ulang, tulis dengan tanda hubung.",
        });
      }

      const first = /^([\p{L}]+)/u.exec(flat(p));
      if (first && first[1].length >= 3 && first[1] === first[1].toLowerCase()) {
        add({
          ruleId: "bahasa.huruf-kecil-awal",
          category: "bahasa",
          level: "saran",
          location: at(s, idx + 1, p),
          reason: `Paragraf diawali huruf kecil ("${first[1]}").`,
          suggestion: "Awali paragraf dengan huruf kapital, atau sambungkan ke paragraf sebelumnya bila ini lanjutan kalimat.",
        });
      }

      const plain = clean(p).replace(QUOTED_RE, "Q").replace(NO_URL_RE, "U");
      for (const rule of PUNCT_RULES) {
        const m = rule.re.exec(plain);
        if (!m) continue;
        add({
          ruleId: "bahasa.tanda-baca",
          category: "bahasa",
          level: "saran",
          location: at(s, idx + 1, plain.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25)),
          reason: `Kemungkinan salah ketik pada tanda baca: ${rule.reason}.`,
          suggestion: "Perbaiki spasi atau tanda bacanya agar teks tampak rapi; abaikan bila bagian itu singkatan, rumus, atau kutipan.",
        });
        break; // satu temuan per paragraf; pola berikutnya muncul lagi setelah yang ini diperbaiki
      }

      const t = clean(p).trim();
      if (t.length >= 60 && !/[.!?:;)\]"”…]$/.test(t)) {
        add({
          ruleId: "bahasa.tanpa-tanda-akhir",
          category: "bahasa",
          level: "saran",
          location: at(s, idx + 1, t.slice(-90)),
          reason: "Paragraf tidak diakhiri tanda baca; teks mungkin terpotong.",
          suggestion: "Baca paragraf sampai akhir, lengkapi kalimatnya, dan tutup dengan tanda baca.",
        });
      }
    });

    const body = unquoted(clean(s.text));
    const baku = new Map<string, number>();
    for (const m of body.matchAll(TIDAK_BAKU_RE)) baku.set(m[1].toLowerCase(), (baku.get(m[1].toLowerCase()) ?? 0) + 1);
    if (baku.size) {
      const list = [...baku].slice(0, 6).map(([w, n]) => `${w} → ${TIDAK_BAKU[w]}${n > 1 ? ` (${n}×)` : ""}`);
      add({
        ruleId: "bahasa.tidak-baku",
        category: "bahasa",
        level: "saran",
        location: at(s),
        reason: `Kata tidak baku atau bahasa lisan: ${list.join("; ")}.`,
        suggestion: "Ganti dengan bentuk baku (KBBI) kecuali kata itu bagian dari kutipan langsung.",
      });
    }

    const fp = FIRST_PERSON_RE.exec(body);
    if (fp) {
      const para = ps.findIndex((p) => FIRST_PERSON_RE.test(unquoted(clean(p))));
      add({
        ruleId: "bahasa.sudut-pandang",
        category: "bahasa",
        level: "saran",
        location: at(s, para >= 0 ? para + 1 : undefined, para >= 0 ? ps[para] : undefined),
        reason: `Memakai sudut pandang orang pertama ("${fp[1]}").`,
        suggestion: 'Tulis dengan kalimat ilmiah yang netral, mis. "penulis" atau bentuk pasif, kecuali pedoman kampus Anda mengizinkan.',
      });
    }
  }

  // ===== sitasi =====
  const byId = new Map(inp.sources.map((s) => [s.id, s]));
  const citedFirst = new Map<string, { s: ReviewSection; paragraph: number }>();
  for (const s of secs) {
    if (s.def.kind === "heading") continue;
    paras(s.text).forEach((p, idx) => {
      for (const id of extractMarkerIds(p)) if (!citedFirst.has(id)) citedFirst.set(id, { s, paragraph: idx + 1 });
    });
  }

  for (const s of secs) {
    if (s.def.kind === "heading") continue;
    paras(s.text).forEach((p, idx) => {
      const unknown = [...new Set(extractMarkerIds(p).filter((id) => !idSet.has(id)))];
      if (unknown.length) {
        add({
          ruleId: "sitasi.rujukan-yatim",
          category: "sitasi",
          level: "perlu",
          location: at(s, idx + 1, p),
          reason: `Penanda ${unknown.join(", ")} tidak cocok dengan sumber mana pun, jadi tidak akan menjadi sitasi dan tidak masuk daftar pustaka.`,
          suggestion: "Tambahkan sumbernya di langkah Referensi, ganti dengan penanda sumber yang ada, atau hapus penandanya.",
        });
      }
    });
  }

  const refs = analyzeReferences(
    secs.filter((s) => s.def.kind !== "heading").map((s) => s.text),
    inp.sources
  );

  for (const id of refs.citedNotCitable) {
    const src = byId.get(id)!;
    const where = citedFirst.get(id);
    const st = sourceStatus(src);
    add({
      ruleId: "sitasi.sumber-tanpa-isi",
      category: "sitasi",
      level: "perlu",
      location: where ? at(where.s, where.paragraph) : { sectionId: null, sectionTitle: "Daftar pustaka" },
      reason: `Sumber ${id} ("${src.title.slice(0, 60)}") dikutip di isi. Catatan sumber: ${st.reasons[0] ?? "isinya belum tersedia."} Kutipan ini tidak bisa diperiksa terhadap isi sumber.`,
      suggestion: "Lampirkan isi sumber di langkah Referensi, atau periksa sendiri bahwa pernyataan itu benar-benar ada di sumbernya.",
    });
  }

  const citable = inp.sources.filter(isCitable);
  const theory = secs.filter((s) => s.def.kind === "ai" && s.def.needsCitation && s.text.trim());

  if (inp.docType !== "RJ" && theory.length && !citable.length) {
    add({
      ruleId: "sitasi.tanpa-sumber",
      category: "sitasi",
      level: "perlu",
      location: { sectionId: null, sectionTitle: "Daftar pustaka" },
      reason: `Ada ${theory.length} bagian teori, tetapi belum ada sumber berisi yang bisa dirujuk.`,
      suggestion: "Tambahkan buku, pedoman, atau jurnal beserta isinya di langkah Referensi, lalu tulis ulang bagian teori.",
    });
  }

  if (citable.length) {
    for (const s of theory) {
      paras(s.text).forEach((p, idx) => {
        if (isTable(p) || isLabel(p)) return;
        if (clean(p).length < 80 || extractMarkerIds(p).length > 0 || p.includes(PERLU_REFERENSI)) return;
        add({
          ruleId: "sitasi.paragraf-tanpa-rujukan",
          category: "sitasi",
          level: "saran",
          location: at(s, idx + 1, p),
          reason: "Paragraf teori ini belum merujuk sumber mana pun.",
          suggestion: "Tulis ulang bagian ini dengan sumber dilampirkan, atau tambahkan penanda sumber [S#] bila isinya memang berasal dari sumber Anda.",
        });
      });
    }
  }

  if (inp.docType !== "RJ" && refs.uncited.length) {
    const shown = refs.uncited.slice(0, 5).join(", ") + (refs.uncited.length > 5 ? ", …" : "");
    add({
      ruleId: "sitasi.sumber-tidak-dikutip",
      category: "sitasi",
      level: "saran",
      location: { sectionId: null, sectionTitle: "Daftar pustaka" },
      reason: `${refs.uncited.length} sumber tidak dirujuk di isi dan tidak akan masuk daftar pustaka: ${shown}.`,
      suggestion: "Rujuk sumber itu di bagian yang relevan, atau hapus dari daftar bila memang tidak dipakai.",
    });
  }

  for (const g of findDuplicates(inp.sources)) {
    add({
      ruleId: "sitasi.sumber-ganda",
      category: "sitasi",
      level: "saran",
      location: { sectionId: null, sectionTitle: "Daftar pustaka" },
      reason: `Sumber ${g.ids.join(", ")} tampak sama (${g.by === "doi" ? "DOI sama" : "judul, tahun, dan penulis pertama sama"}).`,
      suggestion: "Gabungkan menjadi satu sumber dan rapikan penandanya agar daftar pustaka tidak memuat entri kembar.",
    });
  }

  for (const id of refs.cited) {
    const src = byId.get(id)!;
    const gaps = [!src.year.trim() && 'tahun kosong (tertulis "n.d.")', src.authors.length === 0 && "penulis kosong (sitasi memakai judul)"].filter(Boolean);
    if (gaps.length) {
      const where = citedFirst.get(id);
      add({
        ruleId: "sitasi.metadata-kurang",
        category: "sitasi",
        level: "saran",
        location: where ? at(where.s, where.paragraph) : { sectionId: null, sectionTitle: "Daftar pustaka" },
        reason: `Sumber ${id} yang dikutip: ${gaps.join("; ")}.`,
        suggestion: "Lengkapi tahun dan penulis di langkah Referensi agar sitasi dan daftar pustaka benar.",
      });
    }
  }

  for (const s of secs) {
    if (!isWritten(s)) continue;
    paras(s.text).forEach((p, idx) => {
      const m = MANUAL_CITE_RE.exec(p);
      if (!m) return;
      add({
        ruleId: "sitasi.manual",
        category: "sitasi",
        level: "saran",
        location: at(s, idx + 1, m[0]),
        reason: `Sitasi ${m[0]} diketik manual; sumbernya tidak terhubung ke daftar pustaka otomatis.`,
        suggestion: "Tambahkan sumbernya di langkah Referensi dan pakai penanda [S#], supaya sitasi dan daftar pustaka dibuat otomatis dan konsisten.",
      });
    });
  }

  const counts: Record<ReviewCategory, number> = { struktur: 0, kelengkapan: 0, bahasa: 0, sitasi: 0 };
  for (const f of findings) counts[f.category]++;
  return { findings, counts, rulesChecked: REVIEW_RULES.map((r) => r.id), note: REVIEW_NOTE };
}
