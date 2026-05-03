import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  linkedIn: text("linked_in"),
  summary: text("summary"),
  skills: text("skills").array().notNull().default([]),
  // Sourcing-enriched fields
  headline: text("headline"),
  location: text("location"),
  currentCompany: text("current_company"),
  githubUrl: text("github_url"),
  source: text("source"),
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
