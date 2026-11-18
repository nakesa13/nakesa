"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

/** True setelah halaman dimuat di browser (false saat render server / hidrasi). */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * State yang disimpan di localStorage. Aman saat penyimpanan diblokir (jatuh ke nilai awal).
 * `initial` harus konstanta stabil (didefinisikan di luar komponen).
 */
export function useLocalState<T>(key: string, initial: T): readonly [T, (u: T | ((prev: T) => T)) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null
  );

  const value = useMemo<T>(() => {
    if (raw == null) return initial;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  }, [raw, initial]);

  const set = useCallback(
    (u: T | ((prev: T) => T)) => {
      let prev = initial;
      const cur = read(key);
      if (cur != null) {
        try {
          prev = JSON.parse(cur) as T;
        } catch {
          /* abaikan data rusak */
        }
      }
      const next = typeof u === "function" ? (u as (p: T) => T)(prev) : u;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* penyimpanan penuh / diblokir */
      }
      listeners.forEach((l) => l());
    },
    [key, initial]
  );

  return [value, set] as const;
}

export function clearLocal(prefix: string) {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* abaikan */
  }
  listeners.forEach((l) => l());
}
