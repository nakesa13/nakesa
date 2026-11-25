"use client";
import { useId, useState } from "react";
import { apiUpload } from "@/lib/client";
import { deleteTemplate, saveTemplate, type StoredTemplate } from "@/lib/templateStore";
import { COVER_FIELDS, type Analysis, type CoverField, type Mapping, type TocMode } from "@/lib/template/types";
import { mappingIssues } from "@/lib/template/mapping";
import type { CiteStyle } from "@/lib/types";
import { sha256Hex } from "@/lib/template/ref";

const TOC_LABEL: Record<TocMode, string> = {
  keep: "Pertahankan daftar isi dari template (diperbarui otomatis oleh Word)",
  replace: "Ganti daftar isi ketikan manual dengan daftar isi otomatis",
  add: "Tambahkan daftar isi otomatis sebelum bab pertama",
  none: "Tanpa daftar isi",
};

const cm = (tw: number | null) => (tw ? `${(tw / 567).toFixed(1).replace(".", ",")} cm` : "-");

function BlockSelect({ label, value, onChange, analysis, none }: { label: string; value: number | null; onChange: (v: number | null) => void; analysis: Analysis; none?: string }) {
  const id = useId();
  const opts = analysis.blocks.filter((b) => b.kind === "p" && b.text.trim());
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        {none !== undefined && <option value="">{none}</option>}
        {value !== null && !opts.some((o) => o.i === value) && <option value={value}>#{value}</option>}
        {opts.map((b) => (
          <option key={b.i} value={b.i}>
            {`#${b.i} · ${b.styleName ? b.styleName + " · " : ""}${b.text.trim().slice(0, 60)}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function Fmt({ label, f }: { label: string; f: Analysis["formats"]["body"] }) {
  if (!f) return null;
  const parts = [f.font, f.sizePt ? `${f.sizePt} pt` : null, f.line ? `spasi ${f.line}` : null, f.align, f.bold ? "tebal" : null, f.autoNumbered ? "bernomor otomatis" : null].filter(Boolean);
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd>{parts.join(" · ") || "ikut gaya standar template"}</dd>
    </div>
  );
}

export function TemplateStep({
  docType,
  record,
  loading,
  onChange,
  accessCode,
}: {
  docType: string;
  record: StoredTemplate | null;
  loading: boolean;
  onChange: (r: StoredTemplate | null) => void;
  accessCode: string;
}) {
  const fileId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const persist = async (rec: StoredTemplate) => {
    const ok = await saveTemplate(docType, rec);
    setNote(ok ? "" : "Peramban tidak mengizinkan template disimpan (mode privat atau penyimpanan penuh). Template tetap dipakai selama halaman ini terbuka; unggah ulang bila halaman dimuat ulang.");
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (!/\.docx$/i.test(file.name)) return setError("Gunakan file Word berformat .docx. Bila file Anda .doc atau PDF, buka di Word lalu Simpan Sebagai .docx.");
    if (file.size > 8 * 1024 * 1024) return setError("Ukuran template maksimal 8 MB.");
    setBusy(true);
    try {
      const analysis = await apiUpload<Analysis>("/api/template/analyze", file, accessCode);
      const data = await file.arrayBuffer();
      // T11: id = hash isi template; versi mulai 1 dan naik setiap template diganti atau pemetaan diubah.
      const rec: StoredTemplate = { name: file.name, size: file.size, data, analysis, mapping: analysis.suggested, savedAt: Date.now(), templateId: await sha256Hex(data), version: (record?.version ?? 0) + 1 };
      await persist(rec);
      onChange(rec);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Template tidak dapat dibaca.");
    } finally {
      setBusy(false);
    }
  };

  const setMapping = (patch: Partial<Mapping>) => {
    if (!record) return;
    const rec = { ...record, mapping: { ...record.mapping, ...patch }, version: (record.version ?? 1) + 1 };
    onChange(rec);
    void persist(rec);
  };

  const remove = async () => {
    if (!window.confirm("Hapus template ini dari peramban? Dokumen akan memakai format bawaan NAKESA.")) return;
    await deleteTemplate(docType);
    setNote("");
    onChange(null);
  };

  const picker = (label: string) => (
    <label className="btn cursor-pointer" htmlFor={fileId}>
      {busy ? "Membaca template…" : label}
    </label>
  );
  const input = <input id={fileId} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />;

  if (loading) return <div className="card h-40 animate-pulse" />;

  if (!record) {
    return (
      <section className="card p-5">
        <h2 className="text-lg font-semibold">Format dokumen</h2>
        <p className="mt-1 text-sm text-muted">
          Format tiap kampus berbeda. Unggah <b>contoh dokumen dari kampus Anda</b> (file Word .docx, misalnya laporan yang sudah jadi atau templat dari prodi). Sampul, font, ukuran, spasi, margin, header/footer, nomor halaman, dan daftar isi akan mengikuti contoh itu. Isi contohnya diganti dengan isi dokumen Anda.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {input}
          <label className="btn btn-primary cursor-pointer" htmlFor={fileId}>
            {busy ? "Membaca template…" : "Unggah template .docx"}
          </label>
          <span className="text-sm text-muted">atau tekan Lanjut untuk memakai format bawaan (A4, Times New Roman 12, spasi 1,5, margin 4-3-3-3).</span>
        </div>
        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        <p className="help mt-4">File disimpan hanya di peramban ini. Server membacanya saat memproses dan tidak menyimpannya. Hapus data pribadi pada contoh bila perlu.</p>
      </section>
    );
  }

  const a = record.analysis;
  const m = record.mapping;
  const coverIdx = (f: CoverField): number | null => {
    const e = Object.entries(m.coverFields).find(([, v]) => v === f);
    return e ? Number(e[0]) : null;
  };
  const setCover = (f: CoverField, i: number | null) => {
    const next = Object.fromEntries(Object.entries(m.coverFields).filter(([, v]) => v !== f)) as Record<string, CoverField>;
    if (i !== null) next[String(i)] = f;
    setMapping({ coverFields: next });
  };
  const textAt = (i: number | null) => (i === null ? "-" : (a.blocks.find((b) => b.i === i)?.text.trim().slice(0, 50) ?? `#${i}`));
  const issues = mappingIssues(m, a.total);

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-lg font-semibold">Format dokumen</h2>
          <span className="badge badge-ok">Template: {record.name}</span>
        </div>
        <p className="mt-1 text-sm text-muted">Dokumen akan dibuat di atas template ini. Periksa hasil pembacaan di bawah, lalu lanjut.</p>
        <dl className="mt-4 space-y-1.5">
          <Fmt label="Isi" f={a.formats.body} />
          <Fmt label="Judul bab" f={a.formats.h1} />
          <Fmt label="Subjudul" f={a.formats.h2} />
          <Fmt label="Sub-subjudul" f={a.formats.h3} />
          <div className="flex gap-2 text-sm">
            <dt className="w-24 shrink-0 text-muted">Halaman</dt>
            <dd>
              {a.page.widthTwips && a.page.heightTwips ? `${cm(a.page.widthTwips)} × ${cm(a.page.heightTwips)}` : "-"} · margin atas {cm(a.page.top)}, kiri {cm(a.page.left)}, bawah {cm(a.page.bottom)}, kanan {cm(a.page.right)}
            </dd>
          </div>
          <div className="flex gap-2 text-sm">
            <dt className="w-24 shrink-0 text-muted">Lainnya</dt>
            <dd>
              {a.sections} bagian halaman · header {a.hasHeader ? "ada" : "tidak ada"} · footer/nomor halaman {a.hasFooter ? "ada" : "tidak ada"} · daftar isi {a.hasToc ? "ada" : "tidak ada"}
            </dd>
          </div>
        </dl>
        {a.warnings.map((w) => (
          <p key={w} className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">{w}</p>
        ))}
        {issues.map((w) => (
          <p key={w} className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">Pengaturan manual: {w}</p>
        ))}
        <div className="mt-4 rounded-md bg-page p-3 text-sm">
          <p>
            Isi dimulai dari: <b>{textAt(m.bodyStart)}</b>
          </p>
          <p>
            Daftar pustaka: <b>{m.bibHeading === null ? "tidak ditemukan, ditambahkan di akhir" : textAt(m.bibHeading)}</b>
          </p>
          <p>
            Daftar isi: <b>{TOC_LABEL[m.tocMode]}</b>
          </p>
          <p>
            Gaya sitasi: <b>{m.citeStyle ?? "ikut Pengaturan"}</b>
            {a.citeStyle && <span className="text-muted"> · terdeteksi dari template: {a.citeStyle.evidence}</span>}
          </p>
        </div>
        {note && <p className="mt-3 text-sm text-[var(--warn-ink)]">{note}</p>}
        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {input}
          {picker("Ganti template")}
          <button className="btn" onClick={remove}>
            Hapus, pakai format bawaan
          </button>
        </div>
        <p className="help mt-3">
          Nomor halaman pada daftar isi terisi saat file dibuka di Microsoft Word (pilih Ya bila Word menawarkan memperbarui field). Di aplikasi lain, nomor halaman mungkin belum muncul.
        </p>
      </div>

      <details className="card p-5">
        <summary className="cursor-pointer text-sm font-semibold">Pembacaan salah? Atur manual (opsional)</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <BlockSelect label="Paragraf pertama isi (awal Bab I)" value={m.bodyStart} onChange={(v) => v !== null && setMapping({ bodyStart: v })} analysis={a} />
          <BlockSelect label="Judul Daftar Pustaka" value={m.bibHeading} onChange={(v) => setMapping({ bibHeading: v, bodyEnd: v })} analysis={a} none="Tidak ada (tambahkan di akhir)" />
          <BlockSelect label="Bagian setelah daftar pustaka (mis. Lampiran)" value={m.bibEnd} onChange={(v) => setMapping({ bibEnd: v })} analysis={a} none="Tidak ada / sampai akhir" />
          <div>
            <label className="label" htmlFor="toc-mode">
              Daftar isi
            </label>
            <select id="toc-mode" className="field" value={m.tocMode} onChange={(e) => setMapping({ tocMode: e.target.value as TocMode })}>
              {(Object.keys(TOC_LABEL) as TocMode[]).map((k) => (
                <option key={k} value={k}>
                  {TOC_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <BlockSelect label="Judul &quot;DAFTAR ISI&quot; di template" value={m.tocHeading} onChange={(v) => setMapping({ tocHeading: v })} analysis={a} none="Tidak ada" />
          <div>
            <label className="label" htmlFor="cite-style">
              Gaya sitasi dan daftar pustaka
            </label>
            <select id="cite-style" className="field" value={m.citeStyle ?? ""} onChange={(e) => setMapping({ citeStyle: e.target.value === "" ? null : (e.target.value as CiteStyle) })}>
              <option value="">Ikut Pengaturan</option>
              <option value="APA">APA (Penulis, tahun)</option>
              <option value="Vancouver">Vancouver (nomor)</option>
            </select>
          </div>
        </div>
        <h3 className="mb-2 mt-5 text-sm font-semibold">Contoh format (diambil dari paragraf di template)</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <BlockSelect label="Judul bab" value={m.samples.h1} onChange={(v) => setMapping({ samples: { ...m.samples, h1: v } })} analysis={a} none="Otomatis" />
          <BlockSelect label="Subjudul (A.)" value={m.samples.h2} onChange={(v) => setMapping({ samples: { ...m.samples, h2: v } })} analysis={a} none="Otomatis" />
          <BlockSelect label="Sub-subjudul (1.)" value={m.samples.h3} onChange={(v) => setMapping({ samples: { ...m.samples, h3: v } })} analysis={a} none="Otomatis" />
          <BlockSelect label="Paragraf isi" value={m.samples.body} onChange={(v) => setMapping({ samples: { ...m.samples, body: v } })} analysis={a} none="Otomatis" />
        </div>
        <h3 className="mb-2 mt-5 text-sm font-semibold">Data di sampul yang diganti</h3>
        {a.placeholders.length > 0 ? (
          <p className="text-sm text-muted">Template memakai penanda {"{{…}}"}: {a.placeholders.map((p) => `{{${p}}}`).join(", ")}. Terisi otomatis.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {COVER_FIELDS.map((f) => (
              <BlockSelect key={f.id} label={f.label} value={coverIdx(f.id)} onChange={(v) => setCover(f.id, v)} analysis={a} none="Jangan ganti" />
            ))}
          </div>
        )}
      </details>
    </section>
  );
}
