import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";

export const runStatusEnum = pgEnum("run_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const stepStatusEnum = pgEnum("step_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export type VariantCriteria = {
  seniority?: string;
  mustHaveSkills?: string[];
  focusNote?: string;
};

export const agentRunsTable = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  status: runStatusEnum("status").notNull().default("pending"),
  runSourcing: boolean("run_sourcing").notNull().default(false),
  variantOf: integer("variant_of"),
  variantCriteria: jsonb("variant_criteria").$type<VariantCriteria>(),
  variantLabel: text("variant_label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentLogsTable = pgTable("agent_logs", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => agentRunsTable.id, { onDelete: "cascade" }),
  step: text("step").notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  status: stepStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AgentRun = typeof agentRunsTable.$inferSelect;
export type AgentLog = typeof agentLogsTable.$inferSelect;
