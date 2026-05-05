import type { AgentProvider, AgentProviderRunInput } from "./interface";
import type {
  SourcingCandidate,
  SourcingRunResult,
  SourcingStats,
} from "./native-openai-sourcing";
import type { TwinAgentProviderConfig } from "@workspace/db";
import { logger } from "../../../lib/logger";
import { normaliseSourcingResponse } from "./twin-webhook";

const DEFAULT_BASE_URL = "https://twin.aplayer.ai";
const REQUEST_TIMEOUT_MS = 90_000;
const VALIDATE_TIMEOUT_MS = 5_000;

/**
 * Thrown when Twin returns HTTP 402 (quota exceeded). The route layer maps
 * this to a structured upgrade-CTA body, mirroring the Council pattern.
 */
export class TwinQuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED" as const;
  readonly upgradeUrl: string | undefined;
  constructor(message: string, upgradeUrl?: string) {
    super(message);
    this.name = "TwinQuotaExceededError";
    this.upgradeUrl = upgradeUrl;
  }
}

type TwinSourcePayload = {
  job: {
    title: string;
    description?: string;
    location?: string;
    seniority?: string;
    mustHaveSkills: string[];
  };
  filters?: { location?: string; seniority?: string };
  count?: number;
};

/**
 * TwinAgentBrowserProvider
 *
 * First-class Daneel sourcing provider that delegates a "let an agent
 * explore" sourcing run to the Twin Agent Browser product. Distinct from
 * the legacy `twin_webhook` provider (which is a generic step-routed
 * webhook re-used by the A-Player Scout connector); this one targets the
 * dedicated Twin sourcing API and supports both sync JSON responses and
 * SSE-streamed partial candidate cards.
 */
export class TwinAgentBrowserProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "twin_agent";
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly streaming: boolean;

  constructor(
    id: number,
    name: string,
    apiKey: string | undefined,
    config?: TwinAgentProviderConfig | null,
  ) {
    this.id = id;
    this.name = name;
    this.apiKey = apiKey && apiKey.trim() ? apiKey.trim() : undefined;
    const cfgUrl = config?.baseUrl?.trim();
    this.baseUrl = (cfgUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.streaming = config?.streaming === true;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: this.streaming ? "text/event-stream" : "application/json",
      "User-Agent": "daneel-twin-agent-browser-provider",
      ...extra,
    };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  /** Public so the Browse-with-Twin route can subscribe to live progress. */
  eventsUrl(remoteRunId: string): string {
    return `${this.baseUrl}/api/sourcing/${encodeURIComponent(remoteRunId)}/events`;
  }

  async run(input: AgentProviderRunInput): Promise<SourcingRunResult> {
    if (input.step !== "sourcing") {
      throw new Error(
        `TwinAgentBrowserProvider only supports the "sourcing" step (got "${input.step}").`,
      );
    }
    if (!this.apiKey) {
      throw new Error(
        'Twin API key is not set on this provider. Paste the key from Twin → Settings into the marketplace card.',
      );
    }

    const payload = input.payload as TwinSourcePayload;
    const url = `${this.baseUrl}/api/sourcing/run`;
    const body = {
      job: payload.job,
      filters: payload.filters ?? {},
      count: payload.count ?? 7,
      runId: input.runId,
      jobId: input.jobId,
      streaming: this.streaming,
    };

    logger.info(
      {
        providerId: this.id,
        runId: input.runId,
        jobId: input.jobId,
        url,
        streaming: this.streaming,
      },
      "Twin Agent Browser sourcing dispatched",
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 402) {
        const text = await response.text().catch(() => "");
        let upgradeUrl: string | undefined;
        try {
          const parsed = JSON.parse(text) as { upgradeUrl?: string };
          upgradeUrl = parsed.upgradeUrl;
        } catch {
          /* body is plain text */
        }
        throw new TwinQuotaExceededError(
          "Twin Agent Browser monthly quota reached. Upgrade Twin Pro for unlimited browsing runs.",
          upgradeUrl,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Twin /api/sourcing/run returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        );
      }

      const raw = this.streaming
        ? await consumeSourcingSseStream(response)
        : await response.json();
      const normalised = normaliseSourcingResponse(raw);
      return tagSourceAsTwinAgent(normalised);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new Error(
          `Twin Agent Browser timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: "Twin API key is not set" };
    }
    const url = `${this.baseUrl}/api/whoami`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.headers({ Accept: "application/json" }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: `Invalid Twin API key (HTTP ${response.status})` };
      }
      if (!response.ok) {
        const fallback = await fetch(this.baseUrl, {
          method: "HEAD",
          signal: controller.signal,
        }).catch(() => null);
        if (fallback && fallback.ok) {
          return { ok: true, error: "Connected (whoami not implemented)" };
        }
        return { ok: false, error: `Twin unreachable: HTTP ${response.status}` };
      }
      const data = (await response.json().catch(() => ({}))) as {
        plan?: string;
        email?: string;
        quotaRemaining?: number;
      };
      const parts = [
        data.plan,
        data.email,
        typeof data.quotaRemaining === "number"
          ? `${data.quotaRemaining} runs remaining`
          : null,
      ].filter(Boolean);
      return { ok: true, error: parts.length > 0 ? parts.join(" — ") : "Connected" };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return { ok: false, error: "Twin connection timed out after 5s" };
      }
      logger.warn({ providerId: this.id, err }, "Twin validateConnection failed");
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Drain a Server-Sent Events response from Twin's sourcing API and assemble
 * a `{ candidates, stats }` payload. Twin emits one of:
 *
 *   event: candidate   data: { ...SourcingCandidate }
 *   event: stats       data: { ...SourcingStats }
 *   event: done        data: { ok: true }
 *   event: error       data: { message: string }
 *
 * We accumulate candidates as they arrive and merge any explicit stats event
 * at the end. If the stream errors out partway through, we still return the
 * candidates we managed to collect so the run isn't a total wipe.
 */
async function consumeSourcingSseStream(
  response: Response,
): Promise<{ candidates: unknown[]; stats?: SourcingStats }> {
  const body = response.body;
  if (!body) {
    throw new Error("Twin streaming response has no body");
  }
  const decoder = new TextDecoder();
  const reader = body.getReader();
  const candidates: unknown[] = [];
  let stats: SourcingStats | undefined;
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const event = parseSseBlock(block);
      if (!event) continue;
      if (event.name === "candidate" && event.data) {
        try {
          candidates.push(JSON.parse(event.data));
        } catch {
          /* skip malformed candidate frame */
        }
      } else if (event.name === "stats" && event.data) {
        try {
          stats = JSON.parse(event.data) as SourcingStats;
        } catch {
          /* skip malformed stats frame */
        }
      } else if (event.name === "error" && event.data) {
        let message = event.data;
        try {
          const parsed = JSON.parse(event.data) as { message?: string };
          if (parsed.message) message = parsed.message;
        } catch {
          /* keep raw */
        }
        throw new Error(`Twin streaming error: ${message}`);
      } else if (event.name === "done") {
        return { candidates, stats };
      }
    }
  }
  return { candidates, stats };
}

function parseSseBlock(block: string): { name: string; data: string } | null {
  const lines = block.split("\n");
  let name = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      name = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  return { name, data: dataLines.join("\n") };
}

/**
 * Re-tag every candidate with `source: "Twin Agent Browser"` so downstream
 * filters and the candidate-detail UI can attribute the row correctly even
 * when the upstream Twin response forgot to set it (or set it to a value
 * that doesn't match Daneel's source vocabulary).
 */
function tagSourceAsTwinAgent(result: SourcingRunResult): SourcingRunResult {
  if (Array.isArray(result)) {
    return result.map(retag);
  }
  return { ...result, candidates: result.candidates.map(retag) };
}

function retag(c: SourcingCandidate): SourcingCandidate {
  return { ...c, source: "Twin Agent Browser" };
}
