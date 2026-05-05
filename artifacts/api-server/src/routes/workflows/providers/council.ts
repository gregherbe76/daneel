import type {
  DecisionProvider,
  DeliberateInput,
  DeliberationResult,
} from "./decision-interface";
import { DecisionQuotaExceededError } from "./decision-interface";
import type { CouncilProviderConfig } from "@workspace/db";
import { logger } from "../../../lib/logger";

const DEFAULT_BASE_URL = "https://council.replit.app";
const REQUEST_TIMEOUT_MS = 60_000;

type CouncilDeliberateResponse = Partial<DeliberationResult> & {
  // Council may emit either { result: {...} } or the result inline. We
  // accept both; the parser below normalises.
  result?: Partial<DeliberationResult>;
};

export class CouncilProvider implements DecisionProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "council";
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(
    id: number,
    name: string,
    apiKey: string | undefined,
    config?: CouncilProviderConfig | null,
  ) {
    this.id = id;
    this.name = name;
    this.apiKey = apiKey && apiKey.trim() ? apiKey.trim() : undefined;
    const cfgUrl = config?.baseUrl?.trim();
    this.baseUrl = (cfgUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "daneel-council-decision-provider",
    };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  /**
   * Public so the deliberations route can stream Council's pole-activation
   * events through to the browser when available.
   */
  eventsUrl(remoteDeliberationId: string): string {
    return `${this.baseUrl}/api/deliberate/${encodeURIComponent(remoteDeliberationId)}/events`;
  }

  get baseUrlForLogs(): string {
    return this.baseUrl;
  }

  async deliberate(input: DeliberateInput): Promise<DeliberationResult> {
    if (!this.apiKey) {
      throw new Error(
        "Council API key is not set on this provider. Paste the key from Council → Settings into the provider config.",
      );
    }
    const url = `${this.baseUrl}/api/deliberate`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          candidate: input.candidate,
          jd: input.jd,
          stage: input.stage,
        }),
        signal: controller.signal,
      });

      if (response.status === 402) {
        const body = await response.text().catch(() => "");
        let upgradeUrl: string | undefined;
        try {
          const parsed = JSON.parse(body) as { upgradeUrl?: string; message?: string };
          upgradeUrl = parsed.upgradeUrl;
        } catch {
          /* body is plain text */
        }
        throw new DecisionQuotaExceededError(
          "Council monthly deliberation quota reached. Upgrade Council Pro ($79/mo) for unlimited.",
          upgradeUrl,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Council /api/deliberate returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        );
      }

      const json = (await response.json()) as CouncilDeliberateResponse;
      return parseDeliberationResult(json);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new Error(`Council /api/deliberate timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: "API key is not set" };
    }
    const url = `${this.baseUrl}/api/whoami`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url, { method: "GET", headers: this.headers(), signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: `Invalid Council API key (HTTP ${response.status})` };
      }
      if (!response.ok) {
        // Council may not yet expose /api/whoami — fall back to a HEAD on the
        // base URL so a 404 on the health endpoint isn't reported as a hard fail.
        const fallback = await fetch(this.baseUrl, { method: "HEAD", signal: controller.signal }).catch(() => null);
        if (fallback && fallback.ok) return { ok: true, error: "Connected (whoami not implemented)" };
        return { ok: false, error: `Council unreachable: HTTP ${response.status}` };
      }
      const data = (await response.json().catch(() => ({}))) as { plan?: string; email?: string };
      const suffix = [data.plan, data.email].filter(Boolean).join(" — ");
      return { ok: true, error: suffix || "Connected" };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return { ok: false, error: "Council connection timed out after 5s" };
      }
      logger.warn({ providerId: this.id, err }, "Council validateConnection failed");
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Defensive parser. Council's contract is the source of truth, but we coerce
 * every field to the shape downstream code expects so a partial response from
 * an older Council build doesn't break the boardroom UI.
 */
function parseDeliberationResult(raw: CouncilDeliberateResponse): DeliberationResult {
  const root = (raw.result ?? raw) as Partial<DeliberationResult>;
  const convergence = root.convergence ?? { summary: "", verdict: "" };
  const divergence = root.divergence ?? { summary: "", axes: [] };
  return {
    convergence: {
      summary: typeof convergence.summary === "string" ? convergence.summary : "",
      verdict: typeof convergence.verdict === "string" ? convergence.verdict : "",
    },
    divergence: {
      summary: typeof divergence.summary === "string" ? divergence.summary : "",
      axes: Array.isArray(divergence.axes) ? divergence.axes.filter((a): a is string => typeof a === "string") : [],
    },
    orientations: Array.isArray(root.orientations)
      ? root.orientations
          .map((o) => ({
            title: typeof o?.title === "string" ? o.title : "",
            detail: typeof o?.detail === "string" ? o.detail : "",
          }))
          .filter((o) => o.title || o.detail)
      : [],
    poles: Array.isArray(root.poles)
      ? root.poles.map((p, idx) => ({
          id: typeof p?.id === "string" ? p.id : `pole-${idx}`,
          name: typeof p?.name === "string" ? p.name : `Pole ${idx + 1}`,
          verdict: typeof p?.verdict === "string" ? p.verdict : "",
          signal: typeof p?.signal === "number" ? p.signal : 0,
          reasoning: typeof p?.reasoning === "string" ? p.reasoning : "",
        }))
      : [],
  };
}

export { DecisionQuotaExceededError };
