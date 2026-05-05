import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { agentRunsTable } from "./agent-runs";

export const savedRunComparisonsTable = pgTable("saved_run_comparisons", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  runAId: integer("run_a_id")
    .notNull()
    .references(() => agentRunsTable.id, { onDelete: "cascade" }),
  runBId: integer("run_b_id")
    .notNull()
    .references(() => agentRunsTable.id, { onDelete: "cascade" }),
  runCId: integer("run_c_id").references(() => agentRunsTable.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SavedRunComparison = typeof savedRunComparisonsTable.$inferSelect;
