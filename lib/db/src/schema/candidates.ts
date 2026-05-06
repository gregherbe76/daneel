import { pgTable, serial, text, timestamp, real, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";

export const candidatesTable = pgTable(
  "candidates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Email uniqueness is enforced as a *partial* unique index further below
    // (only WHERE deleted_at IS NULL). This keeps a normal unique constraint
    // on live rows but lets a recruiter re-import a candidate they previously
    // soft-deleted without colliding on the trash-bin row.
    email: text("email"),
    linkedIn: text("linked_in"),
    summary: text("summary"),
    skills: text("skills").array().notNull().default([]),
    // Sourcing-enriched fields
    headline: text("headline"),
    location: text("location"),
    currentCompany: text("current_company"),
    githubUrl: text("github_url"),
    githubUsername: text("github_username"),
    sourcingConfidence: real("sourcing_confidence"),
    source: text("source"),
    // Where the candidate's email came from. Helps recruiters gauge trust before
    // outreach. Values: "profile" (verified profile email), "commit" (inferred
    // from public commit metadata), "noreply" (placeholder noreply, undeliverable),
    // "generated" (AI-generated/mock placeholder), "manual" (entered by recruiter).
    emailSource: text("email_source"),
    // Enrichment fields
    enrichedAt: timestamp("enriched_at"),
    enrichmentSource: text("enrichment_source"),
    enrichmentConfidence: real("enrichment_confidence"),
    enrichmentStatus: text("enrichment_status"), // "enriched" | "partial" | "failed"
    // Email deliverability validation (lightweight MX-record check at sourcing time)
    emailValidationStatus: text("email_validation_status"), // "valid" | "invalid" | "risky" | "unchecked"
    emailValidationReason: text("email_validation_reason"),
    emailValidatedAt: timestamp("email_validated_at"),
    // Soft-delete fields. When `deletedAt` is set the candidate is hidden from
    // every recruiter-facing list, but the row (and its cascading children:
    // applications, notes, evaluations) is still on disk so a bulk delete can be
    // undone via the toast action. A scheduled trash sweeper hard-deletes rows
    // whose `deletedAt` crosses the retention window.
    // `deletionBatchId` groups every candidate that was deleted in the same
    // bulk action so the "Undo" toast can restore exactly that batch (rather
    // than restoring unrelated rows that happen to be in the trash).
    deletedAt: timestamp("deleted_at"),
    deletionBatchId: text("deletion_batch_id"),
    // Snapshot of the candidate's job attachments at the moment of soft-delete.
    // Recorded so the Trash view can show pipeline context ("attached to N
    // jobs, M now archived/deleted") even after a job has been hard-deleted
    // and the cascade dropped the application row. Cleared back to null on
    // restore. Null on legacy rows soft-deleted before this column existed.
    deletedAttachmentSnapshot: jsonb("deleted_attachment_snapshot").$type<
      Array<{ jobId: number; title: string }>
    >(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Partial unique index: emails are unique only among non-trashed rows.
    // A soft-deleted candidate keeps its email row on disk for the trash
    // retention window, but a recruiter re-importing the same address must
    // succeed and create a fresh candidate — not collide with the tombstone.
    emailUniqueActive: uniqueIndex("candidates_email_active_unique")
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL`),
  }),
);

/**
 * Shared SQL fragment that filters the candidates table down to rows that
 * are NOT soft-deleted. Use everywhere a query joins or selects from
 * `candidatesTable` for a recruiter-facing surface (pipeline, reports,
 * workflow engine, mention search, dedupe lookups). Centralising the clause
 * prevents drift — if the soft-delete model ever changes (e.g. an enum
 * status column), only this helper needs to be updated.
 */
export const activeCandidateFilter: SQL = isNull(candidatesTable.deletedAt);

export const insertCandidateSchema = createInsertSchema(candidatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidatesTable.$inferSelect;
