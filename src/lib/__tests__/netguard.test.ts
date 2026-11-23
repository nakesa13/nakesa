import { describe, expect, it } from "vitest";
import { UrlImportError, isBlockedAddress, parseIPv6, parsePublicUrl } from "../netguard";

/** T04: pagar SSRF. Tanpa jaringan: semua pemeriksaan di sini murni. */

const BLOCKED = [
  "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.100.100.200",
  "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.0.192", "198.18.0.1",
  "::1", "::", "fe80::1", "fe80::1%eth0", "fc00::1", "fd00:ec2::254", "ff02::1",
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::127.0.0.1", "0:0:0:0:0:ffff:10.0.0.1",
  "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "2001:db8::1", "2001::1",
  "bukan-ip", "1.2.3", "999.1.1.1",
];
const PUBLIC = [
  "8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "100.63.255.255", "100.128.0.1",
  "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::",
];

describe("isBlockedAddress", () => {
  it.each(BLOCKED)("memblokir %s", (a) => expect(isBlockedAddress(a)).toBe(true));
  it.each(PUBLIC)("meloloskan alamat publik %s", (a) => expect(isBlockedAddress(a)).toBe(false));
  it("parseIPv6: bentuk sah dan tidak sah", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(parseIPv6(":::")).toBeNull();
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIPv6("1::2::3")).toBeNull();
  });
});

describe("parsePublicUrl", () => {
  const BAD = [
    "file:///etc/passwd", "ftp://example.com/a", "javascript:alert(1)", "data:text/html,x", "gopher://example.com",
    "http://localhost/", "http://foo.localhost/", "http://intranet/", "http://printer.local/", "http://metadata.google.internal/",
    "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://0/", "http://127.0.0.1./",
    "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fd00:ec2::254]/",
    "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1:8080/",
    "http://user:pw@example.com/", "http://example.com:22/", "http://example.com:6379/",
    "https://example.123/", "http://1.2.3.4.5/", "http://exa mple.com", "http://example.com/\r\nHost: x", "", "   ",
  ];
  it.each(BAD)("menolak %j", (u) => expect(() => parsePublicUrl(u)).toThrow(UrlImportError));

  it("menolak URL lebih dari 2048 karakter", () => {
    expect(() => parsePublicUrl(`https://example.com/${"a".repeat(2100)}`)).toThrow(UrlImportError);
  });

  it.each(["https://example.com/a?b=1#c", "http://example.com:8080/x", "https://doi.org/10.1234/x", "https://sub.example.co.id/jurnal.pdf", "http://8.8.8.8/"])(
    "menerima URL publik %s",
    (u) => expect(parsePublicUrl(u)).toBeInstanceOf(URL)
  );
});
