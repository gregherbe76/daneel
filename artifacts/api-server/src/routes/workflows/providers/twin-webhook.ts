import { CustomWebhookProvider } from "./custom-webhook";
import type { AgentProviderRunInput } from "./interface";
import type {
  SourcingCandidate,
  SourcingRunResult,
  SourcingStats,
} from "./native-openai-sourcing";
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
    const result = await oneShot.run(augmented);

    // For the sourcing step, normalise the response into { candidates, stats }
    // so the UI can show drop counts (parity with GitHub / web search) even
    // when the upstream Twin returned a bare candidate array or omitted stats.
    if (input.step === "sourcing") {
      return normaliseSourcingResponse(result);
    }
    return result;
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

/**
 * Coerce whatever shape the upstream Twin returned into the contract the
 * engine + UI expect. The Twin is a third-party agent, so we treat its
 * payload defensively: accept either a bare candidate array or
 * { candidates, stats }, validate each row, and synthesise stats when the
 * upstream omitted them so recruiters always see drop counts.
 */
export function normaliseSourcingResponse(raw: unknown): SourcingRunResult {
  let rawCandidates: unknown[] = [];
  let upstreamStats: SourcingStats | undefined;

  if (Array.isArray(raw)) {
    rawCandidates = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as { candidates?: unknown; stats?: unknown };
    if (Array.isArray(obj.candidates)) rawCandidates = obj.candidates;
    if (obj.stats && typeof obj.stats === "object") {
      upstreamStats = obj.stats as SourcingStats;
    }
  }

  // Drop rows missing a name AND any identity URL/email — we cannot dedupe or
  // act on them, so they would otherwise vanish silently from the count.
  const candidates: SourcingCandidate[] = [];
  let droppedInvalid = 0;
  for (const c of rawCandidates) {
    if (!c || typeof c !== "object") {
      droppedInvalid++;
      continue;
    }
    const row = c as Partial<SourcingCandidate>;
    const hasName = typeof row.name === "string" && row.name.trim().length > 0;
    const hasIdentity =
      (typeof row.email === "string" && row.email.trim().length > 0) ||
      (typeof row.linkedinUrl === "string" && row.linkedinUrl.trim().length > 0) ||
      (typeof row.githubUrl === "string" && row.githubUrl.trim().length > 0);
    if (!hasName || !hasIdentity) {
      droppedInvalid++;
      continue;
    }
    candidates.push({
      name: row.name!.trim(),
      headline: row.headline ?? "",
      location: row.location ?? "",
      currentCompany: row.currentCompany ?? "",
      email: row.email ?? null,
      emailSource: row.emailSource ?? (row.email ? "profile" : null),
      linkedinUrl: row.linkedinUrl ?? "",
      githubUrl: row.githubUrl ?? "",
      username: row.username ?? null,
      confidence: row.confidence ?? null,
      skills: Array.isArray(row.skills) ? row.skills : [],
      summary: row.summary ?? "",
      evidence: row.evidence ?? "",
      potentialRisks: row.potentialRisks ?? "",
      source: row.source ?? "Twin Agent",
    });
  }

  // Merge: prefer upstream-provided counts, fall back to what we observed.
  // returnedCount always reflects the post-validation count we actually pass
  // to the engine, regardless of what the Twin claimed.
  const stats: SourcingStats = {
    ...(upstreamStats ?? {}),
    extractedCount: upstreamStats?.extractedCount ?? rawCandidates.length,
    droppedInvalid: (upstreamStats?.droppedInvalid ?? 0) + droppedInvalid,
    returnedCount: candidates.length,
  };

  return { candidates, stats };
}
