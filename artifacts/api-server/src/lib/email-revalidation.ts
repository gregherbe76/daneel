import { and, isNotNull, lt, or, isNull, sql, eq } from "drizzle-orm";
import {
  db,
  candidatesTable,
  emailRevalidationSettingsTable,
  type EmailRevalidationSettings,
} from "@workspace/db";
import { validateEmail } from "./email-validation";
import { logger } from "./logger";

/**
 * Default values for the singleton settings row, seeded from env vars on first
 * boot. After that, the live values come from the database so admins can tune
 * them from the UI without a redeploy.
 */
const DEFAULT_THRESHOLD_DAYS = Number(
  process.env["EMAIL_REVALIDATION_DAYS"] ?? "30",
);
const DEFAULT_INTERVAL_MS = Number(
  process.env["EMAIL_REVALIDATION_INTERVAL_MS"] ?? String(6 * 60 * 60 * 1000),
);
const DEFAULT_BATCH_SIZE = Number(
  process.env["EMAIL_REVALIDATION_BATCH_SIZE"] ?? "50",
);
/** Floor so a misconfigured 0/negative interval doesn't busy-loop the sweeper. */
const MIN_INTERVAL_MS = 60_000;

const SINGLETON_ID = 1;

/**
 * Read the current settings, inserting the env-var defaults on first call so
 * later updates always have a row to UPDATE.
 */
export async function getEmailRevalidationSettings(): Promise<EmailRevalidationSettings> {
  const [row] = await db
    .select()
    .from(emailRevalidationSettingsTable)
    .where(eq(emailRevalidationSettingsTable.id, SINGLETON_ID));
  if (row) return row;

  const seedThresholdDays =
    Number.isFinite(DEFAULT_THRESHOLD_DAYS) && DEFAULT_THRESHOLD_DAYS > 0
      ? DEFAULT_THRESHOLD_DAYS
      : 30;
  const seedIntervalMs =
    Number.isFinite(DEFAULT_INTERVAL_MS) && DEFAULT_INTERVAL_MS >= 0
      ? DEFAULT_INTERVAL_MS
      : 6 * 60 * 60 * 1000;
  const seedBatchSize =
    Number.isFinite(DEFAULT_BATCH_SIZE) && DEFAULT_BATCH_SIZE > 0
      ? DEFAULT_BATCH_SIZE
      : 50;
  const [seeded] = await db
    .insert(emailRevalidationSettingsTable)
    .values({
      id: SINGLETON_ID,
      thresholdDays: seedThresholdDays,
      intervalMs: seedIntervalMs,
      batchSize: seedBatchSize,
      // Use the sanitized interval so a malformed env var doesn't seed
      // `enabled=false` unintentionally.
      enabled: seedIntervalMs > 0,
    })
    .onConflictDoNothing()
    .returning();

  if (seeded) return seeded;

  // Lost a race with another instance — re-read.
  const [existing] = await db
    .select()
    .from(emailRevalidationSettingsTable)
    .where(eq(emailRevalidationSettingsTable.id, SINGLETON_ID));
  if (!existing) {
    throw new Error("Failed to load or seed email revalidation settings");
  }
  return existing;
}

export async function updateEmailRevalidationSettings(input: {
  thresholdDays: number;
  intervalMs: number;
  batchSize: number;
  enabled: boolean;
}): Promise<EmailRevalidationSettings> {
  // Make sure the row exists.
  await getEmailRevalidationSettings();
  const [updated] = await db
    .update(emailRevalidationSettingsTable)
    .set({
      thresholdDays: input.thresholdDays,
      intervalMs: input.intervalMs,
      batchSize: input.batchSize,
      enabled: input.enabled,
      updatedAt: new Date(),
    })
    .where(eq(emailRevalidationSettingsTable.id, SINGLETON_ID))
    .returning();
  return updated;
}

/**
 * Re-run the MX-record validator for a single candidate and persist the
 * refreshed status. Returns the updated candidate row, or `null` if the
 * candidate has no email on file (in which case nothing to do).
 */
export async function revalidateCandidateEmail(candidateId: number) {
  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(sql`${candidatesTable.id} = ${candidateId}`);

  if (!candidate) return null;
  if (!candidate.email) return candidate;

  const result = await validateEmail(candidate.email);
  const [updated] = await db
    .update(candidatesTable)
    .set({
      emailValidationStatus: result.status,
      emailValidationReason: result.reason,
      emailValidatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`${candidatesTable.id} = ${candidateId}`)
    .returning();

  return updated ?? candidate;
}

/**
 * Find candidates whose `emailValidatedAt` is older than the configured
 * staleness threshold and re-run validation on each. Returns the number of
 * candidates that were re-checked in this sweep.
 */
export async function sweepStaleEmailValidations(): Promise<number> {
  const settings = await getEmailRevalidationSettings();
  const cutoff = new Date(
    Date.now() - settings.thresholdDays * 24 * 60 * 60 * 1000,
  );

  const stale = await db
    .select({ id: candidatesTable.id })
    .from(candidatesTable)
    .where(
      and(
        isNotNull(candidatesTable.email),
        or(
          isNull(candidatesTable.emailValidatedAt),
          lt(candidatesTable.emailValidatedAt, cutoff),
        ),
      ),
    )
    .limit(settings.batchSize);

  if (stale.length === 0) return 0;

  let rechecked = 0;
  for (const row of stale) {
    try {
      await revalidateCandidateEmail(row.id);
      rechecked += 1;
    } catch (err) {
      logger.warn(
        { candidateId: row.id, err: err instanceof Error ? err.message : String(err) },
        "Stale email re-validation failed for candidate",
      );
    }
  }
  return rechecked;
}

let timer: NodeJS.Timeout | undefined;
let stopped = false;

/**
 * Start a long-running loop that periodically re-validates stale email
 * addresses. Safe to call once at server boot. Re-reads the settings row
 * before scheduling each iteration so admin changes (interval, enabled flag)
 * take effect on the very next tick — no redeploy required.
 */
export function startEmailRevalidationScheduler() {
  if (timer || stopped) return;

  const scheduleNext = async () => {
    let intervalMs: number;
    let enabled: boolean;
    try {
      const settings = await getEmailRevalidationSettings();
      intervalMs = settings.intervalMs;
      enabled = settings.enabled;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "Email re-validation: failed to load settings, retrying in 5m",
      );
      intervalMs = 5 * 60 * 1000;
      enabled = true;
    }

    // When disabled (or interval is non-positive), poll the settings row at a
    // slow cadence so re-enabling from the UI takes effect within ~1 minute.
    const delay = !enabled || intervalMs <= 0
      ? MIN_INTERVAL_MS
      : Math.max(intervalMs, MIN_INTERVAL_MS);

    timer = setTimeout(() => {
      timer = undefined;
      void runSweepThenReschedule(enabled && intervalMs > 0);
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
  };

  const runSweepThenReschedule = async (shouldSweep: boolean) => {
    if (shouldSweep) {
      try {
        const n = await sweepStaleEmailValidations();
        if (n > 0) logger.info({ rechecked: n }, "Stale email validations refreshed");
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "Email re-validation sweep crashed",
        );
      }
    }
    if (!stopped) await scheduleNext();
  };

  logger.info("Email re-validation scheduler started");
  void scheduleNext();
}

/** Stop the scheduler (test helper / graceful shutdown). */
export function stopEmailRevalidationScheduler() {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
}
