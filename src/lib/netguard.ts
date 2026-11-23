import { isIP } from "node:net";

/**
 * T04: pagar SSRF untuk impor sumber dari URL. Hanya di server.
 * Aturannya sederhana dan konservatif: hanya http(s), tanpa kredensial, port tertentu, dan setiap alamat IP
 * tujuan (termasuk hasil DNS dan tujuan pengalihan) harus alamat publik. Yang tidak dikenali dianggap tidak aman.
 */

export class UrlImportError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "UrlImportError";
  }
}

export const MAX_URL_LENGTH = 2048;

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

/** Akhiran nama host yang hanya bermakna di jaringan internal. */
const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet", ".corp", ".private"];

const BLOCKED_MSG = "Alamat tujuan tidak diizinkan (jaringan internal atau pribadi).";

export function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((x) => x >= 0 && x <= 255) ? o : null;
}

/** IPv4 yang bukan alamat publik: privat, loopback, link-local (termasuk metadata cloud 169.254.169.254), CGNAT, multicast, cadangan. */
export function isBlockedIPv4(o: number[]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT, juga metadata Alibaba)
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, metadata AWS/GCP/Azure
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, cadangan, broadcast
  return false;
}

/** Urai IPv6 (termasuk "::" dan ekor IPv4) menjadi 8 kelompok 16-bit, atau null bila tidak sah. */
export function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (s.length === 0 || s.length > 45) return null;
  const lastColon = s.lastIndexOf(":");
  if (lastColon === -1) return null;
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = parseIPv4(last);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const groups = (p: string) => (p === "" ? [] : p.split(":"));
  const head = groups(parts[0]);
  const rest = parts.length === 2 ? groups(parts[1]) : [];
  if (parts.length === 1 && head.length !== 8) return null;
  if (parts.length === 2 && head.length + rest.length > 7) return null;
  const fill = parts.length === 2 ? new Array<string>(8 - head.length - rest.length).fill("0") : [];
  const all = [...head, ...fill, ...rest];
  if (all.length !== 8) return null;
  const out = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some((x) => Number.isNaN(x)) ? null : out;
}

const v4From = (hi: number, lo: number): number[] => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/** Hanya unicast global (2000::/3) yang publik; bentuk yang membungkus IPv4 (mapped, NAT64, 6to4) diperiksa lewat IPv4-nya. */
export function isBlockedIPv6(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0) {
    if (g4 === 0 && g5 === 0xffff) return isBlockedIPv4(v4From(g6, g7)); // ::ffff:a.b.c.d
    return true; // ::, ::1, IPv4-compatible, dan sisanya
  }
  if (g0 === 0x64 && g1 === 0xff9b) {
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isBlockedIPv4(v4From(g6, g7)); // NAT64
    return true; // 64:ff9b:1::/48 dan sekitarnya
  }
  if ((g0 & 0xe000) !== 0x2000) return true; // fc00::/7, fe80::/10, ff00::/8, dst.
  if (g0 === 0x2001 && g1 < 0x200) return true; // 2001::/23 (Teredo, ORCHID, protokol)
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // dokumentasi
  if (g0 === 0x2002) return isBlockedIPv4(v4From(g1, g2)); // 6to4
  if (g0 === 0x3fff && g1 < 0x1000) return true; // dokumentasi
  return false;
}

/** true bila alamat bukan IP publik. Teks yang bukan alamat IP dianggap tidak aman. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const o = parseIPv4(address);
    return !o || isBlockedIPv4(o);
  }
  if (family === 6) {
    const g = parseIPv6(address);
    return !g || isBlockedIPv6(g);
  }
  return true;
}

export function assertPublicAddress(address: string): void {
  if (isBlockedAddress(address)) throw new UrlImportError(BLOCKED_MSG, 400);
}

/**
 * Validasi URL dari pengguna sebelum dihubungi. Mengembalikan URL ter-normalisasi.
 * WHATWG URL sudah menormalkan bentuk IP aneh (desimal 2130706433, heksa 0x7f.1, oktal) menjadi titik-desimal,
 * sehingga pemeriksaan di bawah melihat bentuk akhirnya.
 */
export function parsePublicUrl(raw: string): URL {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw new UrlImportError("URL belum diisi.");
  if (s.length > MAX_URL_LENGTH) throw new UrlImportError("URL terlalu panjang.");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F\s]/.test(s)) throw new UrlImportError("URL tidak valid.");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new UrlImportError("URL tidak valid.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UrlImportError("Hanya URL http:// atau https:// yang diterima.");
  if (u.username || u.password) throw new UrlImportError("URL yang memuat nama pengguna atau kata sandi tidak diterima.");
  if (!ALLOWED_PORTS.has(u.port)) throw new UrlImportError("Port URL tidak diizinkan.");

  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new UrlImportError("URL tidak valid.");
  if (isIP(host)) {
    assertPublicAddress(host);
    return u;
  }
  if (host === "localhost" || INTERNAL_SUFFIXES.some((x) => host.endsWith(x))) throw new UrlImportError(BLOCKED_MSG, 400);
  if (!host.includes(".")) throw new UrlImportError("Nama situs tidak valid.");
  const tld = host.slice(host.lastIndexOf(".") + 1);
  if (/^\d+$/.test(tld) || /^0x/i.test(tld)) throw new UrlImportError("Nama situs tidak valid.");
  return u;
}
