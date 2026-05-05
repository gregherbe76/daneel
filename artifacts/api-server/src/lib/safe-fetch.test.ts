import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();

vi.mock("node:dns/promises", () => ({
  default: { lookup: (...args: unknown[]) => lookupMock(...args) },
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import {
  UrlNotAllowedError,
  assertSafeLogoUrlShape,
  safeFetchLogoBytes,
} from "./safe-fetch";

describe("assertSafeLogoUrlShape", () => {
  it("accepts a normal public https URL", () => {
    const url = assertSafeLogoUrlShape("https://example.com/logo.png");
    expect(url.hostname).toBe("example.com");
  });

  it("rejects http://", () => {
    expect(() => assertSafeLogoUrlShape("http://example.com/logo.png"))
      .toThrow(UrlNotAllowedError);
  });

  it("rejects strings that aren't URLs at all", () => {
    expect(() => assertSafeLogoUrlShape("definitely not a url"))
      .toThrow(/valid URL/);
  });

  it("rejects URLs that embed basic-auth credentials", () => {
    expect(() => assertSafeLogoUrlShape("https://user:pass@example.com/x.png"))
      .toThrow(/credentials/);
  });

  it("rejects URLs with only a username component", () => {
    expect(() => assertSafeLogoUrlShape("https://user@example.com/x.png"))
      .toThrow(/credentials/);
  });

  describe("private IPv4 literal rejection", () => {
    const cases: Array<[string, string]> = [
      ["loopback 127.0.0.1", "https://127.0.0.1/x.png"],
      ["loopback 127.5.6.7", "https://127.5.6.7/x.png"],
      ["0.0.0.0/8", "https://0.0.0.0/x.png"],
      ["RFC1918 10/8", "https://10.0.0.1/x.png"],
      ["RFC1918 172.16/12 low", "https://172.16.0.1/x.png"],
      ["RFC1918 172.16/12 high", "https://172.31.255.255/x.png"],
      ["RFC1918 192.168/16", "https://192.168.1.1/x.png"],
      ["link-local 169.254/16", "https://169.254.169.254/x.png"],
      ["CGNAT 100.64/10 low", "https://100.64.0.1/x.png"],
      ["CGNAT 100.64/10 high", "https://100.127.255.255/x.png"],
      ["multicast 224/4", "https://224.0.0.1/x.png"],
      ["reserved 240/4", "https://240.0.0.1/x.png"],
    ];
    for (const [label, url] of cases) {
      it(`rejects ${label}`, () => {
        expect(() => assertSafeLogoUrlShape(url)).toThrow(/public host/);
      });
    }
  });

  it("accepts a public-looking IPv4 literal (still subject to DNS check on fetch)", () => {
    // 8.8.8.8 is not in any private range — shape check should not reject.
    expect(() => assertSafeLogoUrlShape("https://8.8.8.8/x.png")).not.toThrow();
  });

  it("does NOT reject a CGNAT-edge address that is just outside the range", () => {
    // 100.63.x.x is below CGNAT, 100.128.x.x is above. Both are public.
    expect(() => assertSafeLogoUrlShape("https://100.63.0.1/x.png")).not.toThrow();
    expect(() => assertSafeLogoUrlShape("https://100.128.0.1/x.png")).not.toThrow();
  });
});

describe("safeFetchLogoBytes", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    lookupMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockResolveTo(addresses: string[]) {
    lookupMock.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  }

  function okResponse(body: Uint8Array): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    } as unknown as Response;
  }

  function redirectResponse(location: string): Response {
    return {
      ok: false,
      status: 302,
      headers: new Headers({ location }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
  }

  it("returns bytes for a public host", async () => {
    mockResolveTo(["93.184.216.34"]);
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    fetchMock.mockResolvedValueOnce(okResponse(bytes));

    const out = await safeFetchLogoBytes("https://example.com/logo.png");
    expect(out).toBeInstanceOf(Buffer);
    expect(out!.length).toBe(4);
    expect(out!.equals(Buffer.from(bytes))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the URL fails the static shape check (http://)", async () => {
    const out = await safeFetchLogoBytes("http://example.com/logo.png");
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("returns null when the host resolves to a private IPv4 (DNS rebinding guard)", async () => {
    mockResolveTo(["169.254.169.254"]); // EC2/GCP metadata
    const out = await safeFetchLogoBytes("https://metadata.evil.example/x.png");
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when ANY resolved address is private (multi-record split horizon)", async () => {
    mockResolveTo(["8.8.8.8", "10.0.0.1"]);
    const out = await safeFetchLogoBytes("https://example.com/x.png");
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the host resolves to an IPv4-mapped IPv6 private address", async () => {
    mockResolveTo(["::ffff:127.0.0.1"]);
    const out = await safeFetchLogoBytes("https://example.com/x.png");
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an IPv4-mapped IPv6 PUBLIC address", async () => {
    mockResolveTo(["::ffff:8.8.8.8"]);
    const bytes = new Uint8Array([1, 2, 3]);
    fetchMock.mockResolvedValueOnce(okResponse(bytes));
    const out = await safeFetchLogoBytes("https://example.com/x.png");
    expect(out).not.toBeNull();
    expect(out!.length).toBe(3);
  });

  it("returns null when DNS lookup fails", async () => {
    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const out = await safeFetchLogoBytes("https://nope.invalid/x.png");
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when DNS returns no records", async () => {
    lookupMock.mockResolvedValueOnce([]);
    const out = await safeFetchLogoBytes("https://empty.example/x.png");
    expect(out).toBeNull();
  });

  it("follows a redirect to another public host and re-validates DNS", async () => {
    mockResolveTo(["8.8.8.8"]);
    const bytes = new Uint8Array([9, 9, 9]);
    fetchMock
      .mockResolvedValueOnce(redirectResponse("https://cdn.example.com/final.png"))
      .mockResolvedValueOnce(okResponse(bytes));

    const out = await safeFetchLogoBytes("https://example.com/logo.png");
    expect(out).not.toBeNull();
    expect(out!.length).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // DNS was re-checked on the second hop too.
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to follow a redirect whose target is a private-IP literal", async () => {
    mockResolveTo(["8.8.8.8"]);
    fetchMock.mockResolvedValueOnce(
      redirectResponse("https://127.0.0.1/internal.png"),
    );

    const out = await safeFetchLogoBytes("https://example.com/logo.png");
    expect(out).toBeNull();
    // The second fetch (to 127.0.0.1) must NEVER happen.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to follow a redirect to an http:// URL", async () => {
    mockResolveTo(["8.8.8.8"]);
    fetchMock.mockResolvedValueOnce(
      redirectResponse("http://example.com/insecure.png"),
    );

    const out = await safeFetchLogoBytes("https://example.com/logo.png");
    expect(out).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to follow a redirect whose target host resolves to a private IP", async () => {
    // First hop resolves public; redirect target hostname resolves private.
    lookupMock
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    fetchMock.mockResolvedValueOnce(
      redirectResponse("https://internal.evil.example/x.png"),
    );

    const out = await safeFetchLogoBytes("https://example.com/logo.png");
    expect(out).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null on a redirect with no Location header", async () => {
    mockResolveTo(["8.8.8.8"]);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);

    const out = await safeFetchLogoBytes("https://example.com/logo.png");
    expect(out).toBeNull();
  });

  it("stops after exhausting the redirect budget", async () => {
    mockResolveTo(["8.8.8.8"]);
    fetchMock
      .mockResolvedValueOnce(redirectResponse("https://a.example.com/1"))
      .mockResolvedValueOnce(redirectResponse("https://b.example.com/2"))
      .mockResolvedValueOnce(redirectResponse("https://c.example.com/3"));

    const out = await safeFetchLogoBytes("https://example.com/logo.png");
    expect(out).toBeNull();
    // 3 hops total (the loop runs hop = 0, 1, 2) and then bails out.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null on a non-OK, non-redirect response", async () => {
    mockResolveTo(["8.8.8.8"]);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);

    const out = await safeFetchLogoBytes("https://example.com/missing.png");
    expect(out).toBeNull();
  });

  it("returns null when fetch itself throws (timeout, network)", async () => {
    mockResolveTo(["8.8.8.8"]);
    fetchMock.mockRejectedValueOnce(new Error("AbortError"));

    const out = await safeFetchLogoBytes("https://example.com/x.png");
    expect(out).toBeNull();
  });

  it("returns null when the URL has embedded credentials (shape check rejects)", async () => {
    const out = await safeFetchLogoBytes("https://user:pw@example.com/x.png");
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("skips DNS lookup when the host is already a public IPv4 literal", async () => {
    const bytes = new Uint8Array([7]);
    fetchMock.mockResolvedValueOnce(okResponse(bytes));
    const out = await safeFetchLogoBytes("https://8.8.8.8/x.png");
    expect(out).not.toBeNull();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("returns null for a private IPv4 literal even though shape check would have caught it", async () => {
    // Belt-and-suspenders: even if the shape check were bypassed, the DNS-path
    // private-IP check should still hold. Here the shape check catches it
    // first and returns null without calling fetch or DNS.
    const out = await safeFetchLogoBytes("https://10.0.0.1/x.png");
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
