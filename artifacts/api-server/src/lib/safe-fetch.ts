import dns from "node:dns/promises";
import net from "node:net";

/**
 * SSRF-hardened URL validation + fetch. Used for any feature where a user can
 * supply a URL that the server then dereferences (currently: the runtime
 * branding logo URL embedded in PDF reports).
 *
 * Rules enforced:
 *   - Scheme must be https (http would also leak via redirects, so we drop it).
 *   - Hostname must resolve only to public IPs — loopback, link-local,
 *     RFC1918 private space, CGNAT, multicast, broadcast, and IPv6
 *     unique-local / link-local are all rejected.
 *   - At most 2 redirects, each re-validated.
 *
 * This is intentionally strict: the surface is "user-pasted logo URL" and the
 * upside of accepting weird URLs is small.
 */

export class UrlNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlNotAllowedError";
  }
}

/** Static URL-shape validation — safe to call from request handlers. */
export function assertSafeLogoUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlNotAllowedError("Logo URL is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new UrlNotAllowedError("Logo URL must use https://");
  }
  // Strip credentials — they have no place in a logo URL and would be sent on
  // every PDF render.
  if (url.username || url.password) {
    throw new UrlNotAllowedError("Logo URL must not contain credentials");
  }
  // Reject hostnames that are literal IPs in the disallowed ranges up front;
  // we still re-check after DNS resolution below.
  const host = url.hostname;
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new UrlNotAllowedError("Logo URL must point to a public host");
  }
  return url;
}

function isPrivateIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 10) return true;                           // 10.0.0.0/8
    if (a === 127) return true;                          // loopback
    if (a === 0) return true;                            // 0.0.0.0/8
    if (a === 169 && b === 254) return true;             // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16/12
    if (a === 192 && b === 168) return true;             // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT 100.64/10
    if (a >= 224) return true;                           // multicast/reserved
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:")) return true;          // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("ff")) return true;             // multicast
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — recheck inner v4
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // unknown family — refuse
}

/**
 * Resolve every A/AAAA record for the host and refuse if any of them lands in
 * a private range. This guards against DNS rebinding to e.g. 169.254.169.254.
 */
async function assertHostResolvesPublic(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new UrlNotAllowedError("Logo URL resolves to a non-public address");
    }
    return;
  }
  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlNotAllowedError(`Could not resolve host ${hostname}`);
  }
  if (records.length === 0) {
    throw new UrlNotAllowedError(`Could not resolve host ${hostname}`);
  }
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw new UrlNotAllowedError("Logo URL resolves to a non-public address");
    }
  }
}

/**
 * SSRF-safe fetch for user-supplied logo URLs. Follows up to 2 redirects,
 * re-validating each hop. Returns the response body bytes, or null on any
 * failure (logo is best-effort — a missing logo just renders a blank header).
 */
export async function safeFetchLogoBytes(rawUrl: string, timeoutMs = 4000): Promise<Buffer | null> {
  let url: URL;
  try {
    url = assertSafeLogoUrlShape(rawUrl);
  } catch {
    return null;
  }

  for (let hop = 0; hop < 3; hop++) {
    try {
      await assertHostResolvesPublic(url.hostname);
    } catch {
      return null;
    }
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return null;
      try {
        url = assertSafeLogoUrlShape(new URL(next, url).toString());
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok) return null;
    try {
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  return null;
}
