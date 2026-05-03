/**
 * Backfill emailValidationStatus / emailValidationReason / emailValidatedAt
 * for candidates that already exist in the database.
 *
 * Why: email validation was added to the sourcing pipeline only — every
 * candidate inserted before that change has `emailValidationStatus = null`,
 * so the recruiting UI shows no badge for them. This script runs the same
 * `validateEmail` against every existing candidate with a non-null email so
 * the badge surfaces for the entire historical talent pool.
 *
 * Properties:
 *   - Idempotent by default: only processes rows where emailValidationStatus
 *     is null. Pass --force to re-validate every row (e.g. after expanding
 *     the disposable-domain list).
 *   - Rate-limited: uses batchProcess with low concurrency so we don't fire
 *     hundreds of parallel DNS lookups at the resolver. The validator's
 *     internal mxCache also dedups repeat domains within a single run.
 *   - --dry previews without writing.
 *   - --limit N processes only the first N matching candidates.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run backfill-email-validation
 *   pnpm --filter @workspace/scripts run backfill-email-validation -- --dry
 *   pnpm --filter @workspace/scripts run backfill-email-validation -- --force
 *   pnpm --filter @workspace/scripts run backfill-email-validation -- --limit 100
 */

import { db, pool, candidatesTable } from "@workspace/db";
import { validateEmail } from "@workspace/email-validation";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const force = args.includes("--force");

// Parse a positive-integer CLI flag value, returning `fallback` when the
// flag is absent and exiting hard on malformed input so we don't silently
// run with NaN concurrency or an unbounded "limit".
function parsePositiveIntFlag(flag: string, fallback: number | null, max?: number): number | null {
  const idx = args.indexOf(flag);
  if (idx < 0) return fallback;
  const raw = args[idx + 1];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || (max !== undefined && n > max)) {
    console.error(
      `[backfill-email-validation] invalid value for ${flag}: ${JSON.stringify(raw)} — expected positive integer${max ? ` ≤ ${max}` : ""}`,
    );
    process.exit(2);
  }
  return n;
}

const limit = parsePositiveIntFlag("--limit", null);
// Cap concurrency at 50 — anything higher is almost certainly a typo and
// would just hammer the local DNS resolver without speeding things up.
const concurrency = parsePositiveIntFlag("--concurrency", 5, 50) ?? 5;

async function main() {
  console.log(
    `[backfill-email-validation] starting — ${force ? "FORCE re-validating all rows" : "only rows with null emailValidationStatus"}` +
      (dryRun ? " (DRY RUN)" : "") +
      ` — concurrency=${concurrency}` +
      (limit ? ` limit=${limit}` : ""),
  );

  // We want candidates whose email is set and non-empty. Drizzle's `ne`
  // against an empty string covers the "" case; isNotNull covers SQL NULL.
  const whereClauses = [isNotNull(candidatesTable.email), ne(candidatesTable.email, "")];
  if (!force) whereClauses.push(isNull(candidatesTable.emailValidationStatus));

  const baseQuery = db
    .select({
      id: candidatesTable.id,
      email: candidatesTable.email,
      name: candidatesTable.name,
      emailValidationStatus: candidatesTable.emailValidationStatus,
    })
    .from(candidatesTable)
    .where(and(...whereClauses))
    .orderBy(candidatesTable.id);

  const rows = limit && limit > 0 ? await baseQuery.limit(limit) : await baseQuery;

  if (rows.length === 0) {
    console.log("[backfill-email-validation] nothing to do — no candidates match");
    await pool.end();
    return;
  }

  console.log(`[backfill-email-validation] processing ${rows.length} candidates`);

  const counts: Record<string, number> = { valid: 0, invalid: 0, risky: 0, unchecked: 0 };
  let updated = 0;
  let failed = 0;

  await batchProcess(
    rows,
    async (row, index) => {
      try {
        const result = await validateEmail(row.email);
        counts[result.status] = (counts[result.status] ?? 0) + 1;

        if (dryRun) {
          if (index < 20 || index % 100 === 0) {
            console.log(
              `[backfill-email-validation] DRY #${row.id} ${row.email} → ${result.status} (${result.reason})`,
            );
          }
          return;
        }

        await db
          .update(candidatesTable)
          .set({
            emailValidationStatus: result.status,
            emailValidationReason: result.reason,
            emailValidatedAt: new Date(),
          })
          .where(eq(candidatesTable.id, row.id));
        updated++;
      } catch (err) {
        failed++;
        console.error(
          `[backfill-email-validation] candidate ${row.id} (${row.email}) failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    },
    { concurrency, retries: 1 },
  );

  console.log(
    `[backfill-email-validation] done — processed=${rows.length} updated=${updated} failed=${failed}` +
      ` — counts: valid=${counts.valid} invalid=${counts.invalid} risky=${counts.risky} unchecked=${counts.unchecked}` +
      (dryRun ? " (DRY RUN — no writes performed)" : ""),
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error("[backfill-email-validation] fatal:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
