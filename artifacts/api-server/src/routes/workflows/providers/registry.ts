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
import { logger } from "../../../lib/logger";

// The fallback native provider used when no custom setting exists
const NATIVE_FALLBACK_ID = -1;
const NATIVE_FALLBACK_NAME = "Native OpenAI (default)";

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
    default:
      throw new Error(`Unknown provider type: ${row.type}`);
  }
}

/**
 * Resolve the provider for the sourcing step specifically.
 * Returns NativeOpenAISourcingProvider as fallback (not NativeOpenAIProvider).
 */
export async function resolveSourcingProvider(): Promise<AgentProvider> {
  const { NativeOpenAISourcingProvider } = await import("./native-openai-sourcing");
  try {
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "sourcing"))
      .limit(1);

    if (!setting || !setting.enabled) {
      return new NativeOpenAISourcingProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME);
    }

    const [providerRow] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, setting.providerId))
      .limit(1);

    if (!providerRow || !providerRow.enabled) {
      logger.warn({ step: "sourcing", providerId: setting.providerId }, "Sourcing provider not found or disabled — falling back to native");
      return new NativeOpenAISourcingProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME);
    }

    // If a custom/twin webhook is assigned, use the generic provider
    return buildProvider(providerRow);
  } catch (err) {
    logger.error({ step: "sourcing", err }, "Failed to resolve sourcing provider — falling back to native");
    return new NativeOpenAISourcingProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME);
  }
}

/**
 * Resolve the provider for the enrichment step specifically.
 * Returns NativeOpenAIEnrichmentProvider as fallback.
 */
export async function resolveEnrichmentProvider(): Promise<AgentProvider> {
  try {
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "enrichment"))
      .limit(1);

    if (!setting || !setting.enabled) {
      return new NativeOpenAIEnrichmentProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME);
    }

    const [providerRow] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, setting.providerId))
      .limit(1);

    if (!providerRow || !providerRow.enabled) {
      logger.warn({ step: "enrichment", providerId: setting.providerId }, "Enrichment provider not found or disabled — falling back to native");
      return new NativeOpenAIEnrichmentProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME);
    }

    return buildProvider(providerRow);
  } catch (err) {
    logger.error({ step: "enrichment", err }, "Failed to resolve enrichment provider — falling back to native");
    return new NativeOpenAIEnrichmentProvider(NATIVE_FALLBACK_ID, NATIVE_FALLBACK_NAME);
  }
}

/**
 * Resolve which AgentProvider should handle a given workflow step.
 * Falls back to the native OpenAI provider if no setting exists or the
 * configured provider is disabled / missing.
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
 * Build a provider instance from a DB row (for test-connection routes).
 */
export function providerFromRow(row: typeof agentProvidersTable.$inferSelect): AgentProvider {
  return buildProvider(row);
}
