import { pgTable, serial, text, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCandidateSchema = createInsertSchema(candidatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidatesTable.$inferSelect;
