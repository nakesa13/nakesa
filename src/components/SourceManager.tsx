"use client";
import { useId, useState } from "react";
import type { Source } from "@/lib/types";
import { authorsToText, parseAuthors } from "@/lib/citations";
import { apiPost } from "@/lib/client";
import { Icon } from "./Icon";

type Draft = Omit<Source, "id">;

function Field({ label, className, help, children }: { label: string; className?: string; help?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {help && <p className="help">{help}</p>}
    </div>
  );
}

const TYPE_LABEL: Record<Source["type"], string> = { jurnal: "Jurnal", buku: "Buku", pedoman: "Pedoman", web: "Situs web" };

export function nextSourceId(list: { id: string }[]): string {
  const max = list.reduce((m, s) => Math.max(m, Number(s.id.replace(/\D/g, "")) || 0), 0);
  return `S${max + 1}`;
}

function SourceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Draft;
  onSave: (s: Draft) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<Source["type"]>(initial?.type ?? "jurnal");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [authors, setAuthors] = useState(initial ? authorsToText(initial.authors) : "");
  const [year, setYear] = useState(initial?.year ?? "");
  const [journal, setJournal] = useState(initial?.journal ?? "");
  const [volume, setVolume] = useState(initial?.volume ?? "");
  const [issue, setIssue] = useState(initial?.issue ?? "");
  const [pages, setPages] = useState(initial?.pages ?? "");
  const [publisher, setPublisher] = useState(initial?.publisher ?? "");
  const [edition, setEdition] = useState(initial?.edition ?? "");
  const [doi, setDoi] = useState(initial?.doi ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [err, setErr] = useState("");

  const save = () => {
    if (!title.trim()) return setErr("Judul wajib diisi.");
    if (!year.trim()) return setErr("Tahun wajib diisi.");
    const parsed = parseAuthors(authors);
    // Metadata Crossref yang diubah tangan tidak lagi dianggap terverifikasi.
    const changed =
      !!initial &&
      initial.verified &&
      (initial.title !== title.trim() || initial.year !== year.trim() || authorsToText(initial.authors) !== authorsToText(parsed) || (initial.doi ?? "") !== doi.trim());
    onSave({
      type,
      title: title.trim(),
      authors: parsed,
      year: year.trim(),
      journal: journal.trim() || undefined,
      volume: volume.trim() || undefined,
      issue: issue.trim() || undefined,
      pages: pages.trim() || undefined,
      publisher: publisher.trim() || undefined,
      edition: edition.trim() || undefined,
      doi: doi.trim() || undefined,
      url: url.trim() || undefined,
      content: content.trim() || undefined,
      origin: changed ? "manual" : (initial?.origin ?? "manual"),
      verified: changed ? false : (initial?.verified ?? false),
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jenis sumber">{(id) => (
          <select id={id} className="field" value={type} onChange={(e) => setType(e.target.value as Source["type"])}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}</Field>
        <Field label="Tahun">{(id) => (
          <input id={id} className="field" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2022" />
        )}</Field>
      </div>
      <Field label="Judul">{(id) => (
          <input id={id} className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        )}</Field>
      <Field label="Penulis">{(id) => (
          <textarea id={id} className="field" rows={3} value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder={"Satu penulis per baris, format: Belakang, Nama Depan\nUntuk lembaga tulis nama lembaga saja"} />
        )}</Field>
      {type === "jurnal" ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Nama jurnal" className="sm:col-span-2">{(id) => (
          <input id={id} className="field" value={journal} onChange={(e) => setJournal(e.target.value)} />
        )}</Field>
          <Field label="Volume">{(id) => (
          <input id={id} className="field" value={volume} onChange={(e) => setVolume(e.target.value)} />
        )}</Field>
          <Field label="Nomor">{(id) => (
          <input id={id} className="field" value={issue} onChange={(e) => setIssue(e.target.value)} />
        )}</Field>
          <Field label="Halaman">{(id) => (
          <input id={id} className="field" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="45-52" />
        )}</Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Penerbit">{(id) => (
          <input id={id} className="field" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
        )}</Field>
          <Field label="Edisi (opsional)">{(id) => (
          <input id={id} className="field" value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="edisi ke-4" />
        )}</Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="DOI (opsional)">{(id) => (
          <input id={id} className="field" value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.xxxx/xxxxx" />
        )}</Field>
        <Field label="URL (opsional)">{(id) => (
          <input id={id} className="field" value={url} onChange={(e) => setUrl(e.target.value)} />
        )}</Field>
      </div>
      <Field
        label="Isi / kutipan sumber"
        help="AI hanya boleh merujuk sumber yang isinya ada di sini (minimal 200 karakter). Tanpa isi, sumber tetap bisa dicatat tetapi tidak akan dikutip otomatis, supaya tidak ada rujukan yang dikarang."
      >
        {(id) => <textarea id={id} className="field" rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Tempel teks dari sumber (abstrak, bab, atau halaman yang relevan)." />}
      </Field>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={save}>
          Simpan sumber
        </button>
        <button className="btn btn-sm" onClick={onCancel}>
          Batal
        </button>
      </div>
    </div>
  );
}

export function SourceManager({
  sources,
  onChange,
  accessCode,
  library,
  onSaveLibrary,
}: {
  sources: Source[];
  onChange: (s: Source[]) => void;
  accessCode: string;
  library?: Source[];
  onSaveLibrary?: (s: Source) => void;
}) {
  const [doi, setDoi] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const addDraft = (d: Draft) => onChange([...sources, { ...d, id: nextSourceId(sources) }]);

  const lookup = async () => {
    if (!doi.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { source } = await apiPost<{ source: Draft }>("/api/doi", { doi }, accessCode);
      if (sources.some((s) => s.doi && s.doi.toLowerCase() === source.doi?.toLowerCase())) {
        setMsg({ kind: "err", text: "DOI ini sudah ada di daftar." });
      } else {
        addDraft(source);
        setDoi("");
        setMsg({
          kind: "ok",
          text: source.content
            ? "Metadata terverifikasi dari Crossref, abstrak ikut tersimpan."
            : "Metadata terverifikasi dari Crossref. Abstrak tidak tersedia: buka Edit lalu tempel isi sumber agar bisa dikutip.",
        });
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Gagal mengambil DOI." });
    } finally {
      setBusy(false);
    }
  };

  const importable = (library ?? []).filter((l) => !sources.some((s) => (s.doi && s.doi === l.doi) || s.title === l.title));

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold">Tambah sumber</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            aria-label="DOI sumber"
            className="field"
            value={doi}
            onChange={(e) => setDoi(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            placeholder="Tempel DOI, mis. 10.1234/abcd atau https://doi.org/..."
          />
          <button className="btn btn-primary shrink-0" onClick={lookup} disabled={busy || !doi.trim()}>
            {busy ? "Mencari…" : "Ambil dari DOI"}
          </button>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-sm" onClick={() => setAdding((a) => !a)}>
            <Icon name="plus" className="h-4 w-4" /> Isi manual (buku, pedoman, jurnal tanpa DOI)
          </button>
          {importable.length > 0 && (
            <select
              aria-label="Ambil dari Pustaka Saya"
              className="field w-auto text-xs"
              value=""
              onChange={(e) => {
                const l = importable.find((x) => x.id === e.target.value);
                if (l) {
                  const { id: _id, ...rest } = l;
                  void _id;
                  addDraft(rest);
                }
              }}
            >
              <option value="">+ Ambil dari Pustaka Saya…</option>
              {importable.map((l) => (
                <option key={l.id} value={l.id}>
                  {(l.authors[0]?.family ?? "Tanpa penulis") + " (" + l.year + ") " + l.title.slice(0, 50)}
                </option>
              ))}
            </select>
          )}
        </div>
        {adding && (
          <div className="mt-3">
            <SourceForm
              onSave={(d) => {
                addDraft(d);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
      </div>

      {sources.length === 0 ? (
        <p className="text-sm text-muted">Belum ada sumber.</p>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => {
            const usable = (s.content ?? "").length >= 200;
            return (
              <li key={s.id} className="card p-3">
                {editing === s.id ? (
                  <SourceForm
                    initial={s}
                    onSave={(d) => {
                      onChange(sources.map((x) => (x.id === s.id ? { ...d, id: s.id } : x)));
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        <span className="mr-2 text-muted">[{s.id}]</span>
                        {s.title}
                      </p>
                      <p className="text-xs text-muted">
                        {s.authors.map((a) => a.family).join(", ") || "Tanpa penulis"} · {s.year} · {TYPE_LABEL[s.type]}
                        {s.journal ? ` · ${s.journal}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {s.verified ? <span className="badge badge-ok">Terverifikasi Crossref</span> : <span className="badge badge-warn">Isian manual</span>}
                        {usable ? <span className="badge badge-ok">Isi tersedia</span> : <span className="badge badge-mute">Tanpa isi: tidak dikutip AI</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button className="btn btn-sm" onClick={() => setEditing(s.id)}>
                        Edit
                      </button>
                      {onSaveLibrary && (
                        <button className="btn btn-sm" onClick={() => onSaveLibrary(s)}>
                          Simpan ke Pustaka
                        </button>
                      )}
                      <button className="btn btn-sm" aria-label="Hapus sumber" onClick={() => onChange(sources.filter((x) => x.id !== s.id))}>
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
