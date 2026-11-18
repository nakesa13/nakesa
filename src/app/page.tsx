import Link from "next/link";
import { DraftHint } from "@/components/DraftHint";
import { Icon } from "@/components/Icon";
import { TEMPLATES } from "@/templates";
import type { DocType } from "@/lib/types";

const CARDS: { type: DocType; href: string; icon: string; tag: string }[] = [
  { type: "LP", href: "/lp", icon: "file", tag: "Teori kasus + konsep asuhan 7 langkah Varney" },
  { type: "LK", href: "/lk", icon: "heart", tag: "Asuhan pada satu pasien, data klinis dari Anda" },
  { type: "RJ", href: "/rj", icon: "journal", tag: "Telaah jurnal dari PDF yang Anda unggah" },
];

const PRINSIP = [
  ["Rujukan tidak dikarang", "Sitasi hanya untuk sumber yang isinya Anda lampirkan. Daftar pustaka disusun kode dari metadata sumber, bukan ditulis AI."],
  ["Data klinis dari Anda", "TTV, hasil lab, dan tindakan pada LK hanya dari isian Anda. Kolom kosong tertulis [belum diisi]. Angka asing di analisis AI ditandai."],
  ["Ringkasan dari jurnal", "Reading Journal hanya dari teks jurnal yang diunggah. Angka yang tidak ada di jurnal ditandai."],
  ["Anda tetap penulis", "Setiap bagian bisa diedit, ditulis ulang, dan harus Anda tinjau sebelum mengunduh file Word."],
];

export default function Home() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Selamat datang di NAKESA</h1>
        <p className="mt-1 text-muted">Susun dokumen asuhan kebidanan dengan rujukan yang dapat diverifikasi, lalu unduh sebagai file Word.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.type} href={c.href} className="card group block p-5 transition hover:border-brand">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand">
              <Icon name={c.icon} />
            </div>
            <h2 className="font-semibold">{TEMPLATES[c.type].name}</h2>
            <p className="mt-1 text-sm text-muted">{c.tag}</p>
            <div className="mt-3 flex items-center justify-between">
              <DraftHint docType={c.type} />
              <span className="text-sm font-medium text-brand group-hover:underline">Buka →</span>
            </div>
          </Link>
        ))}
      </div>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Prinsip NAKESA</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          {PRINSIP.map(([t, d]) => (
            <div key={t}>
              <dt className="text-sm font-medium">{t}</dt>
              <dd className="mt-0.5 text-sm text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card p-5">
        <h2 className="mb-2 font-semibold">Mulai cepat</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            Isi identitas sekali di <Link className="text-brand underline" href="/pengaturan">Pengaturan</Link> dan pilih gaya rujukan (APA/Vancouver).
          </li>
          <li>Pilih dokumen, isi langkah demi langkah, tambahkan referensi berisi.</li>
          <li>Di halaman Hasil, klik &quot;Tulis semua bagian&quot;, tinjau, perbaiki bagian bertanda kuning, lalu unduh .docx.</li>
        </ol>
      </section>
    </div>
  );
}
