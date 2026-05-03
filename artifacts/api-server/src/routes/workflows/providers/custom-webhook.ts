import type { AgentProvider, AgentProviderRunInput } from "./interface";
import { logger } from "../../../lib/logger";

const WEBHOOK_TIMEOUT_MS = 30_000;

export class CustomWebhookProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type: string = "custom_webhook";
  private readonly webhookUrl: string;
  private readonly apiKey?: string;

  constructor(id: number, name: string, webhookUrl: string, apiKey?: string) {
    this.id = id;
    this.name = name;
    this.webhookUrl = webhookUrl;
    this.apiKey = apiKey;
  }

  async run(input: AgentProviderRunInput): Promise<unknown> {
    const body = {
      step: input.step,
      runId: input.runId,
      jobId: input.jobId,
      payload: input.payload,
      schema: this.getExpectedSchema(input.step),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Recruiting-OS-Step": input.step,
        "X-Recruiting-OS-Run-Id": String(input.runId),
      };
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        throw new Error(`Webhook returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      logger.info({ providerId: this.id, step: input.step, runId: input.runId }, "Webhook provider step completed");
      return result;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new Error(`Webhook timed out after ${WEBHOOK_TIMEOUT_MS / 1000}s for step: ${input.step}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Recruiting-OS-Ping": "true",
        };
        if (this.apiKey) {
          headers["Authorization"] = `Bearer ${this.apiKey}`;
        }
        const response = await fetch(this.webhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ ping: true }),
          signal: controller.signal,
        });
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}` };
        }
        return { ok: true };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      const msg = (err as Error)?.name === "AbortError"
        ? "Connection timed out after 5s"
        : (err instanceof Error ? err.message : String(err));
      return { ok: false, error: msg };
    }
  }

  private getExpectedSchema(step: string): Record<string, unknown> {
    const schemas: Record<string, unknown> = {
      job_understanding: {
        mustHaveSkills: ["string"],
        seniority: "string",
        evaluationCriteria: ["string"],
        idealCandidateProfile: "string",
      },
      candidate_matching: {
        results: [{ candidateId: "number", score: "number 0-100", strengths: ["string"], gaps: ["string"], risks: ["string"], recommendation: "Strong Yes | Yes | Maybe | No" }],
      },
      shortlist_generation: {
        summaries: [{ candidateId: "number", candidateName: "string", whyRelevant: "string", keyRisks: "string", finalRecommendation: "string" }],
      },
    };
    return (schemas[step] ?? {}) as Record<string, unknown>;
  }
}
