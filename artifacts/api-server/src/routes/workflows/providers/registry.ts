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
import { logger } from "../../../lib/logger";

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
  switch (row.type) {
    case "native_openai":
      return new NativeOpenAIProvider(row.id, row.name);
    case "custom_webhook":
      if (!row.webhookUrl) throw new Error(`Provider "${row.name}" is missing webhookUrl`);
      return new CustomWebhookProvider(row.id, row.name, row.webhookUrl, row.apiKeyEncryptedPlaceholder ?? undefined);
    case "twin_webhook":
      if (!row.baseUrl) throw new Error(`Provider "${row.name}" is missing baseUrl`);
      return new TwinWebhookProvider(row.id, row.name, row.baseUrl, row.apiKeyEncryptedPlaceholder ?? undefined);
    case "github":
      return new GithubSourcingProvider(row.id, row.name, row.config?.github ?? null);
    default:
      throw new Error(`Unknown provider type: ${row.type}`);
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

    // twin_webhook, custom_webhook and github are considered "real" providers
    const isTwin =
      providerRow.type === "twin_webhook" ||
      providerRow.type === "custom_webhook" ||
      providerRow.type === "github";
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
