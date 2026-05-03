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
 * Step-specific routing:
 *   sourcing   → POST {baseUrl}/workflow/sourcing
 *   enrichment → POST {baseUrl}/workflow/enrichment
 *   all others → POST {baseUrl}/workflow/step
 */
export class TwinWebhookProvider extends CustomWebhookProvider {
  override readonly type = "twin_webhook";
  private readonly baseUrl: string;
  private readonly apiKeyForTwin?: string;

  constructor(id: number, name: string, baseUrl: string, apiKey?: string) {
    // Default webhook URL; overridden per-step in run()
    const webhookUrl = `${baseUrl.replace(/\/$/, "")}/workflow/step`;
    super(id, name, webhookUrl, apiKey);
    this.baseUrl = baseUrl;
    this.apiKeyForTwin = apiKey;
  }

  /** Resolve the correct Twin endpoint URL for a given step. */
  private stepUrl(step: string): string {
    const base = this.baseUrl.replace(/\/$/, "");
    if (step === "sourcing") return `${base}/workflow/sourcing`;
    if (step === "enrichment") return `${base}/workflow/enrichment`;
    return `${base}/workflow/step`;
  }

  override async run(input: AgentProviderRunInput): Promise<unknown> {
    const url = this.stepUrl(input.step);

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

    logger.info(
      { providerId: this.id, step: input.step, runId: input.runId, url },
      "Twin webhook dispatching step",
    );

    // Temporarily swap the parent's webhook URL by creating a one-shot provider
    const oneShot = new CustomWebhookProvider(this.id, this.name, url, this.apiKeyForTwin);
    return oneShot.run(augmented);
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
