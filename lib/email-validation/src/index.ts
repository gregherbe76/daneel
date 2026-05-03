import { promises as dns } from "node:dns";

export type EmailValidationStatus = "valid" | "invalid" | "risky" | "unchecked";

export type EmailValidationResult = {
  status: EmailValidationStatus;
  reason: string;
};

const MX_LOOKUP_TIMEOUT_MS = 4_000;
const mxCache = new Map<string, EmailValidationResult>();

const KNOWN_UNDELIVERABLE_DOMAINS = new Set<string>([
  "users.noreply.github.com",
  "noreply.github.com",
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "localhost",
]);

const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com",
  "tempmail.com",
  "10minutemail.com",
  "guerrillamail.com",
  "trashmail.com",
  "yopmail.com",
  "throwawaymail.com",
]);

function syntaxOk(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS lookup timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkMxRecords(domain: string): Promise<EmailValidationResult> {
  const cached = mxCache.get(domain);
  if (cached) return cached;

  let result: EmailValidationResult;
  try {
    const records = await withTimeout(dns.resolveMx(domain), MX_LOOKUP_TIMEOUT_MS);
    if (records && records.length > 0) {
      result = { status: "valid", reason: `MX records found (${records.length})` };
    } else {
      try {
        const a = await withTimeout(dns.resolve4(domain), MX_LOOKUP_TIMEOUT_MS);
        result = a.length > 0
          ? { status: "risky", reason: "No MX records — domain has A record fallback" }
          : { status: "invalid", reason: "No MX or A records for domain" };
      } catch {
        result = { status: "invalid", reason: "No MX records and no A record for domain" };
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      try {
        const a = await withTimeout(dns.resolve4(domain), MX_LOOKUP_TIMEOUT_MS);
        result = a.length > 0
          ? { status: "risky", reason: "No MX records — domain has A record fallback" }
          : { status: "invalid", reason: `Domain has no mail servers (${code})` };
      } catch {
        result = { status: "invalid", reason: `Domain has no mail servers (${code})` };
      }
    } else {
      result = { status: "unchecked", reason: `MX lookup failed: ${(err as Error).message}` };
    }
  }

  if (result.status !== "unchecked") mxCache.set(domain, result);
  return result;
}

/**
 * Validate an email address using a lightweight, dependency-free pipeline:
 *   1. Syntax check
 *   2. Known-undeliverable / disposable domain blocklist
 *   3. MX record DNS lookup (with A record fallback)
 *
 * Designed to never throw — sourcing should not fail because DNS hiccupped.
 */
export async function validateEmail(email: string | null | undefined): Promise<EmailValidationResult> {
  if (!email) return { status: "invalid", reason: "No email address" };
  const e = email.toLowerCase().trim();
  if (!syntaxOk(e)) return { status: "invalid", reason: "Malformed email syntax" };

  const domain = e.split("@")[1];
  if (!domain) return { status: "invalid", reason: "Missing email domain" };

  if (KNOWN_UNDELIVERABLE_DOMAINS.has(domain)) {
    return { status: "invalid", reason: `Placeholder domain (${domain}) is not deliverable` };
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { status: "risky", reason: `Disposable email domain (${domain})` };
  }

  try {
    return await checkMxRecords(domain);
  } catch {
    return { status: "unchecked", reason: "Validation crashed unexpectedly" };
  }
}
