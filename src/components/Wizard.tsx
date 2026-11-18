"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocType, Input, SectionWarnings, Source } from "@/lib/types";
import { TEMPLATES, resolveTitle } from "@/templates";
import type { FieldDef, SectionDef, StepDef } from "@/templates/types";
import { analyzeSection, journalSourceFromInput, renderDataSection } from "@/lib/case";
import { DRAFT_PREFIX, IDENTITY_IDS, LIBRARY_KEY, SETTINGS_DEFAULT, SETTINGS_KEY, apiDocx, apiPost, safeFileName, saveBlob, type Settings } from "@/lib/client";
import { useHydrated, useLocalState } from "@/lib/useLocalState";
import { Icon } from "./Icon";
import { JournalField } from "./JournalField";
import { SourceManager } from "./SourceManager";
import { TemplateStep } from "./TemplateStep";
import { loadTemplate, type StoredTemplate } from "@/lib/templateStore";

interface Draft {
  input: Input;
  sources: Source[];
  texts: Record<string, string>;
  step: number;
}
const EMPTY: Draft = { input: {}, sources: [], texts: {}, step: 0 };
const EMPTY_LIB: Source[] = [];

type Step = StepDef | { id: "format"; title: string; description?: string; fields: FieldDef[] } | { id: "referensi"; title: string; description?: string; fields: FieldDef[] } | { id: "hasil"; title: string; description?: string; fields: FieldDef[] };

export function Wizard({ docType }: { docType: DocType }) {
  const tpl = TEMPLATES[docType];
  const hydrated = useHydrated();
  const [settings] = useLocalState<Settings>(SETTINGS_KEY, SETTINGS_DEFAULT);
  const [draft, setDraft] = useLocalState<Draft>(DRAFT_PREFIX + docType, EMPTY);
  const [library, setLibrary] = useLocalState<Source[]>(LIBRARY_KEY, EMPTY_LIB);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [secErr, setSecErr] = useState<Record<string, string>>({});
  const [stripped, setStripped] = useState<Record<string, string[]>>({});
  const [running, setRunning] = useState(false);
  const [dl, setDl] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  const stopRef = useRef(false);
  const [tplRec, setTplRec] = useState<StoredTemplate | null>(null);
  const [tplLoading, setTplLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void loadTemplate(docType).then((r) => {
      if (!alive) return;
      setTplRec(r);
      setTplLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [docType]);

  const steps: Step[] = useMemo(
    () => [
      { id: "format" as const, title: "Format", fields: [] },
      ...tpl.steps,
      ...(docType !== "RJ" ? [{ id: "referensi" as const, title: "Referensi", description: "Daftar pustaka dibuat dari sumber di sini, bukan oleh AI.", fields: [] }] : []),
      { id: "hasil" as const, title: "Hasil", fields: [] },
    ],
    [tpl, docType]
  );
  const step = Math.min(draft.step, steps.length - 1);
  const cur = steps[step];

  // ---- nilai isian (identitas diisi dari Pengaturan bila belum diubah) ----
  const value = (id: string): string => {
    if (id in draft.input) return draft.input[id];
    if ((IDENTITY_IDS as readonly string[]).includes(id)) return settings[id as (typeof IDENTITY_IDS)[number]] ?? "";
    return "";
  };
  const effectiveInput: Input = useMemo(() => {
    const base: Input = {};
    for (const k of IDENTITY_IDS) base[k] = settings[k] ?? "";
    return { ...base, ...draft.input };
  }, [draft.input, settings]);

  const patchInput = (p: Record<string, string>) => setDraft((d) => ({ ...d, input: { ...d.input, ...p } }));
  const sources: Source[] = useMemo(() => {
    if (docType === "RJ") {
      const j = journalSourceFromInput(effectiveInput);
      return j ? [j] : [];
    }
    return draft.sources;
  }, [docType, effectiveInput, draft.sources]);

  // ---- teks bagian ----
  const textOf = (s: SectionDef): string => {
    if (s.id in draft.texts) return draft.texts[s.id];
    return s.kind === "data" ? renderDataSection(docType, s.id, effectiveInput) : "";
  };
  const setText = (id: string, text: string) => setDraft((d) => ({ ...d, texts: { ...d.texts, [id]: text } }));

  const aiSections = tpl.sections.filter((s) => s.kind === "ai");
  // Tanpa sumber berisi, AI memang tidak boleh mengutip: peringatan "belum ada rujukan" per bagian hanya noise, cukup satu pesan di atas.
  const hasUsableSource = sources.some((s) => (s.content ?? "").trim().length >= 200);
  const warnings = useMemo(() => {
    const out: Record<string, SectionWarnings> = {};
    for (const s of tpl.sections) {
      if (s.kind !== "ai") continue;
      const t = s.id in draft.texts ? draft.texts[s.id] : "";
      if (t) out[s.id] = analyzeSection(docType, s, t, effectiveInput, sources);
    }
    return out;
  }, [tpl, docType, draft.texts, effectiveInput, sources]);

  const warnCount = Object.values(warnings).filter((w) => w.unknownMarkers.length || (hasUsableSource && w.uncitedParagraphs) || w.unsupportedNumbers.length).length;
  const doneCount = aiSections.filter((s) => (draft.texts[s.id] ?? "").trim()).length;

  // ---- validasi langkah ----
  const validate = (s: Step): boolean => {
    const errs: Record<string, string> = {};
    for (const f of s.fields) {
      if (!f.required) continue;
      if (f.type === "journal") {
        if (!value("j_title").trim()) errs.j_title = "Judul jurnal wajib diisi.";
        if (!value("j_year").trim()) errs.j_year = "Tahun terbit wajib diisi.";
        if (value("j_text").trim().length < 500) errs.j_text = "Teks jurnal minimal 500 karakter.";
      } else if (!value(f.id).trim()) errs[f.id] = "Wajib diisi.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const go = (n: number) => {
    setDraft((d) => ({ ...d, step: Math.max(0, Math.min(steps.length - 1, n)) }));
    window.scrollTo({ top: 0 });
  };
  const next = () => {
    if (validate(cur)) go(step + 1);
  };

  // ---- generate ----
  const genOne = async (def: SectionDef) => {
    setBusy((b) => ({ ...b, [def.id]: true }));
    setSecErr((e) => ({ ...e, [def.id]: "" }));
    try {
      const r = await apiPost<{ text: string; stripped: string[] }>("/api/generate", { docType, sectionId: def.id, input: effectiveInput, sources }, settings.accessCode);
      setText(def.id, r.text);
      setStripped((s) => ({ ...s, [def.id]: r.stripped }));
    } catch (e) {
      setSecErr((m) => ({ ...m, [def.id]: e instanceof Error ? e.message : "Gagal menulis bagian ini." }));
    } finally {
      setBusy((b) => ({ ...b, [def.id]: false }));
    }
  };

  const genAll = async () => {
    stopRef.current = false;
    setRunning(true);
    const queue = aiSections.filter((s) => !(draft.texts[s.id] ?? "").trim());
    const worker = async () => {
      while (!stopRef.current) {
        const def = queue.shift();
        if (!def) return;
        await genOne(def);
      }
    };
    await worker(); // berurutan: kuota token per menit penyedia gratis kecil, paralel memicu galat 429
    setRunning(false);
  };

  // ---- unduh ----
  const download = async () => {
    const empty = aiSections.filter((s) => !(draft.texts[s.id] ?? "").trim());
    if (empty.length && !window.confirm(`${empty.length} bagian AI masih kosong dan akan tampil tanpa isi di dokumen. Tetap unduh?`)) return;
    setDl({ busy: true, error: "" });
    try {
      const judul = (effectiveInput.judul ?? "").trim() || (docType === "RJ" ? effectiveInput.j_title ?? "" : "") || tpl.name;
      const blob = await apiDocx(
        {
          docType,
          judul,
          style: settings.style,
          identity: Object.fromEntries(IDENTITY_IDS.map((k) => [k, effectiveInput[k] ?? ""])),
          sources,
          sections: tpl.sections.map((s) => ({
            id: s.id,
            title: resolveTitle(s, effectiveInput),
            level: s.level,
            kind: s.kind,
            text: s.kind === "heading" ? "" : textOf(s),
          })),
        },
        settings.accessCode,
        tplRec ? { data: tplRec.data, mapping: tplRec.mapping } : undefined
      );
      saveBlob(blob, safeFileName(judul, tpl.short));
      setDl({ busy: false, error: "" });
    } catch (e) {
      setDl({ busy: false, error: e instanceof Error ? e.message : "Gagal membuat file." });
    }
  };

  const reset = () => {
    if (window.confirm("Hapus semua isian dan hasil untuk dokumen ini?")) {
      setDraft(EMPTY);
      setStripped({});
      setSecErr({});
      setErrors({});
    }
  };

  if (!hydrated) return <div className="card h-64 animate-pulse" />;

  const renderField = (f: FieldDef) => {
    if (f.type === "journal") {
      return (
        <div key={f.id}>
          <JournalField value={value} onPatch={patchInput} accessCode={settings.accessCode} />
          {["j_title", "j_year", "j_text"].map((k) => errors[k] && <p key={k} className="mt-2 text-sm text-red-600">{errors[k]}</p>)}
        </div>
      );
    }
    const common = {
      id: `f_${f.id}`,
      className: "field",
      value: value(f.id),
      placeholder: f.placeholder,
    };
    return (
      <div key={f.id} className={f.half ? "sm:col-span-1" : "sm:col-span-2"}>
        <label className="label" htmlFor={common.id}>
          {f.label}
          {f.required && <span className="text-red-500"> *</span>}
        </label>
        {f.type === "textarea" ? (
          <textarea {...common} rows={f.rows ?? 3} onChange={(e) => patchInput({ [f.id]: e.target.value })} />
        ) : f.type === "select" ? (
          <select {...common} onChange={(e) => patchInput({ [f.id]: e.target.value })}>
            <option value="">Pilih…</option>
            {f.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input {...common} onChange={(e) => patchInput({ [f.id]: e.target.value })} />
        )}
        {f.help && <p className="help">{f.help}</p>}
        {errors[f.id] && <p className="mt-1 text-xs text-red-600">{errors[f.id]}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{tpl.name}</h1>
        <p className="mt-1 text-sm text-muted">{tpl.description}</p>
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              onClick={() => (i <= step ? go(i) : next())}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                i === step ? "border-transparent bg-brand text-brand-ink" : i < step ? "border-line bg-card text-ink" : "border-line bg-card text-muted"
              }`}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/10 text-xs">{i < step ? <Icon name="check" className="h-3 w-3" /> : i + 1}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      {cur.id === "format" && <TemplateStep docType={docType} record={tplRec} loading={tplLoading} onChange={setTplRec} accessCode={settings.accessCode} />}

      {cur.id !== "hasil" && cur.id !== "referensi" && cur.id !== "format" && (
        <section className="card p-5">
          <h2 className="text-lg font-semibold">{cur.title}</h2>
          {cur.description && <p className="mb-4 mt-1 text-sm text-muted">{cur.description}</p>}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">{cur.fields.map(renderField)}</div>
        </section>
      )}

      {cur.id === "referensi" && (
        <section className="space-y-3">
          <div className="card p-5">
            <h2 className="text-lg font-semibold">Referensi</h2>
            <p className="mt-1 text-sm text-muted">
              Tambahkan buku, pedoman, atau jurnal yang akan dijadikan rujukan. AI hanya boleh merujuk sumber yang <b>isinya</b> Anda lampirkan, dan daftar pustaka disusun otomatis dari sumber yang benar-benar dikutip.
            </p>
            {sources.filter((s) => (s.content ?? "").length >= 200).length === 0 && (
              <p className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
                Belum ada sumber berisi. Dokumen tetap bisa dibuat, tetapi tanpa rujukan otomatis dan bagian teori akan diberi peringatan &quot;belum ada rujukan&quot;.
              </p>
            )}
          </div>
          <SourceManager
            sources={draft.sources}
            onChange={(s) => setDraft((d) => ({ ...d, sources: s }))}
            accessCode={settings.accessCode}
            library={library}
            onSaveLibrary={(s) => {
              const { id: _id, ...rest } = s;
              void _id;
              if (library.some((l) => (rest.doi && l.doi === rest.doi) || l.title === rest.title)) return;
              setLibrary((l) => [...l, { ...rest, id: `S${l.length + 1}` }]);
            }}
          />
        </section>
      )}

      {cur.id === "hasil" && (
        <section className="space-y-4">
          <div className="card p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <h2 className="text-lg font-semibold">Hasil</h2>
                <p className="mt-1 text-sm text-muted">
                  {doneCount}/{aiSections.length} bagian AI terisi
                  {warnCount > 0 && <> · <span className="font-medium text-amber-600">{warnCount} bagian perlu ditinjau</span></>} · gaya rujukan {settings.style} · format {tplRec ? `template ${tplRec.name}` : "bawaan NAKESA"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {running ? (
                  <button className="btn" onClick={() => (stopRef.current = true)}>
                    Hentikan
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={genAll} disabled={aiSections.every((s) => (draft.texts[s.id] ?? "").trim())}>
                    <Icon name="spark" className="h-4 w-4" /> Tulis semua bagian
                  </button>
                )}
                <button className="btn" onClick={download} disabled={dl.busy}>
                  <Icon name="download" className="h-4 w-4" /> {dl.busy ? "Menyusun…" : "Unduh .docx"}
                </button>
              </div>
            </div>
            {!hasUsableSource && docType !== "RJ" && (
              <p className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
                Belum ada sumber berisi di langkah Referensi, jadi AI tidak mengutip apa pun dan seluruh bagian teori ditulis tanpa rujukan. Tambahkan buku/jurnal beserta isinya di langkah Referensi, lalu tulis ulang bagian yang diperlukan.
              </p>
            )}
            {dl.error && <p className="mt-3 text-sm text-red-600">{dl.error}</p>}
            <p className="mt-3 text-xs text-muted">
              Ini draf. Tinjau setiap bagian sebelum dikumpulkan. Penanda seperti [S1] otomatis menjadi sitasi dan daftar pustaka di file Word. Bagian bertanda kuning perlu pengecekan Anda.
            </p>
          </div>

          {tpl.sections.map((s) => {
            const title = resolveTitle(s, effectiveInput);
            if (s.kind === "heading") {
              return (
                <h3 key={s.id} className={`pt-2 font-semibold ${s.level === 1 ? "text-base uppercase tracking-wide text-brand" : "text-sm"}`}>
                  {title}
                </h3>
              );
            }
            const text = textOf(s);
            const w = warnings[s.id];
            const strippedIds = stripped[s.id] ?? [];
            return (
              <article key={s.id} className="card p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <h4 className="flex-1 text-sm font-semibold">{title}</h4>
                  {s.kind === "data" && <span className="badge badge-mute">Dari isian Anda</span>}
                  {s.kind === "ai" && s.patientSpecific && <span className="badge badge-warn">Analisis pasien: tinjau</span>}
                </div>
                <details className="mt-1 text-xs text-muted">
                  <summary className="cursor-pointer">Panduan bagian ini</summary>
                  <p className="mt-1">{s.guide}</p>
                </details>

                <textarea
                  className="field mt-3 leading-relaxed"
                  rows={Math.min(18, Math.max(5, Math.ceil(text.length / 90) + 2))}
                  value={text}
                  onChange={(e) => setText(s.id, e.target.value)}
                  placeholder={s.kind === "ai" ? "Klik 'Tulis bagian ini' atau ketik sendiri." : ""}
                />

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {s.kind === "ai" ? (
                    <button className="btn btn-sm" onClick={() => genOne(s)} disabled={!!busy[s.id]}>
                      <Icon name="spark" className="h-3.5 w-3.5" /> {busy[s.id] ? "Menulis…" : text.trim() ? "Tulis ulang" : "Tulis bagian ini"}
                    </button>
                  ) : (
                    <button className="btn btn-sm" onClick={() => setDraft((d) => { const t = { ...d.texts }; delete t[s.id]; return { ...d, texts: t }; })}>
                      Susun ulang dari isian
                    </button>
                  )}
                  {w?.unknownMarkers.length ? <span className="badge badge-bad">Rujukan {w.unknownMarkers.join(", ")} tidak ada di daftar sumber</span> : null}
                  {hasUsableSource && w?.uncitedParagraphs ? <span className="badge badge-warn">{w.uncitedParagraphs} paragraf belum ada rujukan</span> : null}
                  {w?.unsupportedNumbers.length ? (
                    <span className="badge badge-bad">Angka tidak ditemukan di {docType === "RJ" ? "teks jurnal" : "isian Anda"}: {w.unsupportedNumbers.join(", ")}</span>
                  ) : null}
                  {strippedIds.length ? <span className="badge badge-warn">Penanda {strippedIds.join(", ")} dihapus: sumber tanpa isi</span> : null}
                </div>
                {secErr[s.id] && <p className="mt-2 text-sm text-red-600">{secErr[s.id]}</p>}
              </article>
            );
          })}
        </section>
      )}

      {/* Navigasi */}
      <div className="flex items-center justify-between gap-2 pt-2">
        <button className="btn" onClick={() => go(step - 1)} disabled={step === 0}>
          Kembali
        </button>
        <button className="text-xs text-muted underline" onClick={reset}>
          Mulai baru
        </button>
        {cur.id !== "hasil" ? (
          <button className="btn btn-primary" onClick={next}>
            Lanjut
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
