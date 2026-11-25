"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commitDraft, mergeConflicts, resolveConflicts, revOf, type Choice, type Conflict, type DraftStorage } from "./conflict";
import type { Draft } from "./draft";
import { readLocalValue, useLocalState } from "./useLocalState";

/**
 * T40: draf dokumen dengan deteksi konflik edit antar tab (lihat conflict.ts).
 * Pengganti useLocalState<Draft> di formulir: `update` punya bentuk yang sama dengan setter lama, tetapi perubahan yang
 * bertabrakan dengan tulisan tab lain TIDAK menimpa; ia ditahan sebagai konflik sampai pengguna memilih (`resolve`).
 */
export function useGuardedDraft(key: string, initial: Draft) {
  const [draft, setLocal] = useLocalState<Draft>(key, initial);
  // Keadaan yang terakhir dilihat tab ini (hasil render, atau hasil tulis/baca terakhir). Dasar (`base`) untuk perubahan berikutnya.
  const viewRef = useRef<Draft>(draft);
  useEffect(() => {
    viewRef.current = draft;
  }, [draft]);

  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const storage = useMemo<DraftStorage>(() => ({ read: () => readLocalValue<Draft>(key, initial), write: (d) => setLocal(d) }), [key, initial, setLocal]);

  /**
   * Ubah draf. `opts.base` = keadaan yang dilihat penyunting saat pekerjaan dimulai (mis. sebelum AI menulis); tanpa itu dipakai
   * keadaan terakhir yang dilihat tab ini. Mengembalikan konflik baru (kosong bila semua tertulis).
   */
  const update = useCallback(
    (u: Draft | ((d: Draft) => Draft), opts?: { base?: Draft }): Conflict[] => {
      const base = opts?.base ?? viewRef.current;
      const next = typeof u === "function" ? u(base) : u;
      const r = commitDraft(storage, base, next);
      viewRef.current = r.draft;
      if (r.conflicts.length) setConflicts((c) => mergeConflicts(c, r.conflicts));
      return r.conflicts;
    },
    [storage]
  );

  /** Ganti seluruh draf dengan sengaja (mis. "Mulai baru" setelah konfirmasi). Menaikkan rev, jadi tab lain ikut melihatnya. */
  const replace = useCallback(
    (next: Draft) => {
      const out: Draft = { ...next, rev: revOf(storage.read()) + 1 };
      storage.write(out);
      viewRef.current = out;
      setConflicts([]);
    },
    [storage]
  );

  /** Terapkan pilihan pengguna untuk konflik yang tertahan. Slot yang berubah lagi di tengah jalan kembali menjadi konflik. */
  const resolve = useCallback(
    (choices: Record<string, Choice | undefined>) => {
      const r = resolveConflicts(storage, conflicts, choices);
      viewRef.current = r.draft;
      setConflicts(r.conflicts);
    },
    [storage, conflicts]
  );

  const snapshot = useCallback(() => viewRef.current, []);
  /** Draf sudah ditulis tab/perangkat lain sejak terakhir dilihat tab ini. */
  const isStale = useCallback(() => revOf(storage.read()) !== revOf(viewRef.current), [storage]);

  return { draft, update, replace, resolve, snapshot, isStale, conflicts };
}
