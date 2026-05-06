import { and, isNotNull, lt, or, isNull, sql, eq, desc, gt } from "drizzle-orm";
import {
  db,
  candidatesTable,
  emailStatusChangesTable,
  emailRevalidationSettingsTable,
  emailRevalidationRunsTable,
  type EmailRevalidationSettings,
  type EmailRevalidationRun,
} from "@workspace/db";
import { branding } from "@workspace/branding";
import { validateEmail } from "./email-validation";
import { logger } from "./logger";
import { notifyRegression } from "./notifications";
import { sendAlertEmail, detectAlertTransport } from "./alert-email";

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
/**
 * How many days of sweep history we keep in `email_revalidation_runs` by
 * default. With a 6h cadence that's ~120 rows; with an aggressive 1h cadence
 * still well under 1k. Tunable from the settings UI per-deployment.
 */
const DEFAULT_RETENTION_DAYS = Number(
  process.env["EMAIL_REVALIDATION_RETENTION_DAYS"] ?? "30",
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
  const seedRetentionDays =
    Number.isFinite(DEFAULT_RETENTION_DAYS) && DEFAULT_RETENTION_DAYS > 0
      ? DEFAULT_RETENTION_DAYS
      : 30;
  const [seeded] = await db
    .insert(emailRevalidationSettingsTable)
    .values({
      id: SINGLETON_ID,
      thresholdDays: seedThresholdDays,
      intervalMs: seedIntervalMs,
      batchSize: seedBatchSize,
      retentionDays: seedRetentionDays,
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
  retentionDays: number;
  enabled: boolean;
  alertThreshold: number;
  alertEmail: string | null;
}): Promise<EmailRevalidationSettings> {
  // Make sure the row exists.
  await getEmailRevalidationSettings();
  const [updated] = await db
    .update(emailRevalidationSettingsTable)
    .set({
      thresholdDays: input.thresholdDays,
      intervalMs: input.intervalMs,
      batchSize: input.batchSize,
      retentionDays: input.retentionDays,
      enabled: input.enabled,
      alertThreshold: input.alertThreshold,
      alertEmail: input.alertEmail,
      updatedAt: new Date(),
    })
    .where(eq(emailRevalidationSettingsTable.id, SINGLETON_ID))
    .returning();
  return updated;
}

/**
 * A sweep counts as "failed" for alerting purposes when it crashed before
 * completing or recorded any per-candidate errors. We alert on either signal
 * because a steady drip of per-candidate errors is just as worrying as an
 * outright crash — both mean candidate emails are silently going stale.
 */
function isFailedRun(run: EmailRevalidationRun): boolean {
  return !!run.errorMessage || run.errors > 0;
}

export interface EmailRevalidationAlertStatus {
  active: boolean;
  threshold: number;
  consecutiveFailures: number;
  alertEmail: string | null;
  lastAlertedAt: Date | null;
}

/**
 * Compute whether the consecutive-failure alert should be firing right now,
 * based on the configured threshold and the most recent N (= threshold) runs.
 * When `threshold` is 0 alerting is treated as disabled.
 */
export async function getEmailRevalidationAlertStatus(): Promise<EmailRevalidationAlertStatus> {
  const settings = await getEmailRevalidationSettings();
  const threshold = settings.alertThreshold;

  if (threshold <= 0) {
    return {
      active: false,
      threshold: 0,
      consecutiveFailures: 0,
      alertEmail: settings.alertEmail,
      lastAlertedAt: null,
    };
  }

  // Only consider completed runs (finishedAt set) so an in-flight sweep
  // doesn't masquerade as a fresh failure. Pull a generous window so we can
  // accurately count an ongoing failure streak that's longer than threshold.
  const recent = await db
    .select()
    .from(emailRevalidationRunsTable)
    .where(isNotNull(emailRevalidationRunsTable.finishedAt))
    .orderBy(desc(emailRevalidationRunsTable.startedAt))
    .limit(Math.max(threshold * 5, 20));

  let consecutiveFailures = 0;
  let lastAlerted: Date | null = null;
  for (const run of recent) {
    if (!isFailedRun(run)) break;
    consecutiveFailures += 1;
    if (run.alertedAt && (!lastAlerted || run.alertedAt > lastAlerted)) {
      lastAlerted = run.alertedAt;
    }
  }

  return {
    active: consecutiveFailures >= threshold,
    threshold,
    consecutiveFailures,
    alertEmail: settings.alertEmail,
    lastAlertedAt: lastAlerted,
  };
}

/**
 * Fire the admin alert if the latest run completed a streak of failures that
 * meets the configured threshold AND we haven't already alerted on that
 * streak. Dedupe is anchored on the most recent successful run rather than
 * "within the last N runs" — otherwise a long uninterrupted outage would
 * re-fire repeatedly as the originally-stamped run scrolled out of the window.
 * One alert per failure streak; the next alert can only fire after at least
 * one healthy sweep breaks the streak.
 */
async function maybeFireAlert(latestRun: EmailRevalidationRun): Promise<void> {
  const settings = await getEmailRevalidationSettings();
  const threshold = settings.alertThreshold;
  if (threshold <= 0) return;
  if (!isFailedRun(latestRun)) return;

  // Walk back through completed runs newest-first to find the current
  // failure streak (everything since the most recent successful run). We do
  // NOT cap the scan at `threshold` because we need to detect an `alertedAt`
  // anywhere in the streak — capping would let a long incident re-fire as
  // the originally-stamped run scrolled out of the window.
  const streak: EmailRevalidationRun[] = [];
  let cursor: Date | null = null;
  let alreadyAlerted = false;
  while (true) {
    const conditions = [isNotNull(emailRevalidationRunsTable.finishedAt)];
    if (cursor) conditions.push(lt(emailRevalidationRunsTable.startedAt, cursor));
    const [next] = await db
      .select()
      .from(emailRevalidationRunsTable)
      .where(and(...conditions))
      .orderBy(desc(emailRevalidationRunsTable.startedAt))
      .limit(1);
    if (!next) break;
    if (!isFailedRun(next)) break;
    streak.push(next);
    if (next.alertedAt !== null) {
      alreadyAlerted = true;
      break;
    }
    cursor = next.startedAt;
  }

  // Same uninterrupted incident — already notified, don't re-fire.
  if (alreadyAlerted) return;
  if (streak.length < threshold) return;

  const stampedAt = new Date();
  await db
    .update(emailRevalidationRunsTable)
    .set({ alertedAt: stampedAt })
    .where(eq(emailRevalidationRunsTable.id, latestRun.id));

  logger.error(
    {
      threshold,
      alertEmail: settings.alertEmail,
      latestRunId: latestRun.id,
      latestErrorMessage: latestRun.errorMessage,
      latestErrors: latestRun.errors,
      streakRunIds: streak.map((r) => r.id),
    },
    "Email re-validation sweep alert: consecutive failures threshold reached",
  );

  if (settings.alertEmail) {
    const subject = `[${branding.productName}] Email re-validation sweep failing (${streak.length} consecutive failures)`;
    const bodyLines = [
      `The email re-validation sweep has failed ${streak.length} time(s) in a row, meeting the configured alert threshold of ${threshold}.`,
      "",
      `Latest run #${latestRun.id}:`,
      `  errors: ${latestRun.errors}`,
      latestRun.errorMessage
        ? `  errorMessage: ${latestRun.errorMessage}`
        : "  errorMessage: (none — failure inferred from per-candidate errors)",
      "",
      `Failure streak run ids (newest first): ${streak.map((r) => r.id).join(", ")}`,
      "",
      "Investigate the API server logs for stack traces. This alert will not re-fire until at least one sweep succeeds.",
    ];
    try {
      const transport = await sendAlertEmail({
        to: settings.alertEmail,
        subject,
        text: bodyLines.join("\n"),
      });
      if (transport === "none") {
        logger.warn(
          { alertEmail: settings.alertEmail, latestRunId: latestRun.id },
          "Email re-validation alert NOT delivered — configure SENDGRID_API_KEY or SMTP_HOST",
        );
      } else {
        logger.info(
          {
            alertEmail: settings.alertEmail,
            latestRunId: latestRun.id,
            transport,
          },
          "Email re-validation alert email sent",
        );
      }
    } catch (err) {
      // Per task spec: failure to send must be logged but must not break the
      // sweep itself. The streak is already stamped with `alertedAt` above so
      // we do NOT retry on the next sweep — that would spam an admin during
      // an outage. The streak resets naturally once a sweep succeeds.
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          alertEmail: settings.alertEmail,
          latestRunId: latestRun.id,
          transport: detectAlertTransport(),
        },
        "Email re-validation alert email delivery failed",
      );
    }
  }
}

/**
 * Window during which we collapse repeated regressions for the same candidate
 * into a single inbox row. If the candidate's email flaps multiple times in
 * one day, the recruiter only sees one unread item.
 */
const REGRESSION_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A regression is a downgrade in the recruiter's confidence that an email is
 * deliverable. We notify on these transitions only — upgrades and first checks
 * (`unchecked → anything`) don't matter for outreach trust.
 *
 * Note: the validator emits "invalid" for undeliverable; the UI labels it
 * "Undeliverable". Status values stored here mirror the validator (`valid`,
 * `invalid`, `risky`, `unchecked`).
 */
function isRegression(previous: string | null, next: string): boolean {
  if (!previous) return false;
  if (previous === next) return false;
  if (previous === "valid" && (next === "invalid" || next === "risky" || next === "unchecked")) {
    return true;
  }
  if (previous === "risky" && next === "invalid") return true;
  return false;
}

/**
 * Re-run the MX-record validator for a single candidate and persist the
 * refreshed status. Returns the updated candidate row, or `null` if the
 * candidate has no email on file (in which case nothing to do).
 *
 * If the new status is a regression compared to the prior status (e.g. a
 * previously verified address is now undeliverable), this also records an
 * `email_status_changes` row so recruiters get a heads-up in their inbox.
 */
export async function revalidateCandidateEmail(candidateId: number) {
  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(sql`${candidatesTable.id} = ${candidateId}`);

  if (!candidate) return null;
  if (!candidate.email) return candidate;

  const result = await validateEmail(candidate.email);
  const previousStatus = candidate.emailValidationStatus;
  const previousReason = candidate.emailValidationReason;

  const { updated, insertedChange } = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(candidatesTable)
      .set({
        emailValidationStatus: result.status,
        emailValidationReason: result.reason,
        emailValidatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(sql`${candidatesTable.id} = ${candidateId}`)
      .returning();

    let insertedChange: typeof emailStatusChangesTable.$inferSelect | null = null;

    if (isRegression(previousStatus, result.status)) {
      // Collapse repeated regressions in the same 24h window — if the candidate
      // flaps valid → invalid → valid → invalid in one day we only want one
      // unread inbox row, refreshed in place.
      const dedupeCutoff = new Date(Date.now() - REGRESSION_DEDUPE_WINDOW_MS);
      const [recent] = await tx
        .select()
        .from(emailStatusChangesTable)
        .where(
          and(
            eq(emailStatusChangesTable.candidateId, candidateId),
            isNull(emailStatusChangesTable.notifiedAt),
            gt(emailStatusChangesTable.changedAt, dedupeCutoff),
          ),
        )
        .orderBy(desc(emailStatusChangesTable.changedAt))
        .limit(1);

      if (recent) {
        await tx
          .update(emailStatusChangesTable)
          .set({
            newStatus: result.status,
            newReason: result.reason,
            changedAt: new Date(),
          })
          .where(eq(emailStatusChangesTable.id, recent.id));
        // Intentionally no notification dispatch — the prior insert in the
        // same 24h window already triggered one (or chose not to). This keeps
        // notifications on the same dedupe window as the inbox.
      } else {
        const [created] = await tx
          .insert(emailStatusChangesTable)
          .values({
            candidateId,
            previousStatus: previousStatus ?? "unchecked",
            newStatus: result.status,
            previousReason: previousReason ?? null,
            newReason: result.reason,
          })
          .returning();
        insertedChange = created ?? null;
      }
    }

    return { updated: updatedRow ?? candidate, insertedChange };
  });

  if (insertedChange) {
    // Fire-and-await outside the transaction so a flaky outbound webhook
    // never holds row locks or rolls back the candidate update.
    try {
      await notifyRegression(insertedChange, {
        name: candidate.name,
        email: candidate.email,
      });
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          candidateId,
        },
        "notifyRegression dispatcher threw",
      );
    }
  }

  return updated;
}

/**
 * Delete sweep history rows older than `retentionDays`. Called at the end of
 * each sweep so the `email_revalidation_runs` table — which would otherwise
 * grow forever on long-lived deployments with aggressive sweep intervals —
 * stays bounded and the "Recent activity" query stays cheap.
 *
 * Only rows that have already finished are pruned so we never delete a row
 * that's still being written to. Returns the number of rows deleted.
 */
export async function pruneOldEmailRevalidationRuns(
  retentionDays: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(emailRevalidationRunsTable)
    .where(
      and(
        isNotNull(emailRevalidationRunsTable.finishedAt),
        lt(emailRevalidationRunsTable.startedAt, cutoff),
      ),
    )
    .returning({ id: emailRevalidationRunsTable.id });
  return deleted.length;
}

/**
 * Find candidates whose `emailValidatedAt` is older than the configured
 * staleness threshold and re-run validation on each. Records a row in
 * `email_revalidation_runs` so admins can see scheduler activity in the UI.
 * Returns the persisted run row.
 */
export async function sweepStaleEmailValidations(
  trigger: "scheduled" | "manual" = "scheduled",
): Promise<EmailRevalidationRun> {
  const [runRow] = await db
    .insert(emailRevalidationRunsTable)
    .values({ trigger })
    .returning();

  let rechecked = 0;
  let errors = 0;
  let errorMessage: string | null = null;

  try {
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
          // Skip rows in the soft-delete trash bin — re-validating an email
          // we're about to hard-delete is wasted work, and would also dirty
          // the recruiter's "Undo" view if the row got restored.
          isNull(candidatesTable.deletedAt),
          or(
            isNull(candidatesTable.emailValidatedAt),
            lt(candidatesTable.emailValidatedAt, cutoff),
          ),
        ),
      )
      .limit(settings.batchSize);

    for (const row of stale) {
      try {
        await revalidateCandidateEmail(row.id);
        rechecked += 1;
      } catch (err) {
        errors += 1;
        logger.warn(
          { candidateId: row.id, err: err instanceof Error ? err.message : String(err) },
          "Stale email re-validation failed for candidate",
        );
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err: errorMessage }, "Email re-validation sweep crashed");
  }

  const [finished] = await db
    .update(emailRevalidationRunsTable)
    .set({
      finishedAt: new Date(),
      rechecked,
      errors,
      errorMessage,
    })
    .where(eq(emailRevalidationRunsTable.id, runRow.id))
    .returning();

  const finalRun = finished ?? runRow;

  // Prune old history rows so the table doesn't grow forever. Best-effort:
  // a failure here must not fail the sweep, since the sweep itself already
  // succeeded and the cleanup will get another chance on the next tick.
  try {
    const settings = await getEmailRevalidationSettings();
    const pruned = await pruneOldEmailRevalidationRuns(settings.retentionDays);
    if (pruned > 0) {
      logger.info(
        { pruned, retentionDays: settings.retentionDays },
        "Pruned old email re-validation sweep history",
      );
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Email re-validation history cleanup failed",
    );
  }

  // Best-effort alert dispatch; never let a notification failure mask the
  // sweep result itself.
  try {
    await maybeFireAlert(finalRun);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to evaluate email re-validation alert",
    );
  }

  return finalRun;
}

/**
 * Return the most recent sweep rows, newest first. Used by the settings UI to
 * render a small "Recent activity" panel.
 */
export async function listRecentEmailRevalidationRuns(
  limit = 10,
): Promise<EmailRevalidationRun[]> {
  return db
    .select()
    .from(emailRevalidationRunsTable)
    .orderBy(desc(emailRevalidationRunsTable.startedAt))
    .limit(limit);
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
        const run = await sweepStaleEmailValidations("scheduled");
        if (run.rechecked > 0) {
          logger.info(
            { rechecked: run.rechecked, errors: run.errors },
            "Stale email validations refreshed",
          );
        }
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
