/**
 * T09: data ANC terstruktur dan pengukuran serial untuk Laporan Kasus.
 *
 * Prinsip:
 * - Semua nilai berasal dari isian mahasiswa. Kode tidak menghitung, melengkapi, atau menebak nilai klinis.
 * - Kolom kosong ditulis "[belum diisi]".
 * - Pengukuran serial bertimestamp; menambah pengukuran TIDAK PERNAH menimpa yang sudah ada
 *   (dua pengukuran sejenis pada waktu yang sama tetap menjadi dua baris).
 * - Modul ini murni (tanpa React/AI) supaya mudah diuji.
 */
import type { Input } from "./types";

export const BELUM_DIISI = "[belum diisi]";

/** Kunci isian yang menyimpan pengukuran serial (JSON dalam satu string, agar tetap berupa Input biasa). */
export const SERIAL_KEY = "ukur_serial";

export interface AncField {
  id: string;
  label: string;
  group: "subjektif" | "objektif";
}

/** Kolom ANC terstruktur. Urutan = urutan tampil di dokumen. */
export const ANC_FIELDS: AncField[] = [
  { id: "anc_hpht", label: "HPHT", group: "subjektif" },
  { id: "anc_tp", label: "Taksiran persalinan (TP)", group: "subjektif" },
  { id: "anc_gravida", label: "Gravida", group: "subjektif" },
  { id: "anc_para", label: "Para", group: "subjektif" },
  { id: "anc_abortus", label: "Abortus", group: "subjektif" },
  { id: "anc_uk", label: "Usia kehamilan", group: "subjektif" },
  { id: "anc_kunjungan", label: "Kunjungan ANC ke", group: "subjektif" },
  { id: "anc_tt", label: "Status imunisasi TT", group: "subjektif" },
  { id: "anc_fe", label: "Tablet tambah darah (Fe)", group: "subjektif" },
  { id: "anc_tfu", label: "Tinggi fundus uteri (TFU)", group: "objektif" },
  { id: "anc_djj", label: "Denyut jantung janin (DJJ)", group: "objektif" },
  { id: "anc_letak", label: "Letak / presentasi janin", group: "objektif" },
];

/** Semua id isian khusus data pasien ANC (dipakai daftar kolom pasien T07). */
export const ANC_FIELD_IDS: string[] = [...ANC_FIELDS.map((f) => f.id), SERIAL_KEY];

export type MeasureKind = "td" | "nadi" | "rr" | "suhu" | "bb" | "djj" | "tfu" | "hb" | "lila";

export const MEASURE_KINDS: { id: MeasureKind; label: string; unit: string; placeholder: string }[] = [
  { id: "td", label: "Tekanan darah", unit: "mmHg", placeholder: "mis. 110/70" },
  { id: "nadi", label: "Nadi", unit: "x/menit", placeholder: "mis. 80" },
  { id: "rr", label: "Pernapasan", unit: "x/menit", placeholder: "mis. 20" },
  { id: "suhu", label: "Suhu", unit: "°C", placeholder: "mis. 36,5" },
  { id: "bb", label: "Berat badan", unit: "kg", placeholder: "mis. 60" },
  { id: "djj", label: "DJJ", unit: "x/menit", placeholder: "mis. 140" },
  { id: "tfu", label: "TFU", unit: "cm", placeholder: "mis. 28" },
  { id: "hb", label: "Hb", unit: "g/dL", placeholder: "mis. 10,2" },
  { id: "lila", label: "LiLA", unit: "cm", placeholder: "mis. 24" },
];

export interface Measurement {
  id: string; // "m1", "m2", ... unik, tidak dipakai ulang di satu daftar
  /** Waktu pengukuran, waktu setempat tanpa zona: "YYYY-MM-DDTHH:mm". */
  at: string;
  kind: MeasureKind;
  /** Hasil persis seperti yang diketik mahasiswa. */
  value: string;
  note?: string;
}

export const MAX_MEASUREMENTS = 100;
export const MAX_VALUE = 40;
export const MAX_NOTE = 200;

const KIND_IDS = MEASURE_KINDS.map((k) => k.id) as string[];
const kindMeta = (id: string) => MEASURE_KINDS.find((k) => k.id === id);

/** Asuhan kehamilan (ANC)? Sama dengan aturan telaah klinis. */
export const isAnc = (jenis: string | undefined): boolean => /kehamilan|\banc\b/i.test(jenis ?? "");

// ---------- waktu ----------

const TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** Format "YYYY-MM-DDTHH:mm" dengan tanggal yang benar-benar ada. */
export function validTimestamp(at: string): boolean {
  const m = TS.exec(at);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || h > 23 || mi > 59) return false;
  return d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** "2026-11-24T08:30" -> "24 November 2026 08.30" */
export function formatAt(at: string): string {
  const m = TS.exec(at);
  if (!m) return at;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]} ${m[4]}.${m[5]}`;
}

// ---------- daftar pengukuran serial ----------

export interface ParsedSerial {
  items: Measurement[];
  /** Entri yang tidak sah dan dibuang saat membaca. */
  dropped: number;
  /** Isi bukan JSON daftar yang sah. */
  corrupt: boolean;
}

export function parseSerial(raw: string | undefined): ParsedSerial {
  if (!raw || !raw.trim()) return { items: [], dropped: 0, corrupt: false };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { items: [], dropped: 0, corrupt: true };
  }
  if (!Array.isArray(data)) return { items: [], dropped: 0, corrupt: true };

  let dropped = 0;
  const valid: { id?: string; m: Omit<Measurement, "id"> }[] = [];
  for (const x of data) {
    if (valid.length >= MAX_MEASUREMENTS) {
      dropped++;
      continue;
    }
    if (!x || typeof x !== "object" || Array.isArray(x)) {
      dropped++;
      continue;
    }
    const o = x as Record<string, unknown>;
    const value = typeof o.value === "string" ? o.value.trim() : "";
    if (typeof o.at !== "string" || !validTimestamp(o.at) || typeof o.kind !== "string" || !KIND_IDS.includes(o.kind) || !value || value.length > MAX_VALUE) {
      dropped++;
      continue;
    }
    const note = typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, MAX_NOTE) : undefined;
    valid.push({ id: typeof o.id === "string" && /^m\d{1,6}$/.test(o.id) ? o.id : undefined, m: { at: o.at, kind: o.kind as MeasureKind, value, ...(note ? { note } : {}) } });
  }

  // Id harus unik; entri tanpa id atau berid ganda mendapat id baru (data tidak dibuang).
  const used = new Set<string>();
  let next = 1;
  for (const v of valid) if (v.id) next = Math.max(next, Number(v.id.slice(1)) + 1);
  const items: Measurement[] = valid.map((v) => {
    let id = v.id;
    if (!id || used.has(id)) id = `m${next++}`;
    used.add(id);
    return { id, ...v.m };
  });
  return { items, dropped, corrupt: false };
}

export function serializeSerial(items: Measurement[]): string {
  return items.length ? JSON.stringify(items) : "";
}

export interface NewMeasurement {
  at: string;
  kind: string;
  value: string;
  note?: string;
}

/** Tambah satu pengukuran. Tidak pernah mengganti entri yang ada; daftar lama dikembalikan utuh bila ada galat. */
export function addMeasurement(items: Measurement[], n: NewMeasurement): { items: Measurement[]; error?: string } {
  const value = n.value.trim();
  if (!validTimestamp(n.at)) return { items, error: "Isi tanggal dan jam pengukuran dengan benar." };
  if (!KIND_IDS.includes(n.kind)) return { items, error: "Pilih jenis pemeriksaan." };
  if (!value) return { items, error: "Hasil pengukuran wajib diisi." };
  if (value.length > MAX_VALUE) return { items, error: `Hasil terlalu panjang (maks. ${MAX_VALUE} karakter).` };
  if (items.length >= MAX_MEASUREMENTS) return { items, error: `Batas ${MAX_MEASUREMENTS} pengukuran tercapai.` };
  const note = n.note?.trim().slice(0, MAX_NOTE);
  const next = items.reduce((mx, i) => Math.max(mx, Number(i.id.slice(1)) || 0), 0) + 1;
  const m: Measurement = { id: `m${next}`, at: n.at, kind: n.kind as MeasureKind, value, ...(note ? { note } : {}) };
  return { items: [...items, m] };
}

export function removeMeasurement(items: Measurement[], id: string): Measurement[] {
  return items.filter((i) => i.id !== id);
}

/** Urut menurut waktu; waktu sama diurut menurut urutan pencatatan. */
export function sortMeasurements(items: Measurement[]): Measurement[] {
  const seq = (i: Measurement) => Number(i.id.slice(1)) || 0;
  return [...items].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : seq(a) - seq(b)));
}

// ---------- penyusunan teks (oleh kode, bukan AI) ----------

const cell = (s: string): string => s.replace(/\s*\n\s*/g, "; ").replace(/\|/g, "/").trim();
const val = (input: Input, id: string): string => (input[id] ?? "").trim();

function mdTable(head: string[], rows: string[][]): string {
  return [`| ${head.join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

const labelOf = (kind: string): string => {
  const k = kindMeta(kind);
  return k ? `${k.label} (${k.unit})` : kind;
};

/** Tabel pengukuran serial, atau "[belum diisi]". */
export function serialTable(items: Measurement[]): string {
  if (!items.length) return BELUM_DIISI;
  return mdTable(
    ["Waktu", "Pemeriksaan", "Hasil", "Keterangan"],
    sortMeasurements(items).map((i) => [formatAt(i.at), labelOf(i.kind), i.value, i.note ?? "-"])
  );
}

/** Bentuk teks polos untuk DATA KASUS yang dikirim ke AI. */
export function serialText(raw: string | undefined): string {
  const { items } = parseSerial(raw);
  if (!items.length) return BELUM_DIISI;
  return sortMeasurements(items)
    .map((i) => `- ${formatAt(i.at)} | ${kindMeta(i.kind)?.label ?? i.kind}: ${i.value}${i.note ? ` (${i.note})` : ""}`)
    .join("\n");
}

/** Ada data ANC (jenis asuhan ANC, atau salah satu kolom ANC/pengukuran serial terisi)? */
export function hasAncData(input: Input): boolean {
  return isAnc(input.jenis_asuhan) || ANC_FIELD_IDS.some((id) => val(input, id) !== "");
}

/** Blok subjektif ANC; "" bila bukan data ANC. */
export function ancSubjektifBlock(input: Input): string {
  if (!hasAncData(input)) return "";
  const rows = ANC_FIELDS.filter((f) => f.group === "subjektif").map((f) => [f.label, val(input, f.id) || BELUM_DIISI]);
  return ["**Riwayat Kehamilan Saat Ini (ANC)**", mdTable(["Data", "Keterangan"], rows)].join("\n\n");
}

/** Blok objektif ANC termasuk pengukuran serial; "" bila bukan data ANC. */
export function ancObjektifBlock(input: Input): string {
  if (!hasAncData(input)) return "";
  const rows = ANC_FIELDS.filter((f) => f.group === "objektif").map((f) => [f.label, val(input, f.id) || BELUM_DIISI]);
  return [
    "**Pemeriksaan Kebidanan Terstruktur (ANC)**",
    mdTable(["Parameter", "Hasil"], rows),
    "**Pengukuran Serial**",
    serialTable(parseSerial(input[SERIAL_KEY]).items),
  ].join("\n\n");
}

// ---------- tanggal di keluaran AI ----------

const DATE_RES: { re: RegExp; key: (m: RegExpExecArray) => string }[] = [
  { re: new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${MONTHS.join("|")})\\s+(\\d{4})(?!\\d)`, "gi"), key: (m) => `${Number(m[1])}-${MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()) + 1}-${m[3]}` },
  { re: /(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/g, key: (m) => `${Number(m[1])}-${Number(m[2])}-${m[3]}` },
  { re: /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, key: (m) => `${Number(m[3])}-${Number(m[2])}-${m[1]}` },
];

function dateKeys(text: string): { key: string; shown: string }[] {
  const out: { key: string; shown: string }[] = [];
  for (const { re, key } of DATE_RES) for (const m of text.matchAll(re)) out.push({ key: key(m as RegExpExecArray), shown: m[0] });
  return out;
}

/** Tanggal di keluaran yang tidak ada di isian (HPHT, TP, tanggal kunjungan yang dikarang). */
export function findUnsupportedDates(output: string, corpus: string): string[] {
  const known = new Set(dateKeys(corpus).map((d) => d.key));
  const bad = new Set<string>();
  for (const d of dateKeys(output)) if (!known.has(d.key)) bad.add(d.shown.trim());
  return [...bad];
}
