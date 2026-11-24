"use client";
import { useId, useState } from "react";
import type { Provenance, Source } from "@/lib/types";
import { authorsToText, findDoi, parseAuthors } from "@/lib/citations";
import { apiPost, apiUpload } from "@/lib/client";
import { doiContentCheck } from "@/lib/provenance";
import { findDuplicateOf, findDuplicates, nextSourceId, reconcileEdit, sourceStatus, stampChecks, type SourceLevel } from "@/lib/refs";
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

const LEVEL_BADGE: Record<SourceLevel, string> = {
  "perlu-tinjau": "badge-bad",
  manual: "badge-warn",
  metadata: "badge-ok",
  isi: "badge-warn",
  terverifikasi: "badge-ok",
};

/** Respons /api/extract-source dan /api/import-url. */
interface Extracted {
  text: string;
  pages: number | null;
  truncated: boolean;
  chars: number;
  title?: string;
  doi?: string;
  provenance?: Provenance;
}

function hostOf(u?: string): string {
  try {
    return u ? new URL(u).host : "URL";
  } catch {
    return "URL";
  }
}

// Nomor sumber dihitung di lib/refs (nomor yang masih tertulis di teks tidak dipakai ulang); diekspor ulang untuk pemakai lama.
export { nextSourceId };

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
    const next: Draft = {
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
      origin: initial?.origin ?? "manual",
      verified: initial?.verified ?? false,
      provenance: initial?.provenance,
    };
    // T13: metadata yang pernah diverifikasi lalu diubah turun menjadi isian manual; isi yang diubah membuang hasil cek DOI.
    onSave(reconcileEdit(initial, next));
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
  citedIds,
  reservedIds,
}: {
  sources: Source[];
  onChange: (s: Source[]) => void;
  accessCode: string;
  library?: Source[];
  onSaveLibrary?: (s: Source) => void;
  /** T13: id sumber yang dirujuk di teks. Bila diberikan, sumber di luar himpunan ini ditandai "Belum dirujuk". */
  citedIds?: ReadonlySet<string>;
  /** T13: nomor sumber yang masih tertulis sebagai penanda di teks; tidak dipakai untuk sumber baru. */
  reservedIds?: string[];
}) {
  const [doi, setDoi] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [urlText, setUrlText] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  // Hasil baca file yang metadatanya belum lengkap: ditampilkan sebagai formulir terisi isi sumber.
  const [prefill, setPrefill] = useState<Draft | null>(null);
  const fileId = useId();
  const urlId = useId();

  /** Menambah sumber. DOI yang sama ditolak; judul+tahun+penulis yang sama ditanyakan dulu. Mengembalikan true bila ditambahkan. */
  const addDraft = (d: Draft): boolean => {
    const dup = findDuplicateOf(sources, d);
    if (dup?.by === "doi") {
      setMsg({ kind: "err", text: `DOI sumber ini sudah ada di daftar sebagai [${dup.id}].` });
      return false;
    }
    if (dup && !window.confirm(`Sumber dengan judul, tahun, dan penulis pertama yang sama sudah ada ([${dup.id}]). Tetap tambahkan?`)) return false;
    onChange([...sources, { ...d, id: nextSourceId(sources, reservedIds) }]);
    return true;
  };

  /** Hasil baca file atau URL: cari DOI, ambil metadata Crossref, lalu PERIKSA apakah judulnya cocok dengan isi sebelum dipasang. */
  const handleExtracted = async (r: Extracted) => {
    const content = r.text;
    const fromUrl = r.provenance?.method === "url";
    const found = r.doi ?? findDoi(content);
    const base: Provenance | undefined = r.provenance ? { ...r.provenance, doiInText: found ?? undefined } : undefined;
    const dup = found ? findDuplicateOf(sources, { doi: found, title: "", year: "", authors: [] }) : null;
    if (dup?.by === "doi") {
      setMsg({ kind: "err", text: `DOI ${found} di sumber ini sudah ada di daftar sumber sebagai [${dup.id}].` });
      return;
    }
    let meta: Draft | null = null;
    if (found) {
      try {
        meta = (await apiPost<{ source: Draft }>("/api/doi", { doi: found }, accessCode)).source;
      } catch {
        /* DOI tidak dapat diverifikasi: lanjut ke isian manual */
      }
    }
    if (meta) {
      // DOI yang sah di Crossref belum berarti isi ini adalah artikelnya.
      const check = doiContentCheck(meta.title, content);
      const prov = base ? { ...base, doiCheck: check } : undefined;
      if (check === "cocok") {
        if (addDraft(stampChecks<Draft>({ ...meta, content, provenance: prov }))) {
          setMsg({ kind: "ok", text: `DOI ${found} terdeteksi dan judul dari Crossref cocok dengan isi: metadata terverifikasi, isi tersimpan sebagai isi sumber.` });
        }
        return;
      }
      setAdding(false);
      if (check === "tidak-cocok") {
        setPrefill(stampChecks<Draft>({ type: fromUrl ? "web" : "jurnal", title: "", authors: [], year: "", url: r.provenance?.finalUrl, origin: "manual", verified: false, content, provenance: prov }));
        setMsg({
          kind: "err",
          text: `DOI ${found} ada di isi, tetapi judul Crossref ("${meta.title.slice(0, 120)}") tidak muncul di bagian awal isi. Mungkin itu DOI artikel lain yang dikutip. Metadata TIDAK dipasang otomatis: isi metadata yang benar di bawah.`,
        });
      } else {
        setPrefill(stampChecks<Draft>({ ...meta, origin: "manual", verified: false, content, provenance: prov }));
        setMsg({
          kind: "err",
          text: `DOI ${found} ditemukan, tetapi kecocokannya dengan isi belum bisa dipastikan. Metadata Crossref diisikan sebagai usulan dan belum berstatus terverifikasi: periksa terhadap isi, lalu simpan.`,
        });
      }
      return;
    }
    setAdding(false);
    setPrefill(stampChecks<Draft>({ type: fromUrl ? "web" : "jurnal", title: r.title ?? "", authors: [], year: "", url: r.provenance?.finalUrl, origin: "manual", verified: false, content, provenance: base }));
    setMsg({
      kind: "ok",
      text: `Teks terbaca (${r.chars.toLocaleString("id-ID")} karakter${r.truncated ? ", hanya 60.000 karakter pertama dipakai" : ""}). ${found ? "DOI di sumber ini tidak dapat diverifikasi." : "DOI tidak ditemukan."} Lengkapi metadata di bawah, lalu simpan.`,
    });
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      await handleExtracted(await apiUpload<Extracted>("/api/extract-source", file, accessCode));
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Gagal membaca file." });
    } finally {
      setUploading(false);
    }
  };

  const importUrl = async () => {
    if (!urlText.trim()) return;
    setUrlBusy(true);
    setMsg(null);
    try {
      await handleExtracted(await apiPost<Extracted>("/api/import-url", { url: urlText.trim() }, accessCode));
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Gagal mengambil URL." });
    } finally {
      setUrlBusy(false);
    }
  };

  const lookup = async () => {
    if (!doi.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { source } = await apiPost<{ source: Draft }>("/api/doi", { doi }, accessCode);
      if (addDraft(source)) {
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

  const importable = (library ?? []).filter((l) => !findDuplicateOf(sources, l));
  const dups = findDuplicates(sources);

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
        <div className="mt-3 border-t border-line pt-3">
          <label className="label" htmlFor={urlId}>
            Atau ambil dari URL (halaman web, PDF, atau teks)
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={urlId}
              className="field"
              inputMode="url"
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void importUrl()}
              placeholder="https://..."
            />
            <button className="btn btn-primary shrink-0" onClick={() => void importUrl()} disabled={urlBusy || !urlText.trim()}>
              {urlBusy ? "Mengambil…" : "Ambil dari URL"}
            </button>
          </div>
          <p className="help mt-1">
            Hanya alamat http/https publik (alamat internal diblokir). Halaman dibaca sekali dan tidak disimpan di server; sumber dicatat beserta URL dan waktu pengambilannya. Isi halaman diperlakukan sebagai data, bukan instruksi.
          </p>
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <label className="label" htmlFor={fileId}>
            Atau unggah file jurnal/referensi (PDF, Word .docx, atau .txt)
          </label>
          <input
            id={fileId}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-card file:px-3 file:py-2 file:text-sm"
            disabled={uploading}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <p className="help mt-1">
            {uploading ? "Membaca file…" : "Teks file menjadi isi sumber (bisa dikutip AI). Bila ada DOI di halaman depan, metadata diverifikasi otomatis; bila tidak, Anda melengkapi metadata sendiri. File tidak disimpan di server."}
          </p>
        </div>
        {prefill && (
          <div className="mt-3">
            <SourceForm
              key="prefill"
              initial={prefill}
              onSave={(d) => {
                if (addDraft(d)) {
                  setPrefill(null);
                  setMsg(null);
                }
              }}
              onCancel={() => setPrefill(null)}
            />
          </div>
        )}
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
                if (addDraft(d)) setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
      </div>

      {dups.length > 0 && (
        <p className="rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
          Kemungkinan sumber ganda:{" "}
          {dups.map((g) => `${g.ids.map((id) => `[${id}]`).join(" dan ")} (${g.by === "doi" ? "DOI sama" : "judul, tahun, dan penulis pertama sama"})`).join("; ")}. Hapus salah satunya bila memang sumber yang sama.
        </p>
      )}

      {sources.length === 0 ? (
        <p className="text-sm text-muted">Belum ada sumber.</p>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => {
            const st = sourceStatus(s);
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
                        <span className={`badge ${LEVEL_BADGE[st.level]}`}>{st.label}</span>
                        {citedIds && !citedIds.has(s.id) && <span className="badge badge-mute">Belum dirujuk di teks</span>}
                      </div>
                      {st.reasons.filter((r) => !r.startsWith("Tanpa isi")).length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
                          {st.reasons
                            .filter((r) => !r.startsWith("Tanpa isi"))
                            .map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                        </ul>
                      )}
                      {s.provenance && s.provenance.method !== "doi" && (
                        <p className="mt-1 text-xs text-muted">
                          {s.provenance.method === "url" ? `Diambil dari ${hostOf(s.provenance.finalUrl ?? s.provenance.url)}` : `File: ${s.provenance.fileName ?? "tanpa nama"}`} · {s.provenance.fetchedAt.slice(0, 10)}
                        </p>
                      )}
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
