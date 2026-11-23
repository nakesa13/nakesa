"use client";
import { useId, useState } from "react";
import type { Input, Source } from "@/lib/types";
import { authorsToText } from "@/lib/citations";
import { apiPost, apiUpload } from "@/lib/client";
import { assessJournalText, journalDoiCheck, parseScope } from "@/lib/journal";
import { doiContentCheck } from "@/lib/provenance";

type Patch = Record<string, string>;

const DOI_IN_TEXT = /\b(10\.\d{4,9}\/[^\s"<>]+?)(?=[\s"<>]|[.,;)]*(?:\s|$))/;

export function JournalField({
  value,
  onPatch,
  accessCode,
}: {
  value: (id: string) => string;
  onPatch: (p: Patch) => void;
  accessCode: string;
}) {
  const [busy, setBusy] = useState<"" | "pdf" | "doi">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const text = value("j_text");
  const uid = useId();
  // T10: status turunan dari isian yang berlaku sekarang, jadi selalu mengikuti perubahan teks/metadata.
  const doiCheck = journalDoiCheck({ j_origin: value("j_origin"), j_doi: value("j_doi"), j_title: value("j_title"), j_text: text, j_scope: value("j_scope") });
  const assess = text.trim().length >= 200 ? assessJournalText(text, value("j_scope")) : null;

  const v = (id: string, label: string, props: { placeholder?: string; area?: boolean; className?: string } = {}) => (
    <div className={props.className}>
      <label className="label" htmlFor={`${uid}-${id}`}>
        {label}
      </label>
      {props.area ? (
        <textarea id={`${uid}-${id}`} className="field" rows={3} value={value(id)} placeholder={props.placeholder} onChange={(e) => onPatch({ [id]: e.target.value, j_origin: "manual" })} />
      ) : (
        <input id={`${uid}-${id}`} className="field" value={value(id)} placeholder={props.placeholder} onChange={(e) => onPatch({ [id]: e.target.value, j_origin: "manual" })} />
      )}
    </div>
  );

  const onPdf = async (file: File | undefined) => {
    if (!file) return;
    setBusy("pdf");
    setMsg(null);
    try {
      const r = await apiUpload<{ text: string; pages: number | null; truncated: boolean; chars: number; warnings?: string[] }>("/api/extract-source", file, accessCode);
      // PDF yang hanya sebagian terbaca ditandai; ringkasan kemudian memakai "Tidak dilaporkan" untuk bagian yang tidak ada.
      const partial = !!r.warnings?.length;
      const patch: Patch = { j_text: r.text, j_scope: partial ? "file-sebagian" : "file" };
      const found = DOI_IN_TEXT.exec(r.text.slice(0, 4000));
      if (found && !value("j_doi")) patch.j_doi = found[1].replace(/[.,;]+$/, "");
      onPatch(patch);
      setMsg({
        kind: partial ? "warn" : "ok",
        text: `Teks terbaca${r.pages ? ` dari ${r.pages} halaman` : ""} (${r.chars.toLocaleString("id-ID")} karakter)${r.truncated ? "; hanya 60.000 karakter pertama dipakai" : ""}.${patch.j_doi ? " DOI terdeteksi, klik 'Ambil metadata' untuk memverifikasi." : ""} Periksa metadata di bawah.${partial ? ` PERHATIAN: ${r.warnings!.join(" ")}` : ""}`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Gagal membaca PDF." });
    } finally {
      setBusy("");
    }
  };

  const onDoi = async () => {
    setBusy("doi");
    setMsg(null);
    try {
      const { source } = await apiPost<{ source: Omit<Source, "id"> }>("/api/doi", { doi: value("j_doi") }, accessCode);
      const hasFileText = !!text.trim() && parseScope(value("j_scope")) !== "abstrak";
      const check = hasFileText ? doiContentCheck(source.title, text) : "tidak-dapat-dinilai";
      const patch: Patch = {
        j_title: source.title,
        j_authors: authorsToText(source.authors),
        j_year: source.year,
        j_journal: source.journal ?? "",
        j_volume: source.volume ?? "",
        j_issue: source.issue ?? "",
        j_pages: source.pages ?? "",
        j_doi: source.doi ?? "",
        j_url: source.url ?? "",
        j_origin: "crossref",
      };
      const abstractOnly = !text.trim() && !!source.content;
      if (abstractOnly) {
        patch.j_text = source.content!;
        patch.j_scope = "abstrak";
      }
      onPatch(patch);
      if (check === "tidak-cocok") {
        setMsg({
          kind: "warn",
          text: `Judul di Crossref ("${source.title}") tampak berbeda dari teks yang Anda lampirkan, jadi DOI ini mungkin milik artikel lain. Metadata diisi tetapi TIDAK ditandai terverifikasi. Periksa DOI dan judulnya. (Jurnal berbahasa Indonesia sering memakai judul berbahasa Inggris di Crossref; bila memang artikel yang sama, abaikan peringatan ini.)`,
        });
      } else if (hasFileText) {
        setMsg({ kind: "warn", text: "Metadata diambil dari Crossref. Kecocokan dengan teks Anda tidak dapat dinilai otomatis; pastikan judulnya sama dengan artikel Anda." });
      } else if (abstractOnly) {
        setMsg({ kind: "warn", text: "Metadata dari Crossref. Teks yang terisi hanya abstrak, jadi bagian lain ditulis 'Tidak dilaporkan dalam artikel.' Unggah artikel lengkap untuk ringkasan penuh." });
      } else {
        setMsg({ kind: "ok", text: "Metadata terverifikasi dari Crossref." });
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Gagal mengambil DOI." });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="mb-1 text-sm font-semibold">1. Teks jurnal</h3>
        <p className="help mb-2">
          Ringkasan hanya dibuat dari teks ini. Unggah jurnal dalam bentuk PDF, Word (.docx), atau .txt; boleh juga tempel teksnya. PDF hasil scan (gambar) tidak terbaca; PDF yang hanya sebagian terbaca akan diberi peringatan.
        </p>
        <input
          aria-label="Unggah file jurnal"
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-card file:px-3 file:py-2 file:text-sm"
          disabled={busy === "pdf"}
          onChange={(e) => onPdf(e.target.files?.[0])}
        />
        {busy === "pdf" && <p className="mt-2 text-sm text-muted">Membaca file…</p>}
        <label className="label mt-3" htmlFor={`${uid}-text`}>Teks jurnal ({text.length.toLocaleString("id-ID")} karakter)</label>
        <textarea id={`${uid}-text`} className="field font-mono text-xs" rows={8} value={text} onChange={(e) => onPatch({ j_text: e.target.value, j_scope: "manual" })} placeholder="Hasil baca file muncul di sini. Bisa juga ditempel/diedit manual." />
        {text.length > 0 && text.length < 500 && <p className="mt-1 text-xs text-red-600">Minimal 500 karakter agar ringkasan dapat dibuat.</p>}
        {assess?.level === "sebagian" && (
          <div className="mt-2 rounded-md bg-[var(--warn-bg)] p-3 text-xs text-[var(--warn-ink)]">
            <p className="font-medium">Teks mungkin belum lengkap.</p>
            <p className="mt-1">{assess.notes.join(" ")} Bagian ringkasan yang tidak ada di teks akan ditulis &quot;Tidak dilaporkan dalam artikel.&quot;, bukan ditebak.</p>
          </div>
        )}
      </div>

      <div className="card p-4">
        <h3 className="mb-1 text-sm font-semibold">2. Identitas jurnal</h3>
        <p className="help mb-2">Dipakai untuk bagian Identitas dan Daftar Pustaka. Isi lewat DOI (metadata dari Crossref) atau manual.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input aria-label="DOI jurnal" className="field" value={value("j_doi")} onChange={(e) => onPatch({ j_doi: e.target.value, j_origin: "manual" })} placeholder="DOI, mis. 10.1234/abcd" />
          <button className="btn shrink-0" onClick={onDoi} disabled={busy === "doi" || !value("j_doi").trim()}>
            {busy === "doi" ? "Mencari…" : "Ambil metadata"}
          </button>
        </div>
        {value("j_origin") === "crossref" && doiCheck !== "tidak-cocok" && <span className="badge badge-ok mt-2">Terverifikasi Crossref</span>}
        {doiCheck === "tidak-cocok" && <span className="badge badge-bad mt-2">DOI tidak cocok dengan teks</span>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {v("j_title", "Judul jurnal", { className: "sm:col-span-2" })}
          {v("j_authors", "Penulis (satu per baris: Belakang, Nama Depan)", { area: true, className: "sm:col-span-2" })}
          {v("j_year", "Tahun terbit")}
          {v("j_journal", "Nama jurnal")}
          {v("j_volume", "Volume")}
          {v("j_issue", "Nomor")}
          {v("j_pages", "Halaman", { placeholder: "45-52" })}
          {v("j_url", "URL (opsional)")}
        </div>
        {msg && <p className={`mt-3 text-sm ${msg.kind === "ok" ? "text-emerald-600" : msg.kind === "warn" ? "text-amber-600" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}

export type { Input };
