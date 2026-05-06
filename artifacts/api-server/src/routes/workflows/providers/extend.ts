import type { AgentProvider, AgentProviderRunInput } from "./interface";
import type {
  SourcingCandidate,
  SourcingRunResult,
  SourcingStats,
} from "./native-openai-sourcing";
import type { ExtendProviderConfig } from "@workspace/db";
import { logger } from "../../../lib/logger";

const DEFAULT_BASE_URL = "https://extend.aplayer.ai/api/v1";
const REQUEST_TIMEOUT_MS = 8_000;
const VALIDATE_TIMEOUT_MS = 8_000;
const POLL_INITIAL_DELAY_MS = 30_000;
const POLL_INTERVAL_MS = 10_000;
const POLL_TOTAL_TIMEOUT_MS = 12 * 60 * 1000;
const USER_AGENT = "Daneel/1.0 (Extend provider)";
const MAX_PROFILE_URLS = 10;
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MIN_RESULTS = 3;

export type ExtendErrorCode =
  | "no_profile_urls"
  | "auth_failed"
  | "premium_required"
  | "linkedin_cookie_required"
  | "extend_timeout"
  | "pipeline_failed"
  | "server_error"
  | "network_error"
  | "invalid_response";

interface ExtendCandidate {
  name?: string;
  linkedinUrl?: string;
  score?: number;
  scoreReason?: string | string[];
  hiringSignal?: string;
}

interface ExtendStartResponse {
  analysis_id?: string;
  status?: string;
  poll_url?: string;
}

interface ExtendPollResponse {
  status?: "running" | "completed" | "failed";
  candidates?: ExtendCandidate[];
  total_found?: number;
  below_minimum?: boolean;
  pattern?: { title?: string };
  error?: string;
}

export type ExtendSourcingPayload = {
  job: {
    title: string;
    description?: string;
    location?: string;
    seniority?: string;
    mustHaveSkills: string[];
    exampleProfileUrls?: string[] | null;
  };
};

/**
 * Hooks injected for unit-testability — production code should never pass
 * overrides. Tests pass a no-op `sleep` so polling doesn't burn real time.
 */
export interface ExtendProviderHooks {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * ExtendSourcingProvider
 *
 * Sourcing provider that delegates pattern-matching from example LinkedIn
 * profiles to Extend (https://extend.aplayer.ai). Async by design:
 *   1. POST /v1/find-similar → 202 with analysis_id
 *   2. Wait 30s (Extend pipeline is 60-150s on average)
 *   3. Poll GET /v1/find-similar/:id every 10s until completed/failed
 *   4. Total polling budget: 12 min (Extend's server watchdog is 10 min)
 *
 * Each Daneel job must declare 1-10 example profile URLs in
 * `jobs.exampleProfileUrls`. Without seed profiles, the provider returns
 * `{ candidates: [], stats: { error: "no_profile_urls" } }` so the
 * recruiter sees a clear failure rather than a silent empty run.
 */
export class ExtendSourcingProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "extend";
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    id: number,
    name: string,
    apiKey: string | undefined,
    config?: ExtendProviderConfig | null,
    hooks?: ExtendProviderHooks,
  ) {
    this.id = id;
    this.name = name;
    this.apiKey = apiKey && apiKey.trim() ? apiKey.trim() : undefined;
    const cfgUrl = config?.baseUrl?.trim();
    this.baseUrl = (cfgUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.sleep = hooks?.sleep ?? defaultSleep;
    this.now = hooks?.now ?? (() => Date.now());
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

  async run(input: AgentProviderRunInput): Promise<SourcingRunResult> {
    if (input.step !== "sourcing") {
      throw new Error(
        `ExtendSourcingProvider only supports the "sourcing" step (got "${input.step}").`,
      );
    }

    const payload = input.payload as ExtendSourcingPayload;
    const job = payload.job;
    const rawProfileUrls = Array.isArray(job.exampleProfileUrls)
      ? job.exampleProfileUrls.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      : [];

    if (rawProfileUrls.length === 0) {
      logger.warn(
        { providerId: this.id, runId: input.runId, jobId: input.jobId },
        "Extend sourcing skipped: job has no exampleProfileUrls",
      );
      return this.empty("no_profile_urls");
    }

    if (!this.apiKey) {
      logger.warn(
        { providerId: this.id, runId: input.runId, jobId: input.jobId },
        "Extend API key is not set",
      );
      return this.empty("auth_failed");
    }

    const profileUrls = rawProfileUrls.slice(0, MAX_PROFILE_URLS);
    const startedAt = this.now();

    let analysisId: string;
    try {
      analysisId = await this.startAnalysis(profileUrls, job, input);
    } catch (err) {
      const code = (err as { extendCode?: ExtendErrorCode })?.extendCode ?? "network_error";
      logger.error(
        { providerId: this.id, runId: input.runId, jobId: input.jobId, err },
        "Extend find-similar start failed",
      );
      return this.empty(code);
    }

    let pollResult: ExtendPollResponse;
    try {
      pollResult = await this.pollUntilDone(analysisId, startedAt);
    } catch (err) {
      const code = (err as { extendCode?: ExtendErrorCode })?.extendCode ?? "network_error";
      logger.error(
        { providerId: this.id, analysisId, err },
        "Extend polling failed",
      );
      return this.emptyWithAnalysis(code, analysisId, this.now() - startedAt);
    }

    const mapped = this.mapCandidates(pollResult.candidates ?? [], job);
    const stats: SourcingStats = {
      // SourcingStats has GitHub-style filter counters; we surface Extend's
      // own analysis metadata via custom keys so the run timeline shows
      // what happened upstream without polluting the typed fields.
      returnedCount: mapped.length,
      ...({
        extend_analysis_id: analysisId,
        extend_pattern_title: pollResult.pattern?.title ?? null,
        extend_total_found: pollResult.total_found ?? mapped.length,
        extend_below_minimum: pollResult.below_minimum ?? false,
        extend_polling_duration_ms: this.now() - startedAt,
      } as Record<string, unknown>),
    } as SourcingStats;

    logger.info(
      {
        providerId: this.id,
        analysisId,
        candidates: mapped.length,
        durationMs: this.now() - startedAt,
      },
      "Extend sourcing completed",
    );

    return { candidates: mapped, stats };
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: "Extend API key is not set" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}/me`, {
        method: "GET",
        headers: this.headers(),
        signal: controller.signal,
      });
      if (response.status === 200) {
        return { ok: true, error: "Connected" };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: `Invalid Extend API key (HTTP ${response.status})` };
      }
      if (response.status === 402) {
        return { ok: false, error: "Extend account upgrade required (Premium)" };
      }
      if (response.status >= 500) {
        return { ok: false, error: `Extend API unreachable (HTTP ${response.status})` };
      }
      return { ok: false, error: `Extend returned HTTP ${response.status}` };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return {
          ok: false,
          error: `Extend connection timed out after ${Math.round(VALIDATE_TIMEOUT_MS / 1000)}s`,
        };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async startAnalysis(
    profileUrls: string[],
    job: ExtendSourcingPayload["job"],
    input: AgentProviderRunInput,
  ): Promise<string> {
    const body = {
      profile_urls: profileUrls,
      job_context: job.description?.trim() ? job.description : undefined,
      search_location: job.location?.trim() ? job.location : undefined,
      max_results: DEFAULT_MAX_RESULTS,
      min_results: DEFAULT_MIN_RESULTS,
      scoring_criteria: job.mustHaveSkills.length > 0 ? job.mustHaveSkills : undefined,
    };
    const url = `${this.baseUrl}/find-similar`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    logger.info(
      {
        providerId: this.id,
        runId: input.runId,
        jobId: input.jobId,
        profileUrlCount: profileUrls.length,
      },
      "Extend find-similar dispatched",
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const code = mapStartErrorCode(response.status);
      if (code) {
        const err = new Error(`Extend POST /find-similar returned ${response.status}`) as Error & {
          extendCode: ExtendErrorCode;
        };
        err.extendCode = code;
        throw err;
      }
      if (response.status !== 202 && !response.ok) {
        const err = new Error(`Extend POST /find-similar returned ${response.status}`) as Error & {
          extendCode: ExtendErrorCode;
        };
        err.extendCode = "server_error";
        throw err;
      }
      const json = (await response.json().catch(() => null)) as ExtendStartResponse | null;
      if (!json || typeof json.analysis_id !== "string" || !json.analysis_id) {
        const err = new Error("Extend POST /find-similar returned no analysis_id") as Error & {
          extendCode: ExtendErrorCode;
        };
        err.extendCode = "invalid_response";
        throw err;
      }
      return json.analysis_id;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        const e = new Error(`Extend POST /find-similar timed out after ${REQUEST_TIMEOUT_MS / 1000}s`) as Error & {
          extendCode: ExtendErrorCode;
        };
        e.extendCode = "extend_timeout";
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async pollUntilDone(
    analysisId: string,
    startedAt: number,
  ): Promise<ExtendPollResponse> {
    await this.sleep(POLL_INITIAL_DELAY_MS);

    while (true) {
      const elapsed = this.now() - startedAt;
      if (elapsed >= POLL_TOTAL_TIMEOUT_MS) {
        const err = new Error(
          `Extend polling exceeded ${Math.round(POLL_TOTAL_TIMEOUT_MS / 1000)}s budget`,
        ) as Error & { extendCode: ExtendErrorCode };
        err.extendCode = "extend_timeout";
        throw err;
      }

      const url = `${this.baseUrl}/find-similar/${encodeURIComponent(analysisId)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: this.headers(),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if ((err as Error)?.name === "AbortError") {
          // Single poll request timed out — keep going until the global
          // budget is exhausted; transient gateway hiccups shouldn't kill
          // a 12-minute run.
          await this.sleep(POLL_INTERVAL_MS);
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401 || response.status === 403) {
        const err = new Error(`Extend GET /find-similar/:id returned ${response.status}`) as Error & {
          extendCode: ExtendErrorCode;
        };
        err.extendCode = "auth_failed";
        throw err;
      }
      if (!response.ok) {
        // Non-fatal poll failure → wait and retry within the budget.
        await this.sleep(POLL_INTERVAL_MS);
        continue;
      }

      const json = (await response.json().catch(() => null)) as ExtendPollResponse | null;
      if (!json) {
        await this.sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (json.status === "completed") {
        return json;
      }
      if (json.status === "failed") {
        const err = new Error(json.error || "Extend pipeline reported failure") as Error & {
          extendCode: ExtendErrorCode;
        };
        err.extendCode = "pipeline_failed";
        throw err;
      }

      await this.sleep(POLL_INTERVAL_MS);
    }
  }

  private mapCandidates(
    raw: ExtendCandidate[],
    job: ExtendSourcingPayload["job"],
  ): SourcingCandidate[] {
    const out: SourcingCandidate[] = [];
    for (const c of raw) {
      const name = typeof c.name === "string" ? c.name.trim() : "";
      const linkedinUrl = typeof c.linkedinUrl === "string" ? c.linkedinUrl.trim() : "";
      if (!name || !linkedinUrl) continue;
      const score = typeof c.score === "number" && Number.isFinite(c.score) ? c.score : null;
      const confidence = score !== null ? Math.max(0, Math.min(1, score / 10)) : null;
      const summary = Array.isArray(c.scoreReason)
        ? c.scoreReason.filter((s): s is string => typeof s === "string").join("\n")
        : typeof c.scoreReason === "string"
          ? c.scoreReason
          : "";
      out.push({
        name,
        headline: "",
        location: job.location ?? "",
        currentCompany: "",
        email: null,
        linkedinUrl,
        githubUrl: "",
        username: null,
        confidence,
        emailSource: null,
        skills: [],
        summary,
        evidence: linkedinUrl,
        potentialRisks: "",
        source: "Extend pattern-match",
      });
    }
    return out;
  }

  private empty(code: ExtendErrorCode): SourcingRunResult {
    return {
      candidates: [],
      stats: {
        returnedCount: 0,
        ...({ extend_error: code } as Record<string, unknown>),
      } as SourcingStats,
    };
  }

  private emptyWithAnalysis(
    code: ExtendErrorCode,
    analysisId: string,
    durationMs: number,
  ): SourcingRunResult {
    return {
      candidates: [],
      stats: {
        returnedCount: 0,
        ...({
          extend_error: code,
          extend_analysis_id: analysisId,
          extend_polling_duration_ms: durationMs,
        } as Record<string, unknown>),
      } as SourcingStats,
    };
  }
}

function mapStartErrorCode(status: number): ExtendErrorCode | null {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 402) return "premium_required";
  if (status === 412 || status === 428) return "linkedin_cookie_required";
  if (status === 429) return "server_error";
  if (status >= 500) return "server_error";
  return null;
}
