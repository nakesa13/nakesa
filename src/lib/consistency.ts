import type { DocType, Input, Source } from "./types";
import type { SectionDef } from "@/templates/types";
import { extractMarkerIds } from "./citations";
import { SERIAL_KEY, parseSerial } from "./anc";
import type { SharedCase } from "./kasus";

/**
 * Pemeriksaan konsistensi LK, LP, dan Reading Journal. Murni kode (tanpa AI), cepat, dan hasilnya dapat ditelusuri.
 * Hanya menandai; mahasiswa yang memutuskan.
 */

export type Severity = "error" | "warn" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  docs: DocType[];
  title: string;
  detail: string;
}

export interface DocSnap {
  type: DocType;
  /** Sudah ada isian/teks/sumber di draf. Dokumen yang belum dimulai tidak diperiksa. */
  started: boolean;
  /** Isian efektif (identitas, kasus bersama, dan isian draf sudah digabung). */
  input: Input;
  sections: SectionDef[];
  /** Teks bagian yang ditulis/diubah (draf). */
  texts: Record<string, string>;
  sources: Source[];
}

const NAME: Record<DocType, string> = { LP: "LP", LK: "LK", RJ: "Reading Journal" };
const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const STOP = new Set(["dengan", "dalam", "pada", "yang", "dan", "atau", "untuk", "dari", "oleh", "asuhan", "kebidanan", "kasus", "pasien"]);

/** Kata bermakna (>= 4 huruf, bukan kata umum) dari sebuah frasa. */
export function keywords(s: string): string[] {
  return [...new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
}

const isAlnum = (ch: string | undefined): boolean => !!ch && /[a-z0-9]/i.test(ch);

/** Token ditemukan sebagai kata/frasa utuh (bukan bagian dari kata lain). */
export function hasToken(body: string, token: string): boolean {
  if (!token) return false;
  let from = 0;
  for (;;) {
    const i = body.indexOf(token, from);
    if (i < 0) return false;
    if (!isAlnum(body[i - 1]) && !isAlnum(body[i + token.length])) return true;
    from = i + 1;
  }
}

const STEP_LABEL: Record<string, string> = {
  interpretasi: "Interpretasi data dasar",
  potensial: "Diagnosa/masalah potensial",
  segera: "Tindakan segera/kolaborasi",
  perencanaan: "Perencanaan",
  implementasi: "Implementasi",
  evaluasi: "Evaluasi",
};

const IDENTITY: [string, string][] = [
  ["nama", "Nama"],
  ["nim", "NIM"],
  ["prodi", "Program studi"],
  ["kampus", "Kampus"],
  ["pembimbing", "Pembimbing"],
  ["tahun", "Tahun"],
];

/** Data pasien LK yang tidak boleh muncul di LP/Jurnal. */
const PATIENT_FIELDS = ["inisial", "umur", "td", "nadi", "rr", "suhu", "bb", "tb"];

/**
 * T03: kolom ANC terstruktur yang nilainya khas satu pasien (tanggal, usia kehamilan, ukuran). Kolom berisi kata umum
 * (mis. letak "kepala", status "TT3") sengaja tidak dipakai: akan sering salah menandai teori yang sah.
 */
const ANC_LEAK_FIELDS = ["anc_hpht", "anc_tp", "anc_uk", "anc_tfu", "anc_djj"];

/** Nilai pasien dari LK yang dicari di LP/Jurnal: kolom tetap, kolom ANC khas, dan hasil pengukuran serial (berangka, >= 5 karakter). */
function patientTokens(input: Input): string[] {
  const serial = parseSerial(input[SERIAL_KEY]).items.map((i) => i.value).filter((v) => v.trim().length >= 5 && /\d/.test(v));
  const raw = [...PATIENT_FIELDS, ...ANC_LEAK_FIELDS].map((k) => input[k] ?? "").concat(serial);
  return [...new Set(raw.map(norm).filter((t) => t.length >= 3))];
}

const refsOf = (d: DocSnap): Set<string> => new Set(d.sections.filter((s) => s.kind !== "heading").map((s) => s.ref ?? s.id));
const joinTexts = (d: DocSnap): string => Object.values(d.texts).join("\n");

export function checkConsistency(docs: DocSnap[], c: SharedCase): Finding[] {
  const out: Finding[] = [];
  const push = (f: Finding) => out.push(f);
  const active = docs.filter((d) => d.started);
  const get = (t: DocType) => docs.find((d) => d.type === t);
  const lk = get("LK");
  const lp = get("LP");
  const rj = get("RJ");
  const kasus = (c.kasus ?? "").trim();
  const kws = keywords(kasus);

  // 1) kasus bersama
  // Dokumen mandiri boleh punya kasus sendiri (di isiannya); peringatan hanya untuk dokumen yang tidak punya kasus sama sekali.
  const tanpaKasus = active.filter((d) => d.type !== "RJ" && !(d.input.kasus ?? "").trim());
  if (tanpaKasus.length && !kasus) {
    push({ id: "kasus-kosong", severity: "warn", docs: tanpaKasus.map((d) => d.type), title: "Kasus belum diisi", detail: "Isi diagnosis/kasus di langkah Kasus pada LP/LK (atau di halaman Kasus bila dokumen dihubungkan ke kasus bersama) agar dokumen membahas topik yang jelas." });
  }

  // 2) identitas
  for (const [key, label] of IDENTITY) {
    const per = active.map((d) => ({ t: d.type, v: (d.input[key] ?? "").trim() })).filter((x) => x.v);
    if (new Set(per.map((x) => norm(x.v))).size > 1) {
      push({ id: `identitas-${key}`, severity: "warn", docs: per.map((x) => x.t), title: `${label} berbeda antar dokumen`, detail: per.map((x) => `${NAME[x.t]}: "${x.v}"`).join("; ") + ". Samakan di Pengaturan atau di langkah Identitas." });
    }
  }

  // 3) judul tidak menyebut kasus
  if (kws.length) {
    for (const d of active.filter((x) => x.type !== "RJ")) {
      const j = (d.input.judul ?? "").trim();
      if (j && !kws.some((w) => norm(j).includes(w))) {
        push({ id: `judul-${d.type}`, severity: "info", docs: [d.type], title: `Judul ${NAME[d.type]} tidak menyebut kasus`, detail: `Judul "${j}" tidak memuat kata kunci kasus (${kws.slice(0, 4).join(", ")}).` });
      }
    }
  }

  // 4) data pasien LK bocor ke LP / Reading Journal
  if (lk) {
    const toks = patientTokens(lk.input);
    for (const d of active.filter((x) => x.type !== "LK")) {
      const body = norm(joinTexts(d));
      const hits = toks.filter((t) => hasToken(body, t));
      if (hits.length) {
        push({
          id: `data-pasien-${d.type}`,
          severity: d.type === "LP" ? "error" : "warn",
          docs: [d.type, "LK"],
          title: `${NAME[d.type]} memuat data yang tampak milik pasien di LK`,
          detail: `Ditemukan: ${hits.slice(0, 4).map((h) => `"${h}"`).join(", ")}. ${d.type === "LP" ? "LP berisi teori umum, bukan data pasien." : "Pastikan ini memang berasal dari jurnal."}`,
        });
      }
    }
  }

  // 5) sumber yang sama dengan metadata berbeda
  const groups = new Map<string, { t: DocType; s: Source }[]>();
  for (const d of active) {
    for (const s of d.sources) {
      const key = s.doi ? `doi:${s.doi.toLowerCase()}` : `t:${norm(s.title)}`;
      groups.set(key, [...(groups.get(key) ?? []), { t: d.type, s }]);
    }
  }
  for (const [key, list] of groups) {
    if (new Set(list.map((x) => x.t)).size < 2) continue;
    const diffs: string[] = [];
    const vals = (f: (s: Source) => string) => list.map((x) => ({ t: x.t, v: f(x.s).trim() })).filter((x) => x.v);
    const differs = (f: (s: Source) => string) => new Set(vals(f).map((x) => norm(x.v))).size > 1;
    if (differs((s) => s.year)) diffs.push("tahun");
    if (differs((s) => s.authors[0]?.family ?? "")) diffs.push("penulis pertama");
    if (differs((s) => s.journal ?? "")) diffs.push("nama jurnal");
    if (diffs.length) {
      push({ id: `sumber-${key}`, severity: "warn", docs: [...new Set(list.map((x) => x.t))], title: "Sumber yang sama dicatat berbeda", detail: `"${list[0].s.title.slice(0, 80)}": ${diffs.join(", ")} berbeda antar dokumen (${list.map((x) => NAME[x.t]).join(", ")}). Samakan agar daftar pustaka konsisten.` });
    }
  }

  // 6) kesesuaian jurnal dengan kasus
  if (rj?.started && kws.length) {
    const jt = norm(`${rj.input.j_title ?? ""} ${rj.input.j_text ?? ""}`);
    if ((rj.input.j_text ?? "").length >= 500 && !kws.some((w) => jt.includes(w))) {
      push({ id: "jurnal-relevan", severity: "info", docs: ["RJ"], title: "Jurnal mungkin kurang sesuai dengan kasus", detail: `Kata kunci kasus (${kws.slice(0, 4).join(", ")}) tidak ditemukan di judul/teks jurnal. Pastikan jurnal relevan dengan kasus Anda.` });
    }
  }

  // 7) langkah asuhan LK dan LP
  if (lk?.started && lp?.started) {
    const a = refsOf(lk);
    const b = refsOf(lp);
    const onlyLk = Object.keys(STEP_LABEL).filter((k) => a.has(k) && !b.has(k)).map((k) => STEP_LABEL[k]);
    const onlyLp = Object.keys(STEP_LABEL).filter((k) => b.has(k) && !a.has(k)).map((k) => STEP_LABEL[k]);
    if (onlyLk.length || onlyLp.length) {
      push({
        id: "langkah-asuhan",
        severity: "info",
        docs: ["LK", "LP"],
        title: "Langkah asuhan LK dan LP tidak sama",
        detail: [onlyLk.length ? `Ada di LK, tidak di LP: ${onlyLk.join(", ")}.` : "", onlyLp.length ? `Ada di LP, tidak di LK: ${onlyLp.join(", ")}.` : "", "Wajar bila template kedua dokumen berbeda; pastikan sesuai pedoman kampus."].filter(Boolean).join(" "),
      });
    }
  }

  // 8) kelengkapan dan rujukan per dokumen
  for (const d of active) {
    const aiEmpty = d.sections.filter((s) => s.kind === "ai" && !(d.texts[s.id] ?? "").trim()).length;
    const manualEmpty = d.sections.filter((s) => s.manual && !(d.texts[s.id] ?? "").trim()).length;
    if (aiEmpty) push({ id: `ai-kosong-${d.type}`, severity: "warn", docs: [d.type], title: `${NAME[d.type]}: ${aiEmpty} bagian AI belum ditulis`, detail: "Buka langkah Hasil lalu tulis bagian yang masih kosong." });
    if (manualEmpty) push({ id: `manual-kosong-${d.type}`, severity: "warn", docs: [d.type], title: `${NAME[d.type]}: ${manualEmpty} bagian isi-sendiri masih kosong`, detail: "Bagian ini tidak ditulis AI karena menyangkut data pasien. Ketik sendiri di langkah Hasil." });
    const ids = new Set(d.sources.map((s) => s.id));
    const unknown = [...new Set(extractMarkerIds(joinTexts(d)).filter((id) => !ids.has(id)))];
    if (unknown.length) push({ id: `rujukan-${d.type}`, severity: "error", docs: [d.type], title: `${NAME[d.type]}: rujukan tidak ada di daftar sumber`, detail: `Penanda ${unknown.join(", ")} tidak cocok dengan sumber mana pun, jadi tidak akan masuk daftar pustaka.` });
  }

  return out.sort((x, y) => RANK[x.severity] - RANK[y.severity]);
}
