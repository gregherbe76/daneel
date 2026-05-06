import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { agentRunsTable } from "./agent-runs";
import { jobsTable } from "./jobs";
import { candidatesTable } from "./candidates";

/**
 * Per-(run, candidate, job) result of the optional `technical_evaluation`
 * workflow step. Mirrors the `ai_evaluations` shape so historical reports
 * can render past technical scores even after a rubric change. The step is
 * powered by external evaluation providers (currently CodeMatch) — never by
 * the native engine.
 *
 * `evaluated = false` rows are persisted on purpose: a recruiter needs to see
 * WHY a candidate wasn't scored ("no_github_username", "premium_required",
 * "rate_limited", etc.) instead of an empty section.
 */
export const technicalEvaluationsTable = pgTable(
  "technical_evaluations",
  {
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
    evaluated: boolean("evaluated").notNull().default(false),
    providerName: text("provider_name").notNull(),
    providerType: text("provider_type").notNull(),
    scores: jsonb("scores").$type<TechnicalEvaluationScores>(),
    strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
    redFlags: jsonb("red_flags").$type<string[]>().notNull().default([]),
    summary: text("summary"),
    reportUrl: text("report_url"),
    error: text("error"),
    evaluatedAt: timestamp("evaluated_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    runCandidateIdx: index("technical_evaluations_run_candidate_idx").on(
      t.runId,
      t.candidateId,
    ),
    candidateIdx: index("technical_evaluations_candidate_idx").on(t.candidateId),
  }),
);

/**
 * Five-dimension technical score returned by every evaluation provider. All
 * values are 0-100. `overall` is the provider's own composite — Daneel does
 * NOT recompute it because each provider has its own weighting model.
 */
export type TechnicalEvaluationScores = {
  technical_depth: number;
  ownership: number;
  consistency: number;
  taste: number;
  impact: number;
  overall: number;
};

export type TechnicalEvaluation = typeof technicalEvaluationsTable.$inferSelect;
