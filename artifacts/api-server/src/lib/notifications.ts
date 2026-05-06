import { eq, gt, inArray } from "drizzle-orm";
import {
  db,
  notificationSettingsTable,
  emailStatusChangesTable,
  candidatesTable,
  type NotificationSettings,
  type EmailStatusChange,
  type RecipientMode,
  type RecipientModes,
} from "@workspace/db";
import { logger } from "./logger";

const SINGLETON_ID = 1;

export interface NotificationRecipient {
  email: string;
  mode: RecipientMode;
}

export interface NotificationSettingsResponse {
  emailEnabled: boolean;
  emailRecipients: NotificationRecipient[];
  slackEnabled: boolean;
  slackWebhookUrl: string | null;
  emailDeliveryConfigured: boolean;
  digestCadenceHours: number;
  digestLastSentAt: Date | null;
  updatedAt: Date;
}

function parseRecipientStrings(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function recipientsWithModes(
  rawList: string,
  modes: RecipientModes,
): NotificationRecipient[] {
  return parseRecipientStrings(rawList).map((email) => ({
    email,
    mode: modes[email] === "digest" ? "digest" : "instant",
  }));
}

function emailDeliveryConfigured(): boolean {
  return Boolean(process.env["SENDGRID_API_KEY"]);
}

function toResponse(row: NotificationSettings): NotificationSettingsResponse {
  return {
    emailEnabled: row.emailEnabled,
    emailRecipients: recipientsWithModes(
      row.emailRecipients,
      row.recipientModes ?? {},
    ),
    slackEnabled: row.slackEnabled,
    slackWebhookUrl: row.slackWebhookUrl,
    emailDeliveryConfigured: emailDeliveryConfigured(),
    digestCadenceHours: row.digestCadenceHours,
    digestLastSentAt: row.digestLastSentAt,
    updatedAt: row.updatedAt,
  };
}

export async function getNotificationSettings(): Promise<NotificationSettingsResponse> {
  const [row] = await db
    .select()
    .from(notificationSettingsTable)
    .where(eq(notificationSettingsTable.id, SINGLETON_ID));
  if (row) return toResponse(row);

  const [seeded] = await db
    .insert(notificationSettingsTable)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing()
    .returning();
  if (seeded) return toResponse(seeded);

  const [existing] = await db
    .select()
    .from(notificationSettingsTable)
    .where(eq(notificationSettingsTable.id, SINGLETON_ID));
  if (!existing) throw new Error("Failed to load notification settings");
  return toResponse(existing);
}

export async function updateNotificationSettings(input: {
  emailEnabled: boolean;
  emailRecipients: NotificationRecipient[];
  slackEnabled: boolean;
  slackWebhookUrl?: string | null;
  digestCadenceHours?: number;
}): Promise<NotificationSettingsResponse> {
  await getNotificationSettings();
  const cleanedRecipients = input.emailRecipients
    .map((r) => ({ email: r.email.trim(), mode: r.mode }))
    .filter((r) => r.email.length > 0);
  const recipientList = cleanedRecipients.map((r) => r.email).join(",");
  const modes: RecipientModes = {};
  for (const r of cleanedRecipients) {
    if (r.mode === "digest") modes[r.email] = "digest";
  }
  const cadence =
    typeof input.digestCadenceHours === "number" && input.digestCadenceHours > 0
      ? Math.floor(input.digestCadenceHours)
      : undefined;

  const [updated] = await db
    .update(notificationSettingsTable)
    .set({
      emailEnabled: input.emailEnabled,
      emailRecipients: recipientList,
      recipientModes: modes,
      slackEnabled: input.slackEnabled,
      slackWebhookUrl: input.slackWebhookUrl ?? null,
      ...(cadence !== undefined ? { digestCadenceHours: cadence } : {}),
      updatedAt: new Date(),
    })
    .where(eq(notificationSettingsTable.id, SINGLETON_ID))
    .returning();
  return toResponse(updated);
}

interface RegressionPayload {
  candidateId: number;
  candidateName: string;
  candidateEmail: string | null;
  previousStatus: string;
  newStatus: string;
  newReason: string | null;
}

function buildSubject(p: RegressionPayload): string {
  return `Email validation regression: ${p.candidateName} (${p.previousStatus} → ${p.newStatus})`;
}

function buildBody(p: RegressionPayload): string {
  const lines = [
    `Candidate: ${p.candidateName} (#${p.candidateId})`,
    p.candidateEmail ? `Email: ${p.candidateEmail}` : "Email: (none)",
    `Status changed: ${p.previousStatus} → ${p.newStatus}`,
  ];
  if (p.newReason) lines.push(`Reason: ${p.newReason}`);
  return lines.join("\n");
}

async function sendSlackRaw(
  webhookUrl: string,
  subject: string,
  body: string,
): Promise<void> {
  const text = `*${subject}*\n${body}`;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${res.statusText}`);
  }
}

async function sendEmailRaw(
  recipients: string[],
  subject: string,
  body: string,
): Promise<void> {
  const apiKey = process.env["SENDGRID_API_KEY"];
  if (!apiKey) {
    throw new Error("SENDGRID_API_KEY is not configured");
  }
  const fromEmail = process.env["NOTIFICATION_FROM_EMAIL"] ?? "no-reply@hiring.local";
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: recipients.map((email) => ({ email })) }],
      from: { email: fromEmail },
      subject,
      content: [{ type: "text/plain", value: body }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`SendGrid request failed: ${res.status} ${errBody}`);
  }
}

async function sendSlack(
  webhookUrl: string,
  payload: RegressionPayload,
): Promise<void> {
  await sendSlackRaw(webhookUrl, buildSubject(payload), buildBody(payload));
}

async function sendInstantEmail(
  recipients: string[],
  payload: RegressionPayload,
): Promise<void> {
  await sendEmailRaw(recipients, buildSubject(payload), buildBody(payload));
}

/**
 * Dispatch outbound notifications for a freshly inserted regression row.
 *
 * Returns true if any channel was attempted successfully so the caller can
 * stamp `notificationSentAt` and avoid re-sending. The 24h dedupe window from
 * the inbox flow already gates this — we are only invoked on fresh inserts,
 * not when an existing recent row is updated in place.
 */
export async function notifyRegression(
  change: Pick<
    EmailStatusChange,
    "id" | "candidateId" | "previousStatus" | "newStatus" | "newReason"
  >,
  candidate: { name: string; email: string | null },
): Promise<void> {
  let settings: NotificationSettingsResponse;
  try {
    settings = await getNotificationSettings();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "notifyRegression: failed to load notification settings",
    );
    return;
  }
  await dispatchRegressionNotification(settings, change, candidate);
}

/**
 * Pure dispatch path: given a resolved settings snapshot, fire the configured
 * channels and stamp `notificationSentAt` on the change row when at least one
 * channel succeeded. Exposed separately so tests can exercise the dispatch
 * matrix without touching the settings table.
 *
 * Email is delivered only to recipients with `mode === "instant"` — digest
 * recipients are picked up later by `runDigestSweep`. Slack is unaffected by
 * the digest setting because it has no per-recipient fan-out concept.
 */
export async function dispatchRegressionNotification(
  settings: NotificationSettingsResponse,
  change: Pick<
    EmailStatusChange,
    "id" | "candidateId" | "previousStatus" | "newStatus" | "newReason"
  >,
  candidate: { name: string; email: string | null },
): Promise<void> {
  const payload: RegressionPayload = {
    candidateId: change.candidateId,
    candidateName: candidate.name,
    candidateEmail: candidate.email,
    previousStatus: change.previousStatus,
    newStatus: change.newStatus,
    newReason: change.newReason,
  };

  const tasks: Promise<{ channel: string; ok: boolean; err?: unknown }>[] = [];

  if (settings.slackEnabled && settings.slackWebhookUrl) {
    tasks.push(
      sendSlack(settings.slackWebhookUrl, payload)
        .then(() => ({ channel: "slack", ok: true as const }))
        .catch((err) => ({ channel: "slack", ok: false as const, err })),
    );
  }

  const instantRecipients = settings.emailRecipients
    .filter((r) => r.mode === "instant")
    .map((r) => r.email);

  if (
    settings.emailEnabled &&
    instantRecipients.length > 0 &&
    settings.emailDeliveryConfigured
  ) {
    tasks.push(
      sendInstantEmail(instantRecipients, payload)
        .then(() => ({ channel: "email", ok: true as const }))
        .catch((err) => ({ channel: "email", ok: false as const, err })),
    );
  }

  if (tasks.length === 0) return;

  const results = await Promise.all(tasks);
  let anySent = false;
  for (const r of results) {
    if (r.ok) {
      anySent = true;
      logger.info(
        { channel: r.channel, candidateId: change.candidateId },
        "Email regression notification sent",
      );
    } else {
      logger.warn(
        {
          channel: r.channel,
          candidateId: change.candidateId,
          err: r.err instanceof Error ? r.err.message : String(r.err),
        },
        "Email regression notification failed",
      );
    }
  }

  if (anySent) {
    try {
      await db
        .update(emailStatusChangesTable)
        .set({ notificationSentAt: new Date() })
        .where(eq(emailStatusChangesTable.id, change.id));
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), id: change.id },
        "Failed to stamp notification_sent_at",
      );
    }
  }
}

export type TestNotificationChannel = "email" | "slack";

export interface TestNotificationChannelResult {
  channel: TestNotificationChannel;
  attempted: boolean;
  ok: boolean;
  skippedReason?: string | null;
  error?: string | null;
}

const TEST_SUBJECT = "HiringAI test notification";
const TEST_BODY = [
  "This is a test notification from HiringAI.",
  "If you received this, the channel is wired up correctly and ready to deliver real email regression alerts.",
  "",
  "You can ignore this message — no candidate email actually changed status.",
].join("\n");

/**
 * Send a sample message on every enabled channel. Used by the Settings UI
 * "Send test" button to verify configuration without waiting for a real
 * regression. Each channel is reported independently; a failure on one
 * channel never blocks the others.
 */
export async function sendTestNotification(): Promise<
  TestNotificationChannelResult[]
> {
  const settings = await getNotificationSettings();
  const results: TestNotificationChannelResult[] = [];

  // Slack
  if (!settings.slackEnabled) {
    results.push({
      channel: "slack",
      attempted: false,
      ok: false,
      skippedReason: "Slack notifications are turned off.",
    });
  } else if (!settings.slackWebhookUrl) {
    results.push({
      channel: "slack",
      attempted: false,
      ok: false,
      skippedReason: "No Slack webhook URL configured.",
    });
  } else {
    try {
      await sendSlackRaw(settings.slackWebhookUrl, TEST_SUBJECT, TEST_BODY);
      results.push({ channel: "slack", attempted: true, ok: true });
    } catch (err) {
      results.push({
        channel: "slack",
        attempted: true,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Email
  if (!settings.emailEnabled) {
    results.push({
      channel: "email",
      attempted: false,
      ok: false,
      skippedReason: "Email notifications are turned off.",
    });
  } else if (settings.emailRecipients.length === 0) {
    results.push({
      channel: "email",
      attempted: false,
      ok: false,
      skippedReason: "No recipient email addresses configured.",
    });
  } else if (!settings.emailDeliveryConfigured) {
    results.push({
      channel: "email",
      attempted: false,
      ok: false,
      skippedReason:
        "Email delivery isn't configured on the server (SENDGRID_API_KEY missing).",
    });
  } else {
    try {
      await sendEmailRaw(
        settings.emailRecipients.map((r) => r.email),
        TEST_SUBJECT,
        TEST_BODY,
      );
      results.push({ channel: "email", attempted: true, ok: true });
    } catch (err) {
      results.push({
        channel: "email",
        attempted: true,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

export interface DigestRow {
  id: number;
  candidateId: number;
  candidateName: string;
  candidateEmail: string | null;
  previousStatus: string;
  newStatus: string;
  newReason: string | null;
  changedAt: Date;
}

/**
 * Hard cap on the number of regression rows included in a single digest
 * email. Anything beyond this is summarised in the body and rolled into the
 * next digest by leaving the cursor parked at the last included row's
 * `changedAt`. This protects SendGrid request size limits and keeps the
 * email skimmable when the scheduler has been offline for a long time.
 */
export const MAX_DIGEST_ROWS = 100;

/**
 * If the actual window covered by the digest exceeds the configured cadence
 * by this multiplier, a "backlog" header is added so recipients can tell a
 * normal daily digest apart from one that just caught up after downtime.
 */
const BACKLOG_WINDOW_RATIO = 1.5;

function formatWindowHours(windowMs: number): string {
  const hours = windowMs / (60 * 60 * 1000);
  if (hours >= 24) {
    const days = hours / 24;
    const rounded = days >= 10 ? Math.round(days) : Math.round(days * 10) / 10;
    return `${rounded}d`;
  }
  if (hours >= 1) {
    const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
    return `${rounded}h`;
  }
  const minutes = Math.max(1, Math.round(windowMs / (60 * 1000)));
  return `${minutes}m`;
}

interface DigestWindow {
  windowMs: number;
  cadenceMs: number;
  totalCount: number;
  truncatedCount: number;
}

function buildDigestSubject(includedRows: DigestRow[], window: DigestWindow): string {
  const label = formatWindowHours(window.windowMs);
  const isBacklog = window.windowMs > window.cadenceMs * BACKLOG_WINDOW_RATIO;
  const prefix = isBacklog ? "[HiringAI][backlog]" : "[HiringAI]";
  const count = window.totalCount;
  return `${prefix} ${count} new email regression${count === 1 ? "" : "s"} in the last ${label}`;
}

function buildDigestBody(includedRows: DigestRow[], window: DigestWindow): string {
  const label = formatWindowHours(window.windowMs);
  const header: string[] = [
    `${window.totalCount} email validation regression${window.totalCount === 1 ? " was" : "s were"} recorded in the last ${label}.`,
  ];
  if (window.windowMs > window.cadenceMs * BACKLOG_WINDOW_RATIO) {
    const cadenceLabel = formatWindowHours(window.cadenceMs);
    header.push(
      `Heads up: this digest covers a wider window than your usual ${cadenceLabel} cadence — likely because the scheduler was catching up on a backlog.`,
    );
  }
  header.push("");

  const lines = includedRows.map((r) => {
    const reason = r.newReason ? ` — ${r.newReason}` : "";
    const email = r.candidateEmail ?? "(no email)";
    return `• ${r.candidateName} (#${r.candidateId}, ${email}): ${r.previousStatus} → ${r.newStatus}${reason}`;
  });

  const footer: string[] = [""];
  if (window.truncatedCount > 0) {
    footer.push(
      `… and ${window.truncatedCount} more not shown here. They will be included in the next digest.`,
      "",
    );
  }
  footer.push("— HiringAI");
  return [...header, ...lines, ...footer].join("\n");
}

/**
 * Load all regression rows that should be included in the next digest, joined
 * with the candidate's name + email so the body can show useful context.
 *
 * `since` is exclusive on `changed_at`. When null, falls back to a
 * `digestCadenceHours`-wide window so the very first digest after enabling
 * the feature does not flood recipients with the entire history.
 */
export interface DigestPreviewSummary {
  cadenceHours: number;
  since: Date | null;
  digestRecipientCount: number;
  rows: DigestRow[];
}

/**
 * Build the same payload the next digest sweep would render — without sending
 * anything. Used by the Settings UI "preview" affordance so recruiters can see
 * what's about to ship before they click "Send digest now".
 */
export async function previewDigest(): Promise<DigestPreviewSummary> {
  const settings = await getNotificationSettings();
  const digestRecipientCount = settings.emailRecipients.filter(
    (r) => r.mode === "digest",
  ).length;
  const rows = await loadDigestRows(
    settings.digestLastSentAt,
    settings.digestCadenceHours,
  );
  return {
    cadenceHours: settings.digestCadenceHours,
    since: settings.digestLastSentAt,
    digestRecipientCount,
    rows,
  };
}

export interface DigestStatus {
  cadenceHours: number;
  lastSentAt: Date | null;
  /**
   * Projected wall-clock time of the next scheduler tick. Computed from
   * `lastSentAt + cadenceHours`. Null while the scheduler is gated off
   * (email disabled, no digest recipients, or delivery not configured) —
   * in that case the scheduler is slow-polling and won't fire until the
   * gate opens, so showing a concrete time would be misleading.
   *
   * When `lastSentAt` is null but the scheduler is enabled, the value is
   * `now + cadenceHours` to mirror the first-tick behaviour in
   * `startDigestScheduler`.
   */
  nextTickAt: Date | null;
  /**
   * True when the next tick would actually attempt a send (matches the
   * `enabled` predicate in `startDigestScheduler`). When false, the
   * scheduler is alive but slow-polling for settings changes.
   */
  schedulerEnabled: boolean;
  /** True when next tick is in the past — scheduler is overdue / catching up. */
  overdue: boolean;
  digestRecipientCount: number;
  queuedRegressionCount: number;
}

/**
 * Snapshot used by the Settings → Notifications "next digest" indicator.
 *
 * Returns enough information for the UI to render:
 *   • when the last digest went out
 *   • when the scheduler will fire next (or "paused" if disabled)
 *   • how many regressions are queued for the next digest
 *
 * The cadence math here mirrors `startDigestScheduler` so the UI never
 * disagrees with the actual scheduler behaviour.
 */
export async function getDigestStatus(
  now: Date = new Date(),
): Promise<DigestStatus> {
  const settings = await getNotificationSettings();
  const digestRecipientCount = settings.emailRecipients.filter(
    (r) => r.mode === "digest",
  ).length;
  const schedulerEnabled =
    settings.emailEnabled &&
    settings.emailDeliveryConfigured &&
    digestRecipientCount > 0;

  const cadenceMs = settings.digestCadenceHours * 60 * 60 * 1000;
  let nextTickAt: Date | null = null;
  if (schedulerEnabled) {
    nextTickAt = settings.digestLastSentAt
      ? new Date(settings.digestLastSentAt.getTime() + cadenceMs)
      : new Date(now.getTime() + cadenceMs);
  }
  const overdue =
    nextTickAt !== null && nextTickAt.getTime() < now.getTime();

  const rows = await loadDigestRows(
    settings.digestLastSentAt,
    settings.digestCadenceHours,
  );

  return {
    cadenceHours: settings.digestCadenceHours,
    lastSentAt: settings.digestLastSentAt,
    nextTickAt,
    schedulerEnabled,
    overdue,
    digestRecipientCount,
    queuedRegressionCount: rows.length,
  };
}

export async function loadDigestRows(
  since: Date | null,
  cadenceHours: number,
): Promise<DigestRow[]> {
  const lowerBound =
    since ?? new Date(Date.now() - cadenceHours * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: emailStatusChangesTable.id,
      candidateId: emailStatusChangesTable.candidateId,
      previousStatus: emailStatusChangesTable.previousStatus,
      newStatus: emailStatusChangesTable.newStatus,
      newReason: emailStatusChangesTable.newReason,
      changedAt: emailStatusChangesTable.changedAt,
      candidateName: candidatesTable.name,
      candidateEmail: candidatesTable.email,
    })
    .from(emailStatusChangesTable)
    .innerJoin(
      candidatesTable,
      eq(emailStatusChangesTable.candidateId, candidatesTable.id),
    )
    .where(gt(emailStatusChangesTable.changedAt, lowerBound))
    .orderBy(emailStatusChangesTable.changedAt);
  return rows;
}

export interface DigestRunResult {
  attempted: boolean;
  recipientCount: number;
  /** Number of regression rows actually included in the email body. */
  regressionCount: number;
  /**
   * Number of additional rows that matched the window but were dropped by
   * the per-digest cap. These are picked up by the next digest because the
   * cursor is parked at the last included row's `changedAt`.
   */
  truncatedCount?: number;
  reason?: string;
}

/**
 * Build and send a single digest email to every digest-mode recipient covering
 * regressions since the last successful digest. Idempotent in the sense that
 * the next call will simply find an empty window.
 *
 * `now` is injectable for tests. Returns a structured summary so the caller
 * (HTTP route or scheduler) can log meaningful telemetry.
 */
export async function runDigestSweep(
  now: Date = new Date(),
): Promise<DigestRunResult> {
  const settings = await getNotificationSettings();
  const digestRecipients = settings.emailRecipients
    .filter((r) => r.mode === "digest")
    .map((r) => r.email);

  if (
    !settings.emailEnabled ||
    digestRecipients.length === 0 ||
    !settings.emailDeliveryConfigured
  ) {
    return {
      attempted: false,
      recipientCount: digestRecipients.length,
      regressionCount: 0,
      reason: !settings.emailEnabled
        ? "email_disabled"
        : digestRecipients.length === 0
          ? "no_digest_recipients"
          : "delivery_not_configured",
    };
  }

  const cadenceMs = settings.digestCadenceHours * 60 * 60 * 1000;
  const lowerBound =
    settings.digestLastSentAt ?? new Date(now.getTime() - cadenceMs);
  const rows = await loadDigestRows(
    settings.digestLastSentAt,
    settings.digestCadenceHours,
  );

  if (rows.length === 0) {
    // Nothing to send — but advance the cursor so the next tick aligns to
    // `now` instead of falling further behind.
    await db
      .update(notificationSettingsTable)
      .set({ digestLastSentAt: now })
      .where(eq(notificationSettingsTable.id, SINGLETON_ID));
    return {
      attempted: false,
      recipientCount: digestRecipients.length,
      regressionCount: 0,
      reason: "no_new_regressions",
    };
  }

  // Cap the per-email batch so a long backlog doesn't produce an oversized
  // SendGrid request or an unreadable email. Remaining rows stay un-stamped
  // and the cursor parks at the last included row's `changedAt`, so the next
  // digest picks up exactly where this one stopped.
  //
  // Tie-handling: `loadDigestRows` filters with `gt(changedAt, cursor)` —
  // strictly greater than. If we naively cut at MAX_DIGEST_ROWS and the row
  // immediately after shares its `changedAt` with the last included row,
  // those tied rows would be permanently skipped because the next sweep's
  // `gt(cursor)` filter would exclude them. To avoid silent data loss we
  // extend the included batch through any timestamp ties at the boundary.
  // In the worst case this slightly exceeds the cap, but only by however many
  // regressions happened to share a single millisecond — a bounded overshoot
  // we accept in exchange for never dropping a notification.
  let cutoff = MAX_DIGEST_ROWS;
  if (rows.length > MAX_DIGEST_ROWS) {
    const tieTime = rows[MAX_DIGEST_ROWS - 1]!.changedAt.getTime();
    while (
      cutoff < rows.length &&
      rows[cutoff]!.changedAt.getTime() === tieTime
    ) {
      cutoff++;
    }
  }
  const includedRows = rows.slice(0, cutoff);
  const truncatedCount = rows.length - includedRows.length;
  const cursorAdvanceTo =
    truncatedCount > 0
      ? includedRows[includedRows.length - 1]!.changedAt
      : now;
  const windowMs = cursorAdvanceTo.getTime() - lowerBound.getTime();
  const window: DigestWindow = {
    windowMs: Math.max(windowMs, 0),
    cadenceMs,
    totalCount: rows.length,
    truncatedCount,
  };

  await sendEmailRaw(
    digestRecipients,
    buildDigestSubject(includedRows, window),
    buildDigestBody(includedRows, window),
  );

  // Stamp notification_sent_at on every row that was actually included in
  // this digest so the UI "notified externally" state matches the email.
  const ids = includedRows
    .filter((r) => r.id !== undefined)
    .map((r) => r.id);
  if (ids.length > 0) {
    await db
      .update(emailStatusChangesTable)
      .set({ notificationSentAt: now })
      .where(inArray(emailStatusChangesTable.id, ids));
  }

  await db
    .update(notificationSettingsTable)
    .set({ digestLastSentAt: cursorAdvanceTo })
    .where(eq(notificationSettingsTable.id, SINGLETON_ID));

  logger.info(
    {
      recipientCount: digestRecipients.length,
      regressionCount: includedRows.length,
      truncatedCount,
      cadenceHours: settings.digestCadenceHours,
      windowMs: window.windowMs,
    },
    "Email regression digest sent",
  );

  return {
    attempted: true,
    recipientCount: digestRecipients.length,
    regressionCount: includedRows.length,
    truncatedCount,
  };
}

const MIN_DIGEST_TICK_MS = 60 * 1000;
let digestTimer: NodeJS.Timeout | undefined;
let digestStopped = false;

/**
 * Long-running scheduler that fires `runDigestSweep` on the configured
 * cadence. Re-reads the settings row every tick so cadence changes from the
 * UI take effect on the next interval — no redeploy needed.
 *
 * The timer is `unref`'d so it never prevents the process from exiting.
 */
export function startDigestScheduler(): void {
  if (digestTimer || digestStopped) return;

  const scheduleNext = async () => {
    let cadenceMs = 24 * 60 * 60 * 1000;
    let enabled = false;
    let lastSent: Date | null = null;
    try {
      const settings = await getNotificationSettings();
      cadenceMs = Math.max(
        settings.digestCadenceHours * 60 * 60 * 1000,
        MIN_DIGEST_TICK_MS,
      );
      enabled =
        settings.emailEnabled &&
        settings.emailDeliveryConfigured &&
        settings.emailRecipients.some((r) => r.mode === "digest");
      lastSent = settings.digestLastSentAt;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Digest scheduler: failed to load settings, retrying in 5m",
      );
      cadenceMs = 5 * 60 * 1000;
    }

    let delay: number;
    if (!enabled) {
      // Slow-poll while disabled so the next save from the UI takes effect
      // within a minute.
      delay = MIN_DIGEST_TICK_MS;
    } else if (!lastSent) {
      // First-ever tick — wait one cadence so we don't fire immediately at boot.
      delay = cadenceMs;
    } else {
      const elapsed = Date.now() - lastSent.getTime();
      delay = Math.max(cadenceMs - elapsed, MIN_DIGEST_TICK_MS);
    }

    digestTimer = setTimeout(() => {
      digestTimer = undefined;
      void runTickThenReschedule(enabled);
    }, delay);
    if (typeof digestTimer.unref === "function") digestTimer.unref();
  };

  const runTickThenReschedule = async (shouldRun: boolean) => {
    if (shouldRun) {
      try {
        await runDigestSweep();
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "Digest sweep crashed",
        );
      }
    }
    if (!digestStopped) await scheduleNext();
  };

  logger.info("Digest scheduler started");
  void scheduleNext();
}

/** Stop the digest scheduler (test helper / graceful shutdown). */
export function stopDigestScheduler(): void {
  digestStopped = true;
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = undefined;
  }
}
