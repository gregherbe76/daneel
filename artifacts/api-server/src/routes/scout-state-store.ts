import { randomBytes } from "node:crypto";

/**
 * Single-use, short-lived CSRF state store for the Scout Connect redirect flow.
 *
 * Issued by `POST /api/integrations/scout/state` and consumed by the callback
 * handler. In-memory by design — the API server runs as a single instance and
 * a state token is only valid for ~10 minutes between the user clicking
 * "Connect Scout" and Scout redirecting back. Surviving a server restart is
 * not worth the added storage complexity here.
 */
const STATE_TTL_MS = 10 * 60 * 1000;
const REPLAY_KEEP_MS = 60 * 1000;

type Entry = { createdAt: number; usedAt: number | null };

const store = new Map<string, Entry>();

function cleanup(now: number) {
  for (const [k, v] of store) {
    const expired = now - v.createdAt > STATE_TTL_MS;
    const usedTooLongAgo =
      v.usedAt != null && now - v.usedAt > REPLAY_KEEP_MS;
    if (expired || usedTooLongAgo) store.delete(k);
  }
}

export function issueScoutState(): string {
  const now = Date.now();
  cleanup(now);
  const state = randomBytes(32).toString("hex");
  store.set(state, { createdAt: now, usedAt: null });
  return state;
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "replayed" };

export function consumeScoutState(state: string): ConsumeResult {
  const now = Date.now();
  // Intentionally do NOT cleanup() here: we want to differentiate
  // "expired" from "missing" for the recruiter, and cleanup would
  // silently turn an expired entry into a missing one.
  const entry = store.get(state);
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.usedAt != null) return { ok: false, reason: "replayed" };
  if (now - entry.createdAt > STATE_TTL_MS) {
    store.delete(state);
    return { ok: false, reason: "expired" };
  }
  entry.usedAt = now;
  return { ok: true };
}

/** Test-only: wipe the in-memory store between cases. */
export function _resetScoutStateStore(): void {
  store.clear();
}

/** Test-only: forcibly age an existing state so expiry paths can be exercised. */
export function _ageScoutState(state: string, ageMs: number): boolean {
  const e = store.get(state);
  if (!e) return false;
  e.createdAt = Date.now() - ageMs;
  return true;
}
