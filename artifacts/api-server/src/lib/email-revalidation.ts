import { and, isNotNull, lt, or, isNull, sql } from "drizzle-orm";
import { db, candidatesTable } from "@workspace/db";
import { validateEmail } from "./email-validation";
import { logger } from "./logger";

/**
 * Number of days after which a previously validated email is considered stale
 * and eligible for an automatic re-check. Domains lose MX records, employees
 * leave companies, and addresses go dead — so a candidate marked "Verified"
 * months ago may no longer be reliable.
 */
export const EMAIL_REVALIDATION_DAYS = Number(
  process.env["EMAIL_REVALIDATION_DAYS"] ?? "30",
);

/** How often the background sweeper wakes up to look for stale rows. */
export const EMAIL_REVALIDATION_INTERVAL_MS = Number(
  process.env["EMAIL_REVALIDATION_INTERVAL_MS"] ?? String(6 * 60 * 60 * 1000),
);

/** Cap how many candidates a single sweep will re-check, to avoid bursts. */
export const EMAIL_REVALIDATION_BATCH_SIZE = Number(
  process.env["EMAIL_REVALIDATION_BATCH_SIZE"] ?? "50",
);

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
  const cutoff = new Date(Date.now() - EMAIL_REVALIDATION_DAYS * 24 * 60 * 60 * 1000);

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
    .limit(EMAIL_REVALIDATION_BATCH_SIZE);

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

/**
 * Start a long-running interval that periodically re-validates stale email
 * addresses. Safe to call once at server boot. The first sweep runs after the
 * configured interval so we don't pile DNS work onto cold start. Disable by
 * setting `EMAIL_REVALIDATION_INTERVAL_MS=0`.
 */
export function startEmailRevalidationScheduler() {
  if (timer) return;
  if (!Number.isFinite(EMAIL_REVALIDATION_INTERVAL_MS) || EMAIL_REVALIDATION_INTERVAL_MS <= 0) {
    logger.info("Email re-validation scheduler disabled (interval <= 0)");
    return;
  }
  logger.info(
    {
      intervalMs: EMAIL_REVALIDATION_INTERVAL_MS,
      thresholdDays: EMAIL_REVALIDATION_DAYS,
      batchSize: EMAIL_REVALIDATION_BATCH_SIZE,
    },
    "Email re-validation scheduler started",
  );
  timer = setInterval(() => {
    sweepStaleEmailValidations()
      .then((n) => {
        if (n > 0) logger.info({ rechecked: n }, "Stale email validations refreshed");
      })
      .catch((err) => {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, "Email re-validation sweep crashed");
      });
  }, EMAIL_REVALIDATION_INTERVAL_MS);
  // Don't keep the event loop alive on shutdown.
  if (typeof timer.unref === "function") timer.unref();
}
