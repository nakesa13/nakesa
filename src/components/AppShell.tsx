"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Icon } from "./Icon";

const NAV: { group: string; items: { href: string; label: string; icon: string }[] }[] = [
  { group: "Menu", items: [{ href: "/", label: "Beranda", icon: "home" }] },
  {
    group: "Buat Dokumen",
    items: [
      { href: "/lp", label: "Laporan Pendahuluan (LP)", icon: "file" },
      { href: "/lk", label: "Laporan Kasus (LK)", icon: "heart" },
      { href: "/rj", label: "Reading Journal", icon: "journal" },
    ],
  },
  {
    group: "Belajar & Data",
    items: [
      { href: "/sumber", label: "Pustaka Referensi", icon: "bookmark" },
      { href: "/pengaturan", label: "Pengaturan", icon: "sliders" },
    ],
  },
];

function useDark(): [boolean, (v: boolean) => void] {
  const dark = useSyncExternalStore(
    (cb) => {
      const o = new MutationObserver(cb);
      o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => o.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false
  );
  const set = (v: boolean) => {
    document.documentElement.classList.toggle("dark", v);
    try {
      localStorage.setItem("nakesa.theme", v ? "dark" : "light");
    } catch {
      /* abaikan */
    }
  };
  return [dark, set];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false); // mobile
  const [mini, setMini] = useState(false); // desktop
  const [dark, setDark] = useDark();

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="min-h-screen">
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-side text-side-ink transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${mini ? "lg:w-16" : "lg:w-64"}`}
      >
        <Link href="/" onClick={() => setOpen(false)} className="flex h-14 items-center gap-3 border-b border-white/10 px-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-brand-ink">N</span>
          <span className={`text-lg font-semibold tracking-wide text-white ${mini ? "lg:hidden" : ""}`}>NAKESA</span>
        </Link>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((g) => (
            <div key={g.group} className="mb-4">
              <p className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider opacity-60 ${mini ? "lg:hidden" : ""}`}>{g.group}</p>
              {g.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  title={it.label}
                  className={`mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                    active(it.href) ? "bg-brand text-brand-ink" : "hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon name={it.icon} className="h-5 w-5 shrink-0" />
                  <span className={mini ? "lg:hidden" : ""}>{it.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <p className={`border-t border-white/10 px-4 py-3 text-[11px] opacity-60 ${mini ? "lg:hidden" : ""}`}>Versi uji · tanpa login</p>
      </aside>

      <div className={`transition-[padding] ${mini ? "lg:pl-16" : "lg:pl-64"}`}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-card px-4">
          <button
            className="btn btn-sm"
            aria-label="Buka menu"
            onClick={() => {
              if (window.matchMedia("(min-width: 1024px)").matches) setMini((m) => !m);
              else setOpen(true);
            }}
          >
            <Icon name="menu" className="h-4 w-4" />
          </button>
          <p className="hidden text-sm text-muted sm:block">Asisten akademik kebidanan</p>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-sm" onClick={() => setDark(!dark)} aria-label={dark ? "Mode terang" : "Mode gelap"}>
              <Icon name={dark ? "sun" : "moon"} className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
