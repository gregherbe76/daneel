import { pgTable, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

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
  /** When false, no Slack webhook calls are made. */
  slackEnabled: boolean("slack_enabled").notNull().default(false),
  /** Slack incoming-webhook URL. */
  slackWebhookUrl: text("slack_webhook_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type NotificationSettings = typeof notificationSettingsTable.$inferSelect;
