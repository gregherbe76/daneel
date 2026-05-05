import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Persistent CSRF state store for the Scout Connect redirect flow.
 *
 * Persisted in Postgres (instead of an in-process Map) so a state token
 * issued by `POST /api/integrations/scout/state` survives an API server
 * restart in the ~10 minute window before Scout redirects back, and so
 * the same flow keeps working if we ever run multiple API instances.
 *
 * Rows are short-lived: rows older than the TTL or used long enough ago
 * to defeat replay attacks are pruned by the store on every issue/consume.
 */
export type ScoutStateOptions = {
  autoAssignSteps?: boolean;
};

export const scoutConnectStatesTable = pgTable("scout_connect_states", {
  state: text("state").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  usedAt: timestamp("used_at"),
  options: jsonb("options").$type<ScoutStateOptions>().notNull().default({}),
});

export type ScoutConnectState = typeof scoutConnectStatesTable.$inferSelect;
