import { randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, scoutConnectStatesTable } from "@workspace/db";

/**
 * Single-use, short-lived CSRF state store for the Scout Connect redirect flow.
 *
 * Issued by `POST /api/integrations/scout/state` and consumed by the callback
 * handler. Backed by Postgres (`scout_connect_states`) so a state token issued
 * before an API server restart in the ~10 minute window between the user
 * clicking "Connect Scout" and Scout redirecting back is still valid after
 * the restart — and so the same flow keeps working if we ever run multiple
 * API instances behind a load balancer.
 */
const STATE_TTL_MS = 10 * 60 * 1000;
const REPLAY_KEEP_MS = 60 * 1000;

async function cleanup(now: number): Promise<void> {
  const expiredCutoff = new Date(now - STATE_TTL_MS);
  const usedCutoff = new Date(now - REPLAY_KEEP_MS);
  await db
    .delete(scoutConnectStatesTable)
    .where(
      or(
        lt(scoutConnectStatesTable.createdAt, expiredCutoff),
        and(
          isNotNull(scoutConnectStatesTable.usedAt),
          lt(scoutConnectStatesTable.usedAt, usedCutoff),
        ),
      ),
    );
}

export async function issueScoutState(): Promise<string> {
  const now = Date.now();
  await cleanup(now);
  const state = randomBytes(32).toString("hex");
  await db.insert(scoutConnectStatesTable).values({ state });
  return state;
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "replayed" };

export async function consumeScoutState(state: string): Promise<ConsumeResult> {
  const now = Date.now();
  // Intentionally do NOT cleanup() here: we want to differentiate
  // "expired" from "missing" for the recruiter, and cleanup would
  // silently turn an expired entry into a missing one.
  const [entry] = await db
    .select()
    .from(scoutConnectStatesTable)
    .where(eq(scoutConnectStatesTable.state, state))
    .limit(1);
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.usedAt != null) return { ok: false, reason: "replayed" };
  if (now - entry.createdAt.getTime() > STATE_TTL_MS) {
    await db
      .delete(scoutConnectStatesTable)
      .where(eq(scoutConnectStatesTable.state, state));
    return { ok: false, reason: "expired" };
  }
  // Atomic mark-used: only flips the row if usedAt is still NULL, so two
  // concurrent callbacks for the same state can't both succeed.
  const updated = await db
    .update(scoutConnectStatesTable)
    .set({ usedAt: new Date(now) })
    .where(
      and(
        eq(scoutConnectStatesTable.state, state),
        isNull(scoutConnectStatesTable.usedAt),
      ),
    )
    .returning({ state: scoutConnectStatesTable.state });
  if (updated.length === 0) return { ok: false, reason: "replayed" };
  return { ok: true };
}

/** Test-only: wipe the store between cases. */
export async function _resetScoutStateStore(): Promise<void> {
  await db.delete(scoutConnectStatesTable);
}

/** Test-only: forcibly age an existing state so expiry paths can be exercised. */
export async function _ageScoutState(
  state: string,
  ageMs: number,
): Promise<boolean> {
  const newCreatedAt = new Date(Date.now() - ageMs);
  const updated = await db
    .update(scoutConnectStatesTable)
    .set({ createdAt: newCreatedAt })
    .where(eq(scoutConnectStatesTable.state, state))
    .returning({ state: scoutConnectStatesTable.state });
  return updated.length > 0;
}
