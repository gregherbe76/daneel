import { CustomWebhookProvider } from "./custom-webhook";
import type { AgentProviderRunInput } from "./interface";
import { logger } from "../../../lib/logger";

/**
 * TwinWebhookProvider
 *
 * Sends the step payload to an external "Twin" agent endpoint.
 * The twin agent is a separate AI system (e.g. a fine-tuned model,
 * another vendor, or a company-internal AI service) that implements
 * the same step interface as the native provider.
 *
 * Extends CustomWebhookProvider — all HTTP/timeout logic is reused.
 * The difference: twin endpoints receive an additional `twinContext`
 * field with metadata about the source system, enabling the twin
 * to adapt its behaviour per client/deployment.
 */
export class TwinWebhookProvider extends CustomWebhookProvider {
  override readonly type = "twin_webhook";
  private readonly baseUrl: string;

  constructor(id: number, name: string, baseUrl: string, apiKey?: string) {
    // Derive the webhook URL from the baseUrl for twin convention
    const webhookUrl = `${baseUrl.replace(/\/$/, "")}/workflow/step`;
    super(id, name, webhookUrl, apiKey);
    this.baseUrl = baseUrl;
  }

  override async run(input: AgentProviderRunInput): Promise<unknown> {
    // Augment payload with twin context metadata
    const augmented: AgentProviderRunInput = {
      ...input,
      payload: {
        ...input.payload,
        twinContext: {
          sourceSystem: "recruiting-os",
          version: "1.0",
          timestamp: new Date().toISOString(),
        },
      },
    };
    logger.info({ providerId: this.id, step: input.step, runId: input.runId, baseUrl: this.baseUrl }, "Twin webhook dispatching step");
    return super.run(augmented);
  }

  override async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    // Twin providers expose a /health endpoint
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const healthUrl = `${this.baseUrl.replace(/\/$/, "")}/health`;
        const response = await fetch(healthUrl, {
          method: "GET",
          signal: controller.signal,
        });
        if (!response.ok) {
          return { ok: false, error: `Health check returned HTTP ${response.status}` };
        }
        return { ok: true };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      return super.validateConnection(); // Fall back to webhook ping
    }
  }
}
