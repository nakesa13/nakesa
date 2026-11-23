"use client";
import { useMemo } from "react";
import type { DocType } from "@/lib/types";
import type { StoredTemplate } from "@/lib/templateStore";
import { DATA_REFS, DATA_REF_LABEL, MAX_OUTLINE, buildOutline, extractHeadings, type OutlineItem, type OutlineRole } from "@/lib/outline";

type Samples = { h1: number | null; h2: number | null; h3: number | null };

const ROLE_LABEL: Record<OutlineRole, string> = {
  heading: "Judul saja",
  ai: "Ditulis AI",
  data: "Dari isian",
  manual: "Isi sendiri",
};

const roleValue = (i: OutlineItem): string => (i.role === "data" ? `data:${i.ref ?? ""}` : i.role);

export function OutlineStep({
  docType,
  record,
  outline,
  hasTexts,
  onAdopt,
  onChange,
  onReset,
}: {
  docType: DocType;
  record: StoredTemplate;
  outline: OutlineItem[] | null;
  /** Ada teks bagian dinamis yang sudah ditulis (akan terhapus bila struktur dibaca ulang). */
  hasTexts: boolean;
  onAdopt: (items: OutlineItem[], samples: Samples) => void;
  onChange: (items: OutlineItem[]) => void;
  onReset: () => void;
}) {
  const found = useMemo(() => extractHeadings(record.analysis, record.mapping), [record]);

  const adopt = () => {
    if (outline && hasTexts && !window.confirm("Membaca ulang struktur akan menghapus teks bagian yang sudah Anda tulis pada struktur ini. Lanjutkan?")) return;
    onAdopt(buildOutline(docType, found.items), found.samples);
  };

  const reset = () => {
    if (hasTexts && !window.confirm("Kembali ke struktur bawaan akan menghapus teks bagian yang sudah Anda tulis pada struktur ini. Lanjutkan?")) return;
    onReset();
  };

  if (!outline) {
    return (
      <section className="card p-5">
        <h2 className="text-lg font-semibold">Struktur dokumen</h2>
        <p className="mt-1 text-sm text-muted">
          Bab dan subbab dokumen bisa mengikuti template kampus Anda. Aplikasi membaca judul di template <b>{record.name}</b>, lalu Anda memeriksanya sebelum mengisi data.
        </p>
        {found.items.length >= 2 ? (
          <p className="mt-3 text-sm">
            Ditemukan <b>{found.items.length}</b> judul bab/subbab di template.
            {found.truncated && <> Hanya {MAX_OUTLINE} judul pertama yang dipakai.</>}
          </p>
        ) : (
          <p className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
            Judul bab tidak terdeteksi di template ini (mungkin template kosong atau tanpa penomoran). Anda tetap bisa memakai struktur bawaan NAKESA, atau membaca lalu menyusun sendiri.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" onClick={adopt} disabled={found.items.length < 1}>
            Gunakan struktur dari template
          </button>
          <span className="text-sm text-muted">atau tekan Lanjut untuk memakai struktur bawaan NAKESA.</span>
        </div>
      </section>
    );
  }

  const count = (r: OutlineRole) => outline.filter((i) => i.role === r).length;
  const update = (id: string, patch: Partial<OutlineItem>) => onChange(outline.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id: string) => onChange(outline.filter((i) => i.id !== id));
  const move = (idx: number, d: -1 | 1) => {
    const j = idx + d;
    if (j < 0 || j >= outline.length) return;
    const next = [...outline];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };
  const add = () => {
    if (outline.length >= MAX_OUTLINE) return;
    const n = Math.max(0, ...outline.map((i) => Number(i.id.slice(1)))) + 1;
    const last = outline[outline.length - 1];
    onChange([...outline, { id: `o${n}`, title: "Judul bagian baru", level: last?.level ?? 2, role: "manual", zone: last?.zone ?? "lain" }]);
  };
  const setRole = (i: OutlineItem, v: string) => {
    if (v.startsWith("data:")) update(i.id, { role: "data", ref: v.slice(5) });
    else if (v === "ai") update(i.id, { role: "ai", ref: i.role === "ai" ? i.ref : undefined });
    else update(i.id, { role: v as OutlineRole, ref: undefined });
  };

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <h2 className="text-lg font-semibold">Struktur dokumen</h2>
        <p className="mt-1 text-sm text-muted">
          Periksa susunan di bawah. Ubah judul, tingkat, atau sumber isi bila perlu. Gunakan <code>{"{kasus}"}</code> pada judul untuk diganti otomatis dengan kasus Anda.
        </p>
        <p className="mt-3 text-sm">
          {outline.length} bagian: {count("ai")} ditulis AI · {count("data")} dari isian · {count("manual")} isi sendiri · {count("heading")} judul saja
        </p>
        {count("manual") > 0 && (
          <p className="mt-2 text-xs text-muted">
            &quot;Isi sendiri&quot; dipakai untuk judul yang tidak dikenali aplikasi. AI tidak menulisnya supaya tidak mengarang isi (terutama data pasien). Bila bagian itu memang uraian teori, ubah sumber isinya menjadi &quot;Ditulis AI&quot;.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-sm" onClick={adopt}>
            Baca ulang dari template
          </button>
          <button className="btn btn-sm" onClick={reset}>
            Pakai struktur bawaan NAKESA
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {outline.map((i, idx) => {
          const dataRefs = DATA_REFS[docType];
          const val = roleValue(i);
          return (
            <div key={i.id} className="card p-3" style={{ marginLeft: (i.level - 1) * 16 }}>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="field min-w-0 flex-1"
                  aria-label={`Judul bagian ${idx + 1}`}
                  value={i.title}
                  maxLength={150}
                  onChange={(e) => update(i.id, { title: e.target.value })}
                />
                <select className="field w-auto" aria-label="Tingkat judul" value={i.level} onChange={(e) => update(i.id, { level: Number(e.target.value) as 1 | 2 | 3 })}>
                  <option value={1}>Tingkat 1</option>
                  <option value={2}>Tingkat 2</option>
                  <option value={3}>Tingkat 3</option>
                </select>
                <select className="field w-auto" aria-label="Sumber isi" value={val} onChange={(e) => setRole(i, e.target.value)}>
                  <option value="heading">{ROLE_LABEL.heading}</option>
                  <option value="ai">{ROLE_LABEL.ai}</option>
                  <option value="manual">{ROLE_LABEL.manual}</option>
                  {dataRefs.map((r) => (
                    <option key={r} value={`data:${r}`}>
                      {DATA_REF_LABEL[r] ?? ROLE_LABEL.data}
                    </option>
                  ))}
                </select>
                <button className="btn btn-sm" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Naikkan">
                  ↑
                </button>
                <button className="btn btn-sm" onClick={() => move(idx, 1)} disabled={idx === outline.length - 1} aria-label="Turunkan">
                  ↓
                </button>
                <button className="btn btn-sm" onClick={() => remove(i.id)} aria-label="Hapus bagian">
                  Hapus
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn" onClick={add} disabled={outline.length >= MAX_OUTLINE}>
        + Tambah bagian
      </button>
    </section>
  );
}
