import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  pgEnum,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

export type GithubProviderConfig = {
  extraKeywords?: string | null;
  excludeOrgs?: string | null;
  minFollowers?: number | null;
  minRepos?: number | null;
  requireBio?: boolean | null;
  activeWithinMonths?: number | null;
};

export type ApifyProviderConfig = {
  /**
   * Apify actor ID (e.g. `apify/google-search-scraper`). The provider will
   * call `acts/{actorId}/run-sync-get-dataset-items`. Defaults to the Google
   * Search Scraper actor — its organic-result schema is compatible with the
   * shared `extractCandidates` extractor.
   */
  actorId?: string | null;
  /** Free-text keywords appended to the constructed Boolean query. */
  extraKeywords?: string | null;
  /** Sites the search should focus on. Used as `(site:a OR site:b)` filter. */
  targetSites?: string[] | null;
  /** Domains/paths excluded via `-site:` operators. */
  excludeSites?: string[] | null;
  /** Results per page to ask the actor for (cap on dataset size per run). */
  resultsPerPage?: number | null;
};

export type WebSearchProviderConfig = {
  /** Free-text keywords appended to the constructed Boolean query. */
  extraKeywords?: string | null;
  /**
   * Sites the search should focus on. Used as `(site:a OR site:b)` filter.
   * Defaults applied at query-build time when omitted/empty.
   */
  targetSites?: string[] | null;
  /** Domains/paths excluded via `-site:` operators. */
  excludeSites?: string[] | null;
};

export type TwinAgentProviderConfig = {
  /**
   * Override for the Twin backend base URL. Defaults to Twin's hosted prod
   * deployment when omitted. The API key flows through the existing
   * `apiKeyEncryptedPlaceholder` column on the provider row.
   */
  baseUrl?: string | null;
  /**
   * If true, the provider opens an SSE stream to receive partial candidate
   * cards as Twin's browser agent finds them. If false, the provider blocks
   * on a single JSON response. Defaults to false (sync) when omitted.
   */
  streaming?: boolean | null;
};

export type CodeMatchProviderConfig = {
  /**
   * Override for the CodeMatch backend base URL. Defaults to the hosted
   * production deployment (`https://assess.codes/api/v1`) when omitted. The
   * API key flows through the existing `apiKeyEncryptedPlaceholder` column
   * on the provider row (sent as `Authorization: Bearer <key>`).
   */
  baseUrl?: string | null;
};

export type ExtendProviderConfig = {
  /**
   * Override for the Extend backend base URL. Defaults to the hosted
   * production deployment (`https://pattern.aplayer.ai/api/v1`) when omitted.
   * The API key flows through the existing `apiKeyEncryptedPlaceholder`
   * column on the provider row (sent as `Authorization: Bearer <key>`).
   */
  baseUrl?: string | null;
};

export type CouncilProviderConfig = {
  /**
   * Override for the Council backend base URL. Defaults to Council's prod
   * deployment when omitted. The API key flows through the existing
   * `apiKeyEncryptedPlaceholder` column on the provider row.
   */
  baseUrl?: string | null;
};

export type AgentProviderConfig = {
  github?: GithubProviderConfig;
  web_search?: WebSearchProviderConfig;
  apify?: ApifyProviderConfig;
  council?: CouncilProviderConfig;
  twin_agent?: TwinAgentProviderConfig;
  codematch?: CodeMatchProviderConfig;
  extend?: ExtendProviderConfig;
};

export const providerTypeEnum = pgEnum("provider_type", [
  "native_openai",
  "custom_webhook",
  "twin_webhook",
  "github",
  "web_search",
  "apify",
  "council",
  "twin_agent",
  "codematch",
  "extend",
]);

export const workflowStepEnum = pgEnum("workflow_step", [
  "job_understanding",
  "candidate_matching",
  "shortlist_generation",
  "sourcing_later",
  "sourcing",
  "enrichment",
  "decision",
  "technical_evaluation",
]);

export const agentProvidersTable = pgTable("agent_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: providerTypeEnum("type").notNull(),
  baseUrl: text("base_url"),
  webhookUrl: text("webhook_url"),
  apiKeyEncryptedPlaceholder: text("api_key_encrypted_placeholder"),
  config: jsonb("config").$type<AgentProviderConfig>(),
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
