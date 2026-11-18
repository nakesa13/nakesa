import type { DocType, Input, SectionWarnings, Source } from "./types";
import type { SectionDef } from "@/templates/types";
import { TEMPLATES } from "@/templates";
import { extractMarkerIds, parseAuthors } from "./citations";
import { parseBlocks } from "./markup";

export const KOSONG = "[belum diisi]";

const val = (input: Input, id: string): string => (input[id] ?? "").trim();
const cell = (s: string): string => (s.replace(/\s*\n\s*/g, "; ").replace(/\|/g, "/").trim() || KOSONG);

/** Teks bebas -> paragraf terpisah (satu baris = satu paragraf). */
function asParas(text: string): string {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines.join("\n\n") : KOSONG;
}

/** Satu tindakan per baris -> daftar bernomor. */
function asNumbered(text: string): string {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return KOSONG;
  return lines.map((l, i) => `${i + 1}. ${l.replace(/^\d+[.)]\s*/, "")}`).join("\n");
}

function table(rows: [string, string][], head: [string, string] = ["Data", "Keterangan"]): string {
  return [`| ${head[0]} | ${head[1]} |`, ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`)].join("\n");
}

function labelled(label: string, text: string): string {
  return `**${label}**\n\n${asParas(text)}`;
}

// ---------- bagian yang disusun kode (bukan AI) ----------

export function journalSourceFromInput(input: Input): Source | null {
  const title = val(input, "j_title");
  if (!title) return null;
  return {
    id: "S1",
    type: "jurnal",
    title,
    authors: parseAuthors(val(input, "j_authors")),
    year: val(input, "j_year"),
    journal: val(input, "j_journal") || undefined,
    volume: val(input, "j_volume") || undefined,
    issue: val(input, "j_issue") || undefined,
    pages: val(input, "j_pages") || undefined,
    doi: val(input, "j_doi") || undefined,
    url: val(input, "j_url") || undefined,
    content: val(input, "j_text") || undefined,
    origin: val(input, "j_origin") === "crossref" ? "crossref" : "manual",
    verified: val(input, "j_origin") === "crossref",
  };
}

export function renderDataSection(docType: DocType, sectionId: string, input: Input): string {
  // Tahap B: judul "Pengkajian" tanpa pemisahan subjektif/objektif di template kampus.
  if (docType === "LK" && sectionId === "pengkajian") {
    return [renderDataSection("LK", "subjektif", input), renderDataSection("LK", "objektif", input)].join("\n\n");
  }
  if (docType === "LK") {
    switch (sectionId) {
      case "subjektif":
        return [
          "**Identitas Pasien**",
          table([
            ["Inisial", val(input, "inisial")],
            ["Umur", val(input, "umur")],
            ["Pendidikan", val(input, "pendidikan")],
            ["Pekerjaan", val(input, "pekerjaan")],
            ["Tanggal pengkajian", val(input, "tanggal")],
            ["Tempat", val(input, "tempat")],
          ]),
          labelled("Keluhan utama", val(input, "keluhan_utama")),
          labelled("Riwayat kebidanan", val(input, "riwayat_obstetri")),
          labelled("Riwayat saat ini", val(input, "riwayat_sekarang")),
          labelled("Riwayat kesehatan", val(input, "riwayat_kesehatan")),
          labelled("Pola kebiasaan sehari-hari", val(input, "pola_kebiasaan")),
          labelled("Data psikososial dan budaya", val(input, "psikososial")),
        ].join("\n\n");
      case "objektif":
        return [
          "**Pemeriksaan Umum**",
          table(
            [
              ["Keadaan umum", val(input, "keadaan_umum")],
              ["Kesadaran", val(input, "kesadaran")],
              ["Tekanan darah", val(input, "td")],
              ["Nadi", val(input, "nadi")],
              ["Pernapasan", val(input, "rr")],
              ["Suhu", val(input, "suhu")],
              ["Berat badan", val(input, "bb")],
              ["Tinggi badan", val(input, "tb")],
            ],
            ["Parameter", "Hasil"]
          ),
          labelled("Pemeriksaan fisik", val(input, "pemeriksaan_fisik")),
          labelled("Pemeriksaan kebidanan/bayi", val(input, "pemeriksaan_khusus")),
          labelled("Pemeriksaan penunjang", val(input, "penunjang")),
        ].join("\n\n");
      case "implementasi":
        return asNumbered(val(input, "implementasi"));
      case "evaluasi":
        return asParas(val(input, "evaluasi"));
    }
  }
  if (docType === "RJ" && sectionId === "identitas_jurnal") {
    const vol = [val(input, "j_volume") && `Volume ${val(input, "j_volume")}`, val(input, "j_issue") && `Nomor ${val(input, "j_issue")}`, val(input, "j_pages") && `Halaman ${val(input, "j_pages")}`]
      .filter(Boolean)
      .join(", ");
    return table(
      [
        ["Judul", val(input, "j_title")],
        ["Penulis", val(input, "j_authors")],
        ["Tahun terbit", val(input, "j_year")],
        ["Nama jurnal", val(input, "j_journal")],
        ["Volume, nomor, halaman", vol],
        ["DOI/URL", val(input, "j_doi") ? `https://doi.org/${val(input, "j_doi")}` : val(input, "j_url")],
      ],
      ["Unsur", "Keterangan"]
    );
  }
  return "";
}

// ---------- konteks untuk AI ----------

/** Blok DATA KASUS: semua isian form apa adanya (kosong = [belum diisi]). */
export function caseBlock(docType: DocType, input: Input): string {
  const tpl = TEMPLATES[docType];
  const lines: string[] = [];
  for (const step of tpl.steps) {
    if (step.id === "identitas") continue;
    for (const f of step.fields) {
      if (f.type === "journal" || f.id === "judul") continue;
      lines.push(`${f.label}: ${val(input, f.id) || KOSONG}`);
    }
  }
  return lines.join("\n");
}

// ---------- pemeriksaan keluaran ----------

const NUM = /\d+(?:[.,]\d+)?(?:\s?\/\s?\d+(?:[.,]\d+)?)?/g;
const NUM_UNIT = new RegExp(
  `(\\d+(?:[.,]\\d+)?(?:\\s?\\/\\s?\\d+(?:[.,]\\d+)?)?)\\s?(mmHg|x\\/menit|kali\\/menit|°C|ºC|derajat|gram|gr|kg|cm|mg|mcg|g\\/dL|gr\\/dl|mL|ml|IU|cc|mEq|minggu|%)`,
  "gi"
);

const normNum = (s: string): string => s.replace(/\s/g, "").replace(/,/g, ".");

/** Angka klinis (dengan satuan) di keluaran yang tidak ada di isian mahasiswa. */
export function findUnsupportedNumbers(output: string, corpus: string): string[] {
  const known = new Set<string>();
  for (const m of corpus.matchAll(NUM)) known.add(normNum(m[0]));
  const bad = new Set<string>();
  for (const m of output.matchAll(NUM_UNIT)) {
    if (!known.has(normNum(m[1]))) bad.add(`${m[1].trim()} ${m[2]}`);
  }
  return [...bad];
}

/** Semua angka (selain 1 digit dan penomoran) di keluaran yang tidak ada di teks sumber. */
export function findUnsupportedAny(output: string, corpus: string): string[] {
  const clean = output
    .replace(/\[S\d+(?:\s*[,;]\s*S\d+)*\]/g, " ")
    .replace(/^\s*\d+[.)]\s/gm, "");
  const known = new Set<string>();
  for (const m of corpus.matchAll(NUM)) known.add(normNum(m[0]));
  const bad = new Set<string>();
  for (const m of clean.matchAll(NUM)) {
    const n = normNum(m[0]);
    if (/^\d$/.test(n)) continue;
    if (!known.has(n)) bad.add(m[0].trim());
  }
  return [...bad];
}

export function analyzeSection(
  docType: DocType,
  def: SectionDef,
  text: string,
  input: Input,
  sources: Source[]
): SectionWarnings {
  const ids = new Set(sources.map((s) => s.id));
  const unknownMarkers = [...new Set(extractMarkerIds(text).filter((id) => !ids.has(id)))];

  let uncitedParagraphs = 0;
  if (def.kind === "ai" && def.needsCitation) {
    for (const b of parseBlocks(text)) {
      const body = b.t === "p" ? b.text : b.t === "ul" || b.t === "ol" ? b.items.join(" ") : "";
      if (body.length >= 80 && extractMarkerIds(body).length === 0) uncitedParagraphs++;
    }
  }

  let unsupportedNumbers: string[] = [];
  if (docType === "LK" && def.kind === "ai" && def.patientSpecific) {
    const corpus = caseBlock("LK", input) + "\n" + Object.values(input).join("\n");
    unsupportedNumbers = findUnsupportedNumbers(text, corpus);
  }
  if (docType === "RJ" && def.kind === "ai") {
    unsupportedNumbers = findUnsupportedAny(text, val(input, "j_text"));
  }
  return { unknownMarkers, uncitedParagraphs, unsupportedNumbers };
}
