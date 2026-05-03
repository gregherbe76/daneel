import {
  db,
  agentProvidersTable,
  workflowProviderSettingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AgentProvider, WorkflowStep } from "./interface";
import { NativeOpenAIProvider } from "./native-openai";
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
