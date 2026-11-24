"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocType, Input, SectionWarnings, Source } from "@/lib/types";
import { TEMPLATES, resolveTitle } from "@/templates";
import type { FieldDef, SectionDef, StepDef } from "@/templates/types";
import { analyzeSection, journalSourceFromInput, renderDataSection, KOSONG } from "@/lib/case";
import { DRAFT_PREFIX, LIBRARY_KEY, SETTINGS_DEFAULT, SETTINGS_KEY, apiDocx, apiPost, safeFileName, saveBlob, type Settings } from "@/lib/client";
import { useHydrated, useLocalState } from "@/lib/useLocalState";
import { Icon } from "./Icon";
import { JournalField } from "./JournalField";
import { SourceManager, nextSourceId } from "./SourceManager";
import { TemplateStep } from "./TemplateStep";
import { loadTemplate, saveTemplate, type StoredTemplate } from "@/lib/templateStore";
import { makeRef, sameRef } from "@/lib/template/ref";
import { OutlineStep } from "./OutlineStep";
import { dropDynamicTexts, resolveSection, visibleStepIds, type OutlineItem } from "@/lib/outline";
import { EMPTY_DRAFT, type Draft } from "@/lib/draft";
import { CASE_KEY, EMPTY_CASE, buildInput, caseDerivedInput, isLinked, isSharedField, linkConfirmMessage, linkDoc, reusePreview, searchKeywords, unlinkDoc, type SharedCase } from "@/lib/kasus";
import { countNeedsReference, pendingAiSections } from "@/lib/lp";
import { isAnc } from "@/lib/anc";
import { SerialField } from "./SerialField";
import { PreviewPane } from "./PreviewPane";
import { buildPreview } from "@/lib/preview";
import { documentTitle, identityPayload, sectionPayload } from "@/lib/export";
import { warningText } from "@/lib/docx-warnings";
import { extractMarkerIds } from "@/lib/citations";
import { analyzeReferences, findDuplicateOf, isCitable } from "@/lib/refs";

const EMPTY_LIB: Source[] = [];

type Step = StepDef | { id: "format"; title: string; description?: string; fields: FieldDef[] } | { id: "struktur"; title: string; description?: string; fields: FieldDef[] } | { id: "referensi"; title: string; description?: string; fields: FieldDef[] } | { id: "hasil"; title: string; description?: string; fields: FieldDef[] };

export function Wizard({ docType }: { docType: DocType }) {
  const tpl = TEMPLATES[docType];
  const hydrated = useHydrated();
  const [settings] = useLocalState<Settings>(SETTINGS_KEY, SETTINGS_DEFAULT);
  const [draft, setDraft] = useLocalState<Draft>(DRAFT_PREFIX + docType, EMPTY_DRAFT);
  const [sharedCase, setSharedCase] = useLocalState<SharedCase>(CASE_KEY, EMPTY_CASE);
  const [library, setLibrary] = useLocalState<Source[]>(LIBRARY_KEY, EMPTY_LIB);
  const [libMsg, setLibMsg] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [secErr, setSecErr] = useState<Record<string, string>>({});
  const [stripped, setStripped] = useState<Record<string, string[]>>({});
  const [running, setRunning] = useState(false);
  const [dl, setDl] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  // T12: pratinjau perkiraan dan peringatan dari pemeriksa .docx di server.
  const [showPreview, setShowPreview] = useState(false);
  const [dlWarn, setDlWarn] = useState<string[]>([]);
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

  // T11: simpan id, versi, dan pemetaan template bersama dokumen (draf), supaya dokumen tahu template mana yang dipakainya.
  useEffect(() => {
    if (tplLoading) return;
    let alive = true;
    void (async () => {
      const ref = tplRec ? await makeRef(tplRec) : null;
      if (!alive) return;
      setDraft((d) => (sameRef(d.template, ref) ? d : { ...d, template: ref }));
    })();
    return () => {
      alive = false;
    };
  }, [tplRec, tplLoading, setDraft]);

  const outline = draft.outline ?? null;
  // Tahap B: bagian dokumen mengikuti struktur dari template mahasiswa bila sudah dikonfirmasi; bila tidak, struktur bawaan.
  const sections: SectionDef[] = useMemo(() => (outline ? outline.map((i) => resolveSection(docType, i)) : tpl.sections), [outline, tpl, docType]);

  // ---- nilai isian: identitas dari Pengaturan, usulan dari Kasus, isian draf, dan Kasus bersama (Tahap C) ----
  const effectiveInput: Input = useMemo(() => buildInput(docType, draft.input, settings, sharedCase), [docType, draft.input, settings, sharedCase]);
  const value = (id: string): string => effectiveInput[id] ?? "";
  // T09: langkah Data Kehamilan (ANC) hanya muncul untuk asuhan kehamilan.
  const ancStep = docType === "LK" && isAnc(effectiveInput.jenis_asuhan);

  const steps: Step[] = useMemo(() => {
    const vis = visibleStepIds(docType, outline);
    return [
      { id: "format" as const, title: "Format", fields: [] },
      { id: "struktur" as const, title: "Struktur", fields: [] },
      ...tpl.steps.filter((s) => (!vis || vis.has(s.id)) && (s.id !== "anc" || ancStep)),
      ...(docType !== "RJ" ? [{ id: "referensi" as const, title: "Referensi", description: "Daftar pustaka dibuat dari sumber di sini, bukan oleh AI.", fields: [] }] : []),
      { id: "hasil" as const, title: "Hasil", fields: [] },
    ];
  }, [tpl, docType, outline, ancStep]);
  const step = Math.min(draft.step, steps.length - 1);
  const cur = steps[step];

  // ---- penyimpanan isian ----
  // Jenis asuhan dan kasus pada LP/LK disimpan satu kali di Kasus bersama, bukan di draf.
  const patchInput = (p: Record<string, string>) => {
    const mine: Record<string, string> = {};
    const shared: SharedCase = {};
    for (const [k, v] of Object.entries(p)) {
      if (isSharedField(docType, k, sharedCase)) (shared as Record<string, string>)[k] = v;
      else mine[k] = v;
    }
    if (Object.keys(mine).length) setDraft((d) => ({ ...d, input: { ...d.input, ...mine } }));
    if (Object.keys(shared).length) setSharedCase((c) => ({ ...c, ...shared }));
  };
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
    return s.kind === "data" ? renderDataSection(docType, s.ref ?? s.id, effectiveInput) : "";
  };
  const setText = (id: string, text: string) => setDraft((d) => ({ ...d, texts: { ...d.texts, [id]: text } }));

  const aiSections = sections.filter((s) => s.kind === "ai");
  // Tanpa sumber berisi, AI memang tidak boleh mengutip: peringatan "belum ada rujukan" per bagian hanya noise, cukup satu pesan di atas.
  const hasUsableSource = sources.some(isCitable);
  // T13: rujukan di teks dibandingkan dengan daftar sumber (LP/LK): penanda tanpa sumber, sumber yang tidak dirujuk.
  const refAnalysis = useMemo(() => (docType === "RJ" ? null : analyzeReferences(Object.values(draft.texts), draft.sources)), [docType, draft.texts, draft.sources]);
  const citedIds = useMemo(() => new Set(refAnalysis?.cited ?? []), [refAnalysis]);
  const reservedIds = useMemo(() => Object.values(draft.texts).flatMap(extractMarkerIds), [draft.texts]);
  const anyText = Object.values(draft.texts).some((t) => t.trim());
  const warnings = useMemo(() => {
    const out: Record<string, SectionWarnings> = {};
    for (const s of sections) {
      if (s.kind !== "ai") continue;
      const t = s.id in draft.texts ? draft.texts[s.id] : "";
      if (t) out[s.id] = analyzeSection(docType, s, t, effectiveInput, sources);
    }
    return out;
  }, [sections, docType, draft.texts, effectiveInput, sources]);

  const warnCount = Object.values(warnings).filter((w) => w.unknownMarkers.length || (hasUsableSource && w.uncitedParagraphs) || w.unsupportedNumbers.length || w.unsupportedNames?.length).length;
  const needRefCount = aiSections.filter((s) => countNeedsReference(draft.texts[s.id] ?? "") > 0).length;
  // Resume: hanya bagian yang belum ada teksnya. Bagian yang sudah ditulis/diedit tidak pernah ditimpa oleh "Tulis semua".
  const pending = pendingAiSections(sections, draft.texts);
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
      const r = await apiPost<{ text: string; stripped: string[] }>("/api/generate", { docType, sectionId: def.id, ...(outline ? { item: outline.find((i) => i.id === def.id) } : {}), input: effectiveInput, sources }, settings.accessCode);
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
    const queue = [...pending];
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
    const emptyManual = sections.filter((s) => s.manual && !textOf(s).trim());
    if ((empty.length || emptyManual.length) && !window.confirm(`${empty.length} bagian AI dan ${emptyManual.length} bagian isi-sendiri masih kosong dan akan tampil tanpa isi (bagian isi-sendiri ditulis "${KOSONG}"). Tetap unduh?`)) return;
    setDl({ busy: true, error: "" });
    setDlWarn([]);
    try {
      const judul = documentTitle(docType, effectiveInput, tpl.name);
      const blob = await apiDocx(
        {
          docType,
          judul,
          style: settings.style,
          identity: identityPayload(effectiveInput),
          sources,
          sections: sectionPayload(sections, effectiveInput, textOf),
        },
        settings.accessCode,
        tplRec ? { data: tplRec.data, mapping: tplRec.mapping } : undefined,
        setDlWarn
      );
      saveBlob(blob, safeFileName(judul, tpl.short));
      setDl({ busy: false, error: "" });
    } catch (e) {
      setDl({ busy: false, error: e instanceof Error ? e.message : "Gagal membuat file." });
    }
  };

  // ---- Tahap B: struktur dari template ----
  const hasDynamicTexts = Object.keys(draft.texts).some((k) => /^o\d+$/.test(k));
  const onTemplateChange = (r: StoredTemplate | null) => {
    // Template dihapus atau diganti file lain: struktur lama tidak berlaku lagi.
    if (!r || r.savedAt !== tplRec?.savedAt) setDraft((d) => (d.outline ? { ...d, outline: null, texts: dropDynamicTexts(d.texts) } : d));
    setTplRec(r);
  };
  const adoptOutline = (items: OutlineItem[], samples: { h1: number | null; h2: number | null; h3: number | null }) => {
    setDraft((d) => ({ ...d, outline: items, texts: dropDynamicTexts(d.texts) }));
    if (!tplRec) return;
    // Format judul per tingkat mengikuti judul nyata di template, bukan tebakan Tahap A.
    const s = tplRec.mapping.samples;
    const rec: StoredTemplate = { ...tplRec, mapping: { ...tplRec.mapping, samples: { ...s, h1: samples.h1 ?? s.h1, h2: samples.h2 ?? s.h2, h3: samples.h3 ?? s.h3 } }, version: (tplRec.version ?? 1) + 1 };
    setTplRec(rec);
    void saveTemplate(docType, rec);
  };

  // Jurnal di Reading Journal bisa dipakai sebagai sumber di LP/LK lewat Pustaka Saya.
  const saveJournalToLibrary = () => {
    const j = sources[0];
    if (!j) return;
    if (findDuplicateOf(library, j)) {
      setLibMsg("Jurnal ini sudah ada di Pustaka Saya.");
      return;
    }
    const { id: _id, ...rest } = j;
    void _id;
    setLibrary((l) => [...l, { ...rest, id: nextSourceId(l), content: rest.content?.slice(0, 12_000) }]);
    setLibMsg("Tersimpan. Ambil dari Pustaka Saya di langkah Referensi pada LP atau LK untuk mengutipnya.");
  };

  const reset = () => {
    if (window.confirm("Hapus semua isian dan hasil untuk dokumen ini?")) {
      // T11: template tetap terpasang, jadi rujukannya (id, versi, pemetaan) ikut dipertahankan di draf kosong.
      setDraft({ ...EMPTY_DRAFT, template: draft.template ?? null });
      setStripped({});
      setSecErr({});
      setErrors({});
    }
  };

  // T07: kasus bersama hanya dipakai bila pengguna memilihnya (opt-in) dan setelah konfirmasi. Tanpa itu dokumen berdiri sendiri.
  const linked = isLinked(docType, sharedCase);
  const hasSharedCase = !!(sharedCase.kasus || sharedCase.jenis_asuhan);
  const linkToCase = () => {
    if (!window.confirm(linkConfirmMessage(docType, reusePreview(docType, draft.input, sharedCase)))) return;
    setSharedCase((c) => linkDoc(docType, c));
  };
  const unlinkFromCase = () => {
    // Nilai yang sedang dipakai disalin ke draf, jadi dokumen ini tidak kehilangan isiannya.
    const keep = caseDerivedInput(docType, draft.input, sharedCase);
    setDraft((d) => ({ ...d, input: keep }));
    setSharedCase((c) => unlinkDoc(docType, c));
  };

  if (!hydrated) return <div className="card h-64 animate-pulse" />;

  // T12: pratinjau perkiraan (dihitung hanya saat dibuka). Bahan sama dengan unduhan .docx, tetapi tidak meniru template kampus.
  const previewDoc = showPreview
    ? buildPreview({
        coverTitle: tpl.coverTitle,
        judul: documentTitle(docType, effectiveInput, tpl.name),
        identity: identityPayload(effectiveInput),
        sections: sectionPayload(sections, effectiveInput, textOf),
        sources,
        style: settings.style,
        chapterStyle: tpl.chapterStyle,
      })
    : null;

  const renderField = (f: FieldDef) => {
    if (f.type === "journal") {
      return (
        <div key={f.id}>
          <JournalField value={value} onPatch={patchInput} accessCode={settings.accessCode} />
          {["j_title", "j_year", "j_text"].map((k) => errors[k] && <p key={k} className="mt-2 text-sm text-red-600">{errors[k]}</p>)}
        </div>
      );
    }
    if (f.type === "serial") {
      return (
        <div key={f.id} className="sm:col-span-2">
          <SerialField label={f.label} help={f.help} value={value(f.id)} onChange={(v) => patchInput({ [f.id]: v })} />
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

      {hasSharedCase || linked ? (
        <div className="rounded-md border border-line bg-card p-3 text-sm">
          {linked ? (
            <p>
              <b>Terhubung ke kasus bersama:</b> {[sharedCase.jenis_asuhan, sharedCase.kasus].filter(Boolean).join(" · ") || "(belum diisi)"}
              {docType === "RJ" ? " — topik jurnal terisi dari kasus ini (boleh diubah)." : " — jenis asuhan dan kasus mengikuti kasus bersama."}{" "}
              <Link href="/kasus" className="text-brand underline">
                Kelola
              </Link>{" · "}
              <button type="button" className="text-brand underline" onClick={unlinkFromCase}>
                Lepas tautan
              </button>
            </p>
          ) : (
            <p>
              Dokumen ini berdiri sendiri. Ada kasus bersama ({[sharedCase.jenis_asuhan, sharedCase.kasus].filter(Boolean).join(" · ")}) yang bisa Anda pakai di sini bila mau.{" "}
              <button type="button" className="text-brand underline" onClick={linkToCase}>
                Pakai kasus bersama…
              </button>
            </p>
          )}
          {docType === "RJ" && linked && searchKeywords(sharedCase) && <p className="mt-1 text-xs text-muted">Kata kunci untuk mencari jurnal: {searchKeywords(sharedCase)}</p>}
        </div>
      ) : null}

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

      {cur.id === "format" && <TemplateStep docType={docType} record={tplRec} loading={tplLoading} onChange={onTemplateChange} accessCode={settings.accessCode} />}

      {cur.id === "struktur" &&
        (tplRec ? (
          <OutlineStep
            docType={docType}
            record={tplRec}
            outline={outline}
            hasTexts={hasDynamicTexts}
            onAdopt={adoptOutline}
            onChange={(items) => setDraft((d) => ({ ...d, outline: items }))}
            onReset={() => setDraft((d) => ({ ...d, outline: null, texts: dropDynamicTexts(d.texts) }))}
          />
        ) : (
          <section className="card p-5">
            <h2 className="text-lg font-semibold">Struktur dokumen</h2>
            <p className="mt-1 text-sm text-muted">
              Langkah ini aktif bila Anda mengunggah template kampus di langkah Format: bab dan subbab dokumen akan mengikuti judul di template Anda. Tanpa template, dokumen memakai struktur bawaan NAKESA. Tekan Lanjut untuk meneruskan.
            </p>
          </section>
        ))}

      {cur.id !== "hasil" && cur.id !== "referensi" && cur.id !== "format" && cur.id !== "struktur" && (
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
            {!sources.some(isCitable) && (
              <p className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
                Belum ada sumber berisi. Dokumen tetap bisa dibuat, tetapi tanpa rujukan otomatis dan bagian teori akan diberi peringatan &quot;belum ada rujukan&quot;.
              </p>
            )}
            {refAnalysis && refAnalysis.dangling.length > 0 && (
              <p className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
                Teks masih memuat penanda {refAnalysis.dangling.map((id) => `[${id}]`).join(", ")} yang tidak punya sumber di daftar ini (sumbernya sudah dihapus, atau penandanya karangan). Penanda itu tidak menjadi sitasi di file Word; hapus atau ganti di langkah Hasil.
              </p>
            )}
            {refAnalysis && refAnalysis.citedNotCitable.length > 0 && (
              <p className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
                Sumber {refAnalysis.citedNotCitable.map((id) => `[${id}]`).join(", ")} dirujuk di teks padahal tidak boleh dikutip AI (tanpa isi, atau DOI-nya perlu ditinjau). Periksa kalimat yang merujuknya.
              </p>
            )}
            {refAnalysis && anyText && refAnalysis.uncited.length > 0 && (
              <p className="mt-3 text-xs text-muted">
                {refAnalysis.uncited.length} sumber belum dirujuk di teks ({refAnalysis.uncited.map((id) => `[${id}]`).join(", ")}) dan tidak akan masuk daftar pustaka.
              </p>
            )}
          </div>
          <SourceManager
            sources={draft.sources}
            onChange={(s) => setDraft((d) => ({ ...d, sources: s }))}
            accessCode={settings.accessCode}
            library={library}
            citedIds={anyText ? citedIds : undefined}
            reservedIds={reservedIds}
            onSaveLibrary={(s) => {
              const { id: _id, ...rest } = s;
              void _id;
              if (findDuplicateOf(library, rest)) return;
              setLibrary((l) => [...l, { ...rest, id: nextSourceId(l) }]);
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
                  {warnCount > 0 && <> · <span className="font-medium text-amber-600">{warnCount} bagian perlu ditinjau</span></>}
                  {needRefCount > 0 && <> · <span className="font-medium text-amber-600">{needRefCount} bagian perlu referensi</span></>} · gaya rujukan {settings.style} · format {tplRec ? `template ${tplRec.name}` : "bawaan NAKESA"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {running ? (
                  <button className="btn" onClick={() => (stopRef.current = true)}>
                    Hentikan
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={genAll} disabled={pending.length === 0}>
                    <Icon name="spark" className="h-4 w-4" /> {doneCount > 0 && pending.length > 0 ? `Lanjutkan menulis (${pending.length} tersisa)` : "Tulis semua bagian"}
                  </button>
                )}
                <button className="btn" onClick={download} disabled={dl.busy}>
                  <Icon name="download" className="h-4 w-4" /> {dl.busy ? "Menyusun…" : "Unduh .docx"}
                </button>
                <button className="btn" onClick={() => setShowPreview((v) => !v)}>
                  <Icon name="file" className="h-4 w-4" /> {showPreview ? "Tutup pratinjau" : "Pratinjau / PDF (perkiraan)"}
                </button>
              </div>
            </div>
            {!hasUsableSource && docType !== "RJ" && (
              <p className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
                Belum ada sumber berisi di langkah Referensi, jadi AI tidak mengutip apa pun. {docType === "LP" ? "Paragraf teori ditulis umum dan ditandai [perlu referensi]; tanda itu tampil juga di file Word sampai Anda menambah sumber berisi lalu menulis ulang bagiannya." : "Seluruh bagian teori ditulis tanpa rujukan. Tambahkan buku/jurnal beserta isinya di langkah Referensi, lalu tulis ulang bagian yang diperlukan."}
              </p>
            )}
            {dl.error && <p className="mt-3 text-sm text-red-600">{dl.error}</p>}
            {dlWarn.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 rounded-md bg-[var(--warn-bg)] p-3 pl-7 text-sm text-[var(--warn-ink)]">
                {dlWarn.map((c) => (
                  <li key={c}>{warningText(c)}</li>
                ))}
              </ul>
            )}
            {docType === "RJ" && sources[0] && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="btn btn-sm" onClick={saveJournalToLibrary}>
                  Simpan jurnal ke Pustaka Saya
                </button>
                {libMsg && <span className="text-xs text-muted">{libMsg}</span>}
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              Ini draf. Tinjau setiap bagian sebelum dikumpulkan. Penanda seperti [S1] otomatis menjadi sitasi dan daftar pustaka di file Word. Bagian bertanda kuning perlu pengecekan Anda.
            </p>
          </div>

          {previewDoc && <PreviewPane doc={previewDoc} formatLabel={tplRec ? `template ${tplRec.name}` : "bawaan NAKESA"} onClose={() => setShowPreview(false)} />}

          {sections.map((s) => {
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
                  {s.kind === "data" && <span className="badge badge-mute">{s.manual ? "Isi sendiri" : "Dari isian Anda"}</span>}
                  {s.kind === "ai" && s.patientSpecific && <span className="badge badge-warn">Analisis pasien: tinjau</span>}
                  {s.kind === "ai" && s.appraisal && <span className="badge badge-warn">Telaah kritis: penilaian, bukan isi artikel</span>}
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
                  placeholder={s.kind === "ai" ? "Klik 'Tulis bagian ini' atau ketik sendiri." : s.manual ? "Ketik sendiri dari data yang sebenarnya." : ""}
                />

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {s.kind === "ai" ? (
                    <button className="btn btn-sm" onClick={() => genOne(s)} disabled={!!busy[s.id]}>
                      <Icon name="spark" className="h-3.5 w-3.5" /> {busy[s.id] ? "Menulis…" : text.trim() ? "Tulis ulang" : "Tulis bagian ini"}
                    </button>
                  ) : s.manual ? null : (
                    <button className="btn btn-sm" onClick={() => setDraft((d) => { const t = { ...d.texts }; delete t[s.id]; return { ...d, texts: t }; })}>
                      Susun ulang dari isian
                    </button>
                  )}
                  {w?.unknownMarkers.length ? <span className="badge badge-bad">Rujukan {w.unknownMarkers.join(", ")} tidak ada di daftar sumber</span> : null}
                  {hasUsableSource && w?.uncitedParagraphs ? <span className="badge badge-warn">{w.uncitedParagraphs} paragraf belum ada rujukan</span> : null}
                  {countNeedsReference(text) > 0 ? <span className="badge badge-warn">{countNeedsReference(text)} paragraf perlu referensi</span> : null}
                  {w?.unsupportedNumbers.length ? (
                    <span className="badge badge-bad">Angka tidak ditemukan di {docType === "RJ" ? "teks jurnal" : "isian Anda"}: {w.unsupportedNumbers.join(", ")}</span>
                  ) : null}
                  {w?.unsupportedNames?.length ? <span className="badge badge-bad">Nama penulis tidak ditemukan di teks jurnal: {w.unsupportedNames.join(", ")}</span> : null}
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
