/**
 * Provider Registry
 *
 * Responsible for resolving which AgentProvider instance handles each
 * workflow step at runtime. Resolution reads the workflow_provider_settings
 * table, which is configured via the Settings → Workflow Step Assignments UI.
 *
 * Resolution order (for all steps except sourcing and enrichment):
 *   1. Query workflow_provider_settings for the step
 *   2. If no row or disabled → return native fallback
 *   3. Query agent_providers for the configured provider
 *   4. If not found or disabled → log warn, return native fallback
 *   5. Build and return the provider instance
 *
 * Adding a new provider type:
 *   1. Add a case to buildProvider() below
 *   2. Add the type to the providerTypeEnum in lib/db/src/schema/agent-providers.ts
 *   3. Add the type to ProviderType in lib/api-spec/openapi.yaml
 *   4. Run: pnpm --filter @workspace/db run push
 *   5. Run: pnpm --filter @workspace/api-spec run codegen
 */

import {
  db,
  agentProvidersTable,
  workflowProviderSettingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AgentProvider, WorkflowStep } from "./interface";
import { NativeOpenAIProvider } from "./native-openai";
import { NativeOpenAIEnrichmentProvider } from "./native-openai-enrichment";
import { CustomWebhookProvider } from "./custom-webhook";
import { TwinWebhookProvider } from "./twin-webhook";
import { GithubSourcingProvider } from "./github";
import { WebSearchSourcingProvider } from "./web-search";
import { ApifySourcingProvider } from "./apify";
import { CouncilProvider } from "./council";
import { TwinAgentBrowserProvider } from "./twin-agent";
import { CodeMatchProvider } from "./codematch";
import { ExtendSourcingProvider } from "./extend";
import type { DecisionProvider } from "./decision-interface";
import type { EvaluationProvider } from "./evaluation-interface";
import { logger } from "../../../lib/logger";
import { decryptProviderSecret } from "../../../lib/provider-secrets";

/**
 * Strict decrypt at the runtime-dispatch boundary: a corrupt/wrong-key value
 * here would otherwise silently drop the Authorization header and surface
 * downstream as a confusing upstream 401. Throwing makes key misconfiguration
 * immediately visible in workflow logs.
 */
function decryptApiKeyOrThrow(
  stored: string | null | undefined,
  providerName: string,
): string | undefined {
  if (stored == null || stored === "") return undefined;
  try {
    return decryptProviderSecret(stored);
  } catch (err) {
    throw new Error(
      `Failed to decrypt API key for provider "${providerName}". ` +
        `Check that PROVIDER_KEY_SECRET matches the value used to encrypt the row. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Sentinel ID used for native fallback providers that are not stored in the DB.
 * These are instantiated directly without a DB row.
 */
const NATIVE_FALLBACK_ID = -1;
const NATIVE_FALLBACK_NAME = "Native OpenAI (default)";

/**
 * Construct a provider instance from a DB row.
 *
 * Each provider type has different required fields on the row:
 *   - custom_webhook: requires webhookUrl
 *   - twin_webhook:   requires baseUrl
 *   - native_openai:  no extra fields needed (uses the shared OpenAI integration)
 *
 * When adding a new provider type, add a case here and import the class above.
 */
function buildProvider(row: typeof agentProvidersTable.$inferSelect): AgentProvider {
  const apiKey = decryptApiKeyOrThrow(row.apiKeyEncryptedPlaceholder, row.name);
  switch (row.type) {
    case "native_openai":
      return new NativeOpenAIProvider(row.id, row.name);
    case "custom_webhook":
      if (!row.webhookUrl) throw new Error(`Provider "${row.name}" is missing webhookUrl`);
      return new CustomWebhookProvider(row.id, row.name, row.webhookUrl, apiKey);
    case "twin_webhook":
      if (!row.baseUrl) throw new Error(`Provider "${row.name}" is missing baseUrl`);
      return new TwinWebhookProvider(row.id, row.name, row.baseUrl, apiKey);
    case "github":
      return new GithubSourcingProvider(row.id, row.name, row.config?.github ?? null);
    case "web_search":
      return new WebSearchSourcingProvider(row.id, row.name, row.config?.web_search ?? null);
    case "apify":
      return new ApifySourcingProvider(
        row.id,
        row.name,
        row.apiKeyEncryptedPlaceholder ?? null,
        row.config?.apify ?? null,
      );
    case "twin_agent":
      return new TwinAgentBrowserProvider(row.id, row.name, apiKey, row.config?.twin_agent ?? null);
    case "extend":
      return new ExtendSourcingProvider(row.id, row.name, apiKey, row.config?.extend ?? null);
    case "council":
      throw new Error(
        `Provider "${row.name}" is a Council decision provider — use buildDecisionProvider() / resolveDecisionProvider() instead. ` +
          `Council can only be assigned to the "decision" workflow step.`,
      );
    case "codematch":
      throw new Error(
        `Provider "${row.name}" is a CodeMatch evaluation provider — use buildEvaluationProvider() / resolveEvaluationProvider() instead. ` +
          `CodeMatch can only be assigned to the "technical_evaluation" workflow step.`,
      );
    default:
      throw new Error(`Unknown provider type: ${row.type}`);
  }
}

/**
 * Construct a technical-evaluation provider instance from a DB row. Kept
 * separate from `buildProvider` so the type system can enforce that
 * evaluation providers (CodeMatch today) are only assigned to the
 * `technical_evaluation` workflow step.
 */
function buildEvaluationProvider(
  row: typeof agentProvidersTable.$inferSelect,
): EvaluationProvider {
  const apiKey = decryptApiKeyOrThrow(row.apiKeyEncryptedPlaceholder, row.name);
  switch (row.type) {
    case "codematch":
      return new CodeMatchProvider(
        row.id,
        row.name,
        apiKey,
        row.config?.codematch ?? null,
      );
    default:
      throw new Error(
        `Provider type "${row.type}" cannot be assigned to the technical_evaluation step. Only CodeMatch is supported today.`,
      );
  }
}

/**
 * Resolve the provider for the optional technical_evaluation step. Returns
 * null when no provider is configured — the engine treats that as "skip the
 * step entirely". There is no native fallback by design (technical evaluation
 * requires a real upstream service).
 */
export async function resolveEvaluationProvider(): Promise<EvaluationProvider | null> {
  try {
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "technical_evaluation"))
      .limit(1);

    if (!setting || !setting.enabled) return null;

    const [providerRow] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, setting.providerId))
      .limit(1);

    if (!providerRow || !providerRow.enabled) {
      logger.warn(
        { step: "technical_evaluation", providerId: setting.providerId },
        "Evaluation provider not found or disabled — skipping technical_evaluation step",
      );
      return null;
    }

    return buildEvaluationProvider(providerRow);
  } catch (err) {
    logger.error(
      { step: "technical_evaluation", err },
      "Failed to resolve evaluation provider — skipping technical_evaluation step",
    );
    return null;
  }
}

/** Build an evaluation provider instance from a row, used by ad-hoc routes. */
export function evaluationProviderFromRow(
  row: typeof agentProvidersTable.$inferSelect,
): EvaluationProvider {
  return buildEvaluationProvider(row);
}

/**
 * Construct a decision-step provider instance from a DB row. Kept separate
 * from `buildProvider` so the type system can enforce that decision providers
 * (Council today) are only assigned to the `decision` workflow step.
 */
function buildDecisionProvider(row: typeof agentProvidersTable.$inferSelect): DecisionProvider {
  const apiKey = decryptApiKeyOrThrow(row.apiKeyEncryptedPlaceholder, row.name);
  switch (row.type) {
    case "council":
      return new CouncilProvider(
        row.id,
        row.name,
        apiKey,
        row.config?.council ?? null,
      );
    default:
      throw new Error(
        `Provider type "${row.type}" cannot be assigned to the decision step. Only Council is supported today.`,
      );
  }
}

/**
 * Resolve the provider for the optional decision step. Returns null when no
 * provider is configured — the engine treats that as "skip the decision step
 * entirely". There is no native fallback by design.
 */
export async function resolveDecisionProvider(): Promise<DecisionProvider | null> {
  try {
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "decision"))
      .limit(1);

    if (!setting || !setting.enabled) return null;

    const [providerRow] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, setting.providerId))
      .limit(1);

    if (!providerRow || !providerRow.enabled) {
      logger.warn(
        { step: "decision", providerId: setting.providerId },
        "Decision provider not found or disabled — skipping decision step",
      );
      return null;
    }

    return buildDecisionProvider(providerRow);
  } catch (err) {
    logger.error({ step: "decision", err }, "Failed to resolve decision provider — skipping decision step");
    return null;
  }
}

/** Build a decision provider instance from a row, used by ad-hoc routes. */
export function decisionProviderFromRow(row: typeof agentProvidersTable.$inferSelect): DecisionProvider {
  return buildDecisionProvider(row);
}

/**
 * Provider types that the engine treats as "real" sourcing for runtime
 * dispatch (vs. the native mock generator). Used by `resolveSourcingProvider`
 * to set the `isTwin` flag.
 */
const REAL_SOURCING_TYPES = new Set([
  "twin_webhook",
  "custom_webhook",
  "github",
  "web_search",
  "apify",
  "twin_agent",
  "extend",
]);

/**
 * Narrower set used to drive the kickoff modal's "auto-default to Real +
 * Run Sourcing on" UX. Restricted to first-class real sourcing providers
 * (`github` and `web_search`) — Twin/custom webhooks remain valid real
 * providers for the engine but aren't safe to silently auto-promote the
 * UI to, since they require manual webhook configuration that may not
 * be wired up correctly in every environment. Recruiters with a Twin
 * webhook can still flip the toggle manually.
 */
const UI_DEFAULT_REAL_SOURCING_TYPES = new Set([
  "github",
  "web_search",
  "apify",
  "twin_agent",
]);

/**
 * Returns true when the sourcing step is configured with an enabled
 * first-class real provider (GitHub Agent or Web Search).
 *
 * Used by the frontend to decide whether to default the workflow kickoff
 * modal to Real + Run Sourcing on, instead of the historical Mock + off
 * defaults. Deliberately narrower than `resolveSourcingProvider`'s
 * `isTwin` check.
 */
export async function hasRealSourcingProvider(): Promise<boolean> {
  try {
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "sourcing"))
      .limit(1);

    if (!setting || !setting.enabled) return false;

    const [providerRow] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, setting.providerId))
      .limit(1);

    if (!providerRow || !providerRow.enabled) return false;
    return UI_DEFAULT_REAL_SOURCING_TYPES.has(providerRow.type);
  } catch (err) {
    logger.error({ err }, "Failed to check for real sourcing provider — assuming none");
    return false;
  }
}

/**
 * Resolve the provider for the sourcing step.
 *
 * Returns the provider AND whether it is a "real" (Twin/custom-webhook) provider.
 * This distinction is used by the engine to enforce data mode rules:
 *   - isTwin=true  → provider can be used for real data runs
 *   - isTwin=false → provider is the native mock generator; skipped in real mode
 *
 * Falls back to NativeOpenAISourcingProvider when no setting is configured.
 */
export async function resolveSourcingProvider(): Promise<{ provider: AgentProvider; isTwin: boolean }> {
  const { NativeOpenAISourcingProvider } = await import("./native-openai-sourcing");
  const nativeFallback = { provider: new NativeOpenAISourcingProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME), isTwin: false };

  try {
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "sourcing"))
      .limit(1);

    if (!setting || !setting.enabled) {
      return nativeFallback;
    }

    const [providerRow] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, setting.providerId))
      .limit(1);

    if (!providerRow || !providerRow.enabled) {
      logger.warn({ step: "sourcing", providerId: setting.providerId }, "Sourcing provider not found or disabled — falling back to native");
      return nativeFallback;
    }

    // twin_webhook, custom_webhook, github and web_search are "real" providers.
    // Single source of truth: REAL_SOURCING_TYPES (shared with hasRealSourcingProvider).
    const isTwin = REAL_SOURCING_TYPES.has(providerRow.type);
    return { provider: buildProvider(providerRow), isTwin };
  } catch (err) {
    logger.error({ step: "sourcing", err }, "Failed to resolve sourcing provider — falling back to native");
    return nativeFallback;
  }
}

/**
 * Resolve the provider for the enrichment step.
 *
 * Unlike other steps, enrichment has NO native fallback. It only runs when an
 * explicit provider is assigned in Settings → Workflow Step Assignments. If no
 * provider is configured, returns null and the engine will skip enrichment.
 *
 * To use native enrichment, explicitly assign a native_openai provider to the
 * enrichment step in the Settings UI.
 */
export async function resolveEnrichmentProvider(): Promise<AgentProvider | null> {
  try {
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "enrichment"))
      .limit(1);

    if (!setting || !setting.enabled) {
      logger.info({ step: "enrichment" }, "No enrichment provider configured — enrichment will be skipped");
      return null;
    }

    const [providerRow] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, setting.providerId))
      .limit(1);

    if (!providerRow || !providerRow.enabled) {
      logger.warn({ step: "enrichment", providerId: setting.providerId }, "Enrichment provider not found or disabled — skipping enrichment");
      return null;
    }

    return buildProvider(providerRow);
  } catch (err) {
    logger.error({ step: "enrichment", err }, "Failed to resolve enrichment provider — skipping enrichment");
    return null;
  }
}

/**
 * Resolve which AgentProvider handles a given workflow step.
 *
 * Used for all steps except sourcing and enrichment (which have dedicated
 * resolvers above due to their special fallback and data-mode logic).
 *
 * Falls back to NativeOpenAIProvider if no setting exists or the configured
 * provider is disabled or missing.
 */
export async function resolveProvider(step: WorkflowStep): Promise<AgentProvider> {
  try {
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, step))
      .limit(1);

    if (!setting || !setting.enabled) {
      return new NativeOpenAIProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME);
    }

    const [providerRow] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, setting.providerId))
      .limit(1);

    if (!providerRow || !providerRow.enabled) {
      logger.warn({ step, providerId: setting.providerId }, "Configured provider not found or disabled — falling back to native");
      return new NativeOpenAIProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME);
    }

    return buildProvider(providerRow);
  } catch (err) {
    logger.error({ step, err }, "Failed to resolve provider — falling back to native");
    return new NativeOpenAIProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME);
  }
}

/**
 * Build a provider instance from a DB row.
 *
 * Used by test-connection routes and admin utilities that need a provider
 * instance without going through the settings lookup.
 */
export function providerFromRow(row: typeof agentProvidersTable.$inferSelect): AgentProvider {
  return buildProvider(row);
}
