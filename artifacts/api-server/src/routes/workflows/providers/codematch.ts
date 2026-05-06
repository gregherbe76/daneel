import type {
  EvaluateInput,
  EvaluationProvider,
  EvaluationResult,
  EvaluationErrorCode,
  TechnicalScores,
} from "./evaluation-interface";
import type { CodeMatchProviderConfig } from "@workspace/db";
import { logger } from "../../../lib/logger";

const DEFAULT_BASE_URL = "https://assess.codes/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = "Daneel/1.0 (CodeMatch provider)";

interface CodeMatchEvaluateResponse {
  scores?: Partial<TechnicalScores>;
  strengths?: unknown;
  red_flags?: unknown;
  summary?: unknown;
  report_url?: unknown;
  evaluated_at?: unknown;
}

/**
 * EvaluationProvider implementation for CodeMatch (https://assess.codes).
 *
 * Calls `POST {baseUrl}/evaluate` with `{ github_username }` and a Bearer
 * token. Maps every documented HTTP status to a stable EvaluationErrorCode
 * so the UI can render specific copy ("Upgrade required", "Rate limited",
 * etc.) rather than a generic failure.
 *
 * Never throws on operational failures — always returns an EvaluationResult.
 */
export class CodeMatchProvider implements EvaluationProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "codematch";
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(
    id: number,
    name: string,
    apiKey: string | undefined,
    config?: CodeMatchProviderConfig | null,
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
      "User-Agent": USER_AGENT,
    };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  async evaluate(input: EvaluateInput): Promise<EvaluationResult> {
    const username = input.candidate.githubUsername?.trim() || null;
    if (!username) {
      return this.empty("no_github_username", input);
    }
    if (!this.apiKey) {
      logger.warn(
        { providerId: this.id, candidateId: input.candidate.id },
        "CodeMatch API key is not set — returning auth_failed",
      );
      return this.empty("auth_failed", input);
    }

    const url = `${this.baseUrl}/evaluate`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ github_username: username }),
        signal: controller.signal,
      });

      const errorCode = mapErrorCode(response.status);
      if (errorCode) {
        if (errorCode === "auth_failed") {
          logger.warn(
            { providerId: this.id, status: response.status },
            "CodeMatch API key invalid",
          );
        } else if (errorCode === "premium_required") {
          logger.info(
            { providerId: this.id, candidateId: input.candidate.id, username },
            "CodeMatch user not Premium",
          );
        } else if (errorCode === "rate_limited") {
          logger.warn(
            { providerId: this.id, candidateId: input.candidate.id },
            "CodeMatch rate limited",
          );
        }
        return this.empty(errorCode, input);
      }

      if (!response.ok) {
        return this.empty("server_error", input);
      }

      const json = (await response.json().catch(() => null)) as
        | CodeMatchEvaluateResponse
        | null;
      if (!json) {
        return this.empty("invalid_response", input);
      }
      return this.parse(json, input);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return this.empty("timeout", input);
      }
      logger.error(
        { providerId: this.id, candidateId: input.candidate.id, err },
        "CodeMatch evaluate failed",
      );
      return this.empty("network_error", input);
    } finally {
      clearTimeout(timer);
    }
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: "API key is not set" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`${this.baseUrl}/evaluate`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ github_username: "torvalds" }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: `Invalid CodeMatch API key (HTTP ${response.status})` };
      }
      if (response.status === 402) {
        return { ok: true, error: "Connected (account upgrade required for production runs)" };
      }
      if (response.status === 429) {
        return { ok: true, error: "Connected (rate limited — try again shortly)" };
      }
      if (response.ok || response.status === 404) {
        return { ok: true, error: "Connected" };
      }
      return { ok: false, error: `CodeMatch unreachable: HTTP ${response.status}` };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return { ok: false, error: "CodeMatch connection timed out after 5s" };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  private empty(code: EvaluationErrorCode, input: EvaluateInput): EvaluationResult {
    return {
      evaluated: false,
      provider_name: this.name,
      provider_type: this.type,
      scores: null,
      strengths: [],
      red_flags: [],
      summary: emptySummary(code, input.candidate.githubUsername),
      evaluated_at: new Date().toISOString(),
      report_url: null,
      error: code,
    };
  }

  private parse(json: CodeMatchEvaluateResponse, input: EvaluateInput): EvaluationResult {
    const scores = parseScores(json.scores);
    if (!scores) {
      logger.warn(
        { providerId: this.id, candidateId: input.candidate.id },
        "CodeMatch returned 200 with malformed scores",
      );
      return this.empty("invalid_response", input);
    }
    return {
      evaluated: true,
      provider_name: this.name,
      provider_type: this.type,
      scores,
      strengths: toStringArray(json.strengths),
      red_flags: toStringArray(json.red_flags),
      summary: typeof json.summary === "string" ? json.summary : "",
      evaluated_at:
        typeof json.evaluated_at === "string" ? json.evaluated_at : new Date().toISOString(),
      report_url: typeof json.report_url === "string" ? json.report_url : null,
      error: null,
    };
  }
}

function mapErrorCode(status: number): EvaluationErrorCode | null {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 402) return "premium_required";
  if (status === 404) return "github_user_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return null;
}

function parseScores(raw: Partial<TechnicalScores> | undefined): TechnicalScores | null {
  if (!raw || typeof raw !== "object") return null;
  const dims = ["technical_depth", "ownership", "consistency", "taste", "impact", "overall"] as const;
  const result = {} as TechnicalScores;
  for (const k of dims) {
    const v = raw[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    result[k] = Math.max(0, Math.min(100, Math.round(v)));
  }
  return result;
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function emptySummary(code: EvaluationErrorCode, username: string | null): string {
  switch (code) {
    case "no_github_username":
      return "No technical evaluation: this candidate has no GitHub username on file.";
    case "auth_failed":
      return "No technical evaluation: CodeMatch API key is invalid or missing.";
    case "premium_required":
      return `No technical evaluation: ${username ?? "this user"} is not on a CodeMatch Premium account.`;
    case "github_user_not_found":
      return `No technical evaluation: GitHub user ${username ?? ""} was not found.`;
    case "rate_limited":
      return "No technical evaluation: CodeMatch rate limit reached for this run.";
    case "timeout":
      return "No technical evaluation: CodeMatch request timed out.";
    case "server_error":
      return "No technical evaluation: CodeMatch returned a server error.";
    case "network_error":
      return "No technical evaluation: network error reaching CodeMatch.";
    case "invalid_response":
      return "No technical evaluation: CodeMatch returned an unexpected payload.";
    default:
      return "No technical evaluation available.";
  }
}
