import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";
import { agentRunsTable } from "./agent-runs";
import { jobsTable } from "./jobs";
import { candidatesTable } from "./candidates";

export const recommendationEnum = pgEnum("recommendation", [
  "Strong Yes",
  "Yes",
  "Maybe",
  "No",
]);

export const aiEvaluationsTable = pgTable("ai_evaluations", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => agentRunsTable.id, { onDelete: "cascade" }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  candidateId: integer("candidate_id")
    .notNull()
    .references(() => candidatesTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull(), // = decisionScore (kept for backward compat / sorting)
  fitScore: integer("fit_score"),           // AI-assessed candidate fit (no data penalty)
  dataConfidenceScore: integer("data_confidence_score"), // 0-100 based on profile completeness
  decisionScore: integer("decision_score"), // fitScore * (0.6 + 0.4 * dataConfidence/100)
  confidenceLevel: text("confidence_level"), // "High" | "Medium" | "Low"
  confidenceReason: text("confidence_reason"),
  missingDataWarnings: jsonb("missing_data_warnings").$type<string[]>(),
  requiresEnrichment: boolean("requires_enrichment").notNull().default(false),
  strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
  gaps: jsonb("gaps").$type<string[]>().notNull().default([]),
  risks: jsonb("risks").$type<string[]>().notNull().default([]),
  recommendation: recommendationEnum("recommendation").notNull(),
  scoreBreakdown: jsonb("score_breakdown").$type<ScoreBreakdown>(),
  clientFitNarrativeOverride: text("client_fit_narrative_override"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const jobInsightsTable = pgTable("job_insights", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => agentRunsTable.id, { onDelete: "cascade" }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  mustHaveSkills: jsonb("must_have_skills").$type<string[]>().notNull().default([]),
  seniority: text("seniority").notNull(),
  evaluationCriteria: jsonb("evaluation_criteria").$type<string[]>().notNull().default([]),
  idealCandidateProfile: text("ideal_candidate_profile").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const shortlistsTable = pgTable("shortlists", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => agentRunsTable.id, { onDelete: "cascade" }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  rankedCandidateIds: jsonb("ranked_candidate_ids").$type<number[]>().notNull().default([]),
  summaries: jsonb("summaries").$type<ShortlistEntry[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ScoreDimension = {
  score: number;
  weight: number;
  reasoning: string;
};

export type ScoreBreakdown = {
  skillsMatch: ScoreDimension;
  experienceDepth: ScoreDimension;
  communication: ScoreDimension;
  clientFit: ScoreDimension;
  stability: ScoreDimension;
  autonomy: ScoreDimension;
};

export type ShortlistEntry = {
  candidateId: number;
  candidateName: string;
  whyRelevant: string;
  keyRisks: string;
  finalRecommendation: string;
};

export type AiEvaluation = typeof aiEvaluationsTable.$inferSelect;
export type JobInsight = typeof jobInsightsTable.$inferSelect;
export type Shortlist = typeof shortlistsTable.$inferSelect;
