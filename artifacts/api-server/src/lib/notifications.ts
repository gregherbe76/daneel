import { eq } from "drizzle-orm";
import {
  db,
  notificationSettingsTable,
  emailStatusChangesTable,
  type NotificationSettings,
  type EmailStatusChange,
} from "@workspace/db";
import { logger } from "./logger";

const SINGLETON_ID = 1;

export interface NotificationSettingsResponse {
  emailEnabled: boolean;
  emailRecipients: string[];
  slackEnabled: boolean;
  slackWebhookUrl: string | null;
  emailDeliveryConfigured: boolean;
  updatedAt: Date;
}

function parseRecipients(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function emailDeliveryConfigured(): boolean {
  return Boolean(process.env["SENDGRID_API_KEY"]);
}

function toResponse(row: NotificationSettings): NotificationSettingsResponse {
  return {
    emailEnabled: row.emailEnabled,
    emailRecipients: parseRecipients(row.emailRecipients),
    slackEnabled: row.slackEnabled,
    slackWebhookUrl: row.slackWebhookUrl,
    emailDeliveryConfigured: emailDeliveryConfigured(),
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
  emailRecipients: string[];
  slackEnabled: boolean;
  slackWebhookUrl?: string | null;
}): Promise<NotificationSettingsResponse> {
  await getNotificationSettings();
  const [updated] = await db
    .update(notificationSettingsTable)
    .set({
      emailEnabled: input.emailEnabled,
      emailRecipients: input.emailRecipients
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .join(","),
      slackEnabled: input.slackEnabled,
      slackWebhookUrl: input.slackWebhookUrl ?? null,
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

async function sendSlack(
  webhookUrl: string,
  payload: RegressionPayload,
): Promise<void> {
  const text = `*${buildSubject(payload)}*\n${buildBody(payload)}`;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${res.statusText}`);
  }
}

async function sendEmail(
  recipients: string[],
  payload: RegressionPayload,
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
      personalizations: [
        { to: recipients.map((email) => ({ email })) },
      ],
      from: { email: fromEmail },
      subject: buildSubject(payload),
      content: [{ type: "text/plain", value: buildBody(payload) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid request failed: ${res.status} ${body}`);
  }
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

  if (
    settings.emailEnabled &&
    settings.emailRecipients.length > 0 &&
    settings.emailDeliveryConfigured
  ) {
    tasks.push(
      sendEmail(settings.emailRecipients, payload)
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
