import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  pgEnum,
  integer,
} from "drizzle-orm/pg-core";

export const providerTypeEnum = pgEnum("provider_type", [
  "native_openai",
  "custom_webhook",
  "twin_webhook",
]);

export const workflowStepEnum = pgEnum("workflow_step", [
  "job_understanding",
  "candidate_matching",
  "shortlist_generation",
  "sourcing_later",
  "sourcing",
  "enrichment",
]);

export const agentProvidersTable = pgTable("agent_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: providerTypeEnum("type").notNull(),
  baseUrl: text("base_url"),
  webhookUrl: text("webhook_url"),
  apiKeyEncryptedPlaceholder: text("api_key_encrypted_placeholder"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workflowProviderSettingsTable = pgTable(
  "workflow_provider_settings",
  {
    id: serial("id").primaryKey(),
    workflowStep: workflowStepEnum("workflow_step").notNull().unique(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => agentProvidersTable.id, { onDelete: "restrict" }),
    enabled: boolean("enabled").notNull().default(true),
  },
);

export type AgentProvider = typeof agentProvidersTable.$inferSelect;
export type WorkflowProviderSetting =
  typeof workflowProviderSettingsTable.$inferSelect;
