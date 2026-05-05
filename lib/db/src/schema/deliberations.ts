import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";
import { candidatesTable } from "./candidates";
import { jobsTable } from "./jobs";
import { agentRunsTable } from "./agent-runs";

export const deliberationStatusEnum = pgEnum("deliberation_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

/**
 * One pole's verdict in a Council deliberation. Council deliberates with 15
 * named poles; each emits a verdict + short reasoning we surface in the UI.
 */
export type DeliberationPole = {
  id: string;
  name: string;
  verdict: string;
  signal: number;
  reasoning: string;
};

/**
 * Recommended next action surfaced in the Orientations panel.
 */
export type DeliberationOrientation = {
  title: string;
  detail: string;
};

/**
 * Structured payload returned by Council's deliberate API. Stored verbatim in
 * `deliberations.result` and returned over the API to drive the boardroom UI.
 */
export type DeliberationResult = {
  convergence: {
    summary: string;
    verdict: string;
  };
  divergence: {
    summary: string;
    axes: string[];
  };
  orientations: DeliberationOrientation[];
  poles: DeliberationPole[];
};

export const deliberationsTable = pgTable("deliberations", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id")
    .notNull()
    .references(() => candidatesTable.id, { onDelete: "cascade" }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  /**
   * Set when the deliberation was triggered as part of a workflow run.
   * Null for ad-hoc deliberations launched from the candidate detail page.
   */
  runId: integer("run_id").references(() => agentRunsTable.id, {
    onDelete: "set null",
  }),
  /**
   * Application stage the candidate was in when the deliberation ran.
   * Free-text to avoid coupling to the application stage enum.
   */
  stage: text("stage").notNull(),
  status: deliberationStatusEnum("status").notNull().default("pending"),
  result: jsonb("result").$type<DeliberationResult>(),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Deliberation = typeof deliberationsTable.$inferSelect;
