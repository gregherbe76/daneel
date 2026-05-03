import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { candidatesTable } from "./candidates";

export const emailStatusChangesTable = pgTable(
  "email_status_changes",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    previousStatus: text("previous_status").notNull(),
    newStatus: text("new_status").notNull(),
    previousReason: text("previous_reason"),
    newReason: text("new_reason"),
    changedAt: timestamp("changed_at").notNull().defaultNow(),
    notifiedAt: timestamp("notified_at"),
    /**
     * When an outbound notification (email and/or Slack) was successfully
     * dispatched for this regression. Distinct from `notifiedAt`, which tracks
     * when the recruiter marked the inbox row read.
     */
    notificationSentAt: timestamp("notification_sent_at"),
  },
  (t) => ({
    candidateChangedIdx: index("email_status_changes_candidate_changed_idx").on(
      t.candidateId,
      sql`${t.changedAt} DESC`,
    ),
    unreadIdx: index("email_status_changes_unread_idx")
      .on(t.changedAt)
      .where(sql`${t.notifiedAt} IS NULL`),
  }),
);

export type EmailStatusChange = typeof emailStatusChangesTable.$inferSelect;
