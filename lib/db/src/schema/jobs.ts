import { pgTable, serial, text, timestamp, pgEnum, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const seniorityEnum = pgEnum("seniority", [
  "Intern",
  "Junior",
  "Mid",
  "Senior",
  "Lead",
  "Principal",
  "Director",
  "VP",
]);

export type ScoringWeights = {
  autonomy: number;
  productMindset: number;
  impact: number;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  autonomy: 35,
  productMindset: 30,
  impact: 35,
};

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  location: text("location").notNull(),
  seniority: seniorityEnum("seniority").notNull(),
  mustHaveSkills: text("must_have_skills").array().notNull().default([]),
  clientName: text("client_name"),
  clientLogoUrl: text("client_logo_url"),
  scoringWeights: jsonb("scoring_weights")
    .$type<ScoringWeights>()
    .notNull()
    .default(DEFAULT_SCORING_WEIGHTS),
  technicalEvaluationEnabled: boolean("technical_evaluation_enabled")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
