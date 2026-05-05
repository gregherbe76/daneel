import { pgTable, integer, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Per-recipient delivery mode.
 * - `instant`  → fire one email per regression as it happens (legacy behaviour).
 * - `digest`   → roll regressions up into a single periodic email per recipient.
 */
export type RecipientMode = "instant" | "digest";

/**
 * Map of recipient email → delivery mode. Recipients not present in this map
 * default to `"instant"` so the table behaves the same as before this column
 * existed.
 */
export type RecipientModes = Record<string, RecipientMode>;

/**
 * Singleton settings row (id is fixed to 1) controlling outbound notifications
 * for email validation regressions. Per-recruiter delivery is not yet wired
 * because there is no users table; for now this acts as the global preference.
 */
export const notificationSettingsTable = pgTable("notification_settings", {
  id: integer("id").primaryKey().default(1),
  /** When false, no email notifications are dispatched. */
  emailEnabled: boolean("email_enabled").notNull().default(false),
  /**
   * Comma-separated list of recipient email addresses. Stored as text to keep
   * the migration simple; parsed on use.
   */
  emailRecipients: text("email_recipients").notNull().default(""),
  /**
   * Per-recipient delivery mode override. Recipients absent from this map
   * default to `"instant"`.
   */
  recipientModes: jsonb("recipient_modes")
    .$type<RecipientModes>()
    .notNull()
    .default({}),
  /**
   * Cadence (in hours) at which the digest scheduler emits a summary email to
   * digest-mode recipients. Defaults to 24h ("daily digest").
   */
  digestCadenceHours: integer("digest_cadence_hours").notNull().default(24),
  /**
   * Timestamp of the most recent successful digest dispatch. Used as the
   * lower bound for "regressions since the last digest" and to gate the next
   * tick of the digest scheduler.
   */
  digestLastSentAt: timestamp("digest_last_sent_at"),
  /** When false, no Slack webhook calls are made. */
  slackEnabled: boolean("slack_enabled").notNull().default(false),
  /** Slack incoming-webhook URL. */
  slackWebhookUrl: text("slack_webhook_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type NotificationSettings = typeof notificationSettingsTable.$inferSelect;
