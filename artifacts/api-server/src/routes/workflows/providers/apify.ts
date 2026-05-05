import type { AgentProvider, AgentProviderRunInput } from "./interface";
import type {
  SourcingCandidate,
  SourcingRunResult,
  SourcingStats,
} from "./native-openai-sourcing";
import type { ApifyProviderConfig } from "@workspace/db";
import type { JobInsightResult } from "../engine-types";
import {
  extractCandidates,
  type RawSearchResult,
  type ExtractedCandidate,
} from "../../../lib/extract-candidates";
import { logger } from "../../../lib/logger";

const APIFY_BASE = "https://api.apify.com/v2";
const REQUEST_TIMEOUT_MS = 60_000;
const VALIDATE_TIMEOUT_MS = 15_000;

/**
 * Default actor we run when the recruiter hasn't picked one. The Google
 * Search Scraper actor's `organicResults[]` shape lines up cleanly with
 * the SerpAPI/`extractCandidates` pipeline, so the same boolean
 * site:linkedin.com/in / site:github.com query works without a per-actor
 * adapter.
 */
const DEFAULT_ACTOR_ID = "apify/google-search-scraper";
const DEFAULT_TARGET_SITES = ["linkedin.com/in", "github.com"];
const DEFAULT_RESULTS_PER_PAGE = 20;

export type ApifyPayload = {
  job: {
    title: string;
    description?: string;
    location?: string;
    seniority?: string;
    mustHaveSkills: string[];
  };
  insight?: JobInsightResult;
  filters?: { location?: string; seniority?: string };
  count?: number;
};

export type ApifyStats = SourcingStats & {
  /** Total candidates emitted by the LLM extractor (before validation drops). */
  extractedCount?: number;
  /** Dropped because the URL or evidence didn't match a result we sent. */
  droppedFabricated?: number;
  /** Dropped because the row was missing a name or profile URL. */
  droppedNoProfile?: number;
};

type ApifyOrganicResult = {
  title?: string;
  url?: string;
  description?: string;
};

type ApifyDatasetItem = {
  organicResults?: ApifyOrganicResult[];
  // Some actors flatten the result rather than nesting under organicResults —
  // we accept either shape so the most common search-style actors all work.
  title?: string;
  url?: string;
  description?: string;
};

type ApifyUserMeResponse = {
  data?: {
    username?: string;
    plan?: { id?: string; description?: string };
    usageCycle?: { startAt?: string; endAt?: string };
  };
  error?: { type?: string; message?: string };
};

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
}

function sanitizeKeyword(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\s.+#-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class ApifySourcingProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "apify";
  private readonly apiKey: string | undefined;
  private readonly config: ApifyProviderConfig;

  constructor(
    id: number,
    name: string,
    apiKey?: string | null,
    config?: ApifyProviderConfig | null,
  ) {
    this.id = id;
    this.name = name;
    this.config = config ?? {};
    // Server-side `APIFY_TOKEN` env secret takes precedence over a per-provider
    // key persisted on the row, so deployments can rotate the token centrally
    // without touching DB rows.
    const envKey = process.env.APIFY_TOKEN;
    const persisted = apiKey && apiKey.trim() ? apiKey.trim() : undefined;
    this.apiKey = (envKey && envKey.trim() ? envKey.trim() : undefined) ?? persisted;
  }

  /** Returns the actor id (or the default) — handy for tests and logs. */
  get actorId(): string {
    const id = this.config.actorId?.trim();
    return id && id.length > 0 ? id : DEFAULT_ACTOR_ID;
  }

  /**
   * Build the Boolean search query passed to the actor. Pure function over
   * (config, payload) so it can be exercised by tests / preview endpoints
   * without any I/O — same shape as the SerpAPI-backed Web Search provider.
   */
  buildQuery(payload: ApifyPayload): string {
    const job = payload.job;
    const skills = (job.mustHaveSkills ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);

    const seniority = payload.filters?.seniority?.trim() || job.seniority?.trim() || "";
    const rawLoc = payload.filters?.location?.trim() || job.location?.trim() || "";
    const filterLoc = rawLoc.replace(/\([^)]*\)/g, "").split(",")[0].trim();

    const parts: string[] = [];

    const role = sanitizeKeyword(job.title);
    if (role) parts.push(quoteIfNeeded(role));
    const cleanSeniority = sanitizeKeyword(seniority);
    if (cleanSeniority) parts.push(quoteIfNeeded(cleanSeniority));

    for (const s of skills) {
      const cleaned = sanitizeKeyword(s);
      if (cleaned) parts.push(quoteIfNeeded(cleaned));
    }

    const extra = sanitizeKeyword(this.config.extraKeywords ?? "");
    if (extra) parts.push(extra);

    if (filterLoc) parts.push(quoteIfNeeded(filterLoc));

    const targetSites = (this.config.targetSites && this.config.targetSites.length > 0
      ? this.config.targetSites
      : DEFAULT_TARGET_SITES
    )
      .map((s) => s.trim())
      .filter(Boolean);
    if (targetSites.length === 1) {
      parts.push(`site:${targetSites[0]}`);
    } else if (targetSites.length > 1) {
      parts.push(`(${targetSites.map((s) => `site:${s}`).join(" OR ")})`);
    }

    const excludeSites = (this.config.excludeSites ?? [])
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of excludeSites) parts.push(`-site:${s}`);

    return parts.join(" ");
  }

  /**
   * Fire an Apify actor synchronously and pull back its dataset items.
   * Returns the flattened organic results so the caller can pipe them
   * through the shared `extractCandidates` extractor — same contract the
   * Web Search provider uses for SerpAPI organic results.
   */
  async runActor(query: string): Promise<{ results: RawSearchResult[]; totalResults: number | null }> {
    if (!this.apiKey) {
      throw new Error(
        "Apify token is not configured — save the token from Settings → Marketplace or set APIFY_TOKEN as a project secret.",
      );
    }
    const resultsPerPage = Math.max(
      1,
      Math.min(100, Math.floor(this.config.resultsPerPage ?? DEFAULT_RESULTS_PER_PAGE)),
    );
    const url = `${APIFY_BASE}/acts/${encodeURIComponent(this.actorId)}/run-sync-get-dataset-items`;
    const body = {
      queries: query,
      maxPagesPerQuery: 1,
      resultsPerPage,
      mobileResults: false,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "recruiting-os-apify-agent",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Apify actor ${this.actorId} HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        );
      }
      const items = (await response.json()) as ApifyDatasetItem[] | unknown;
      if (!Array.isArray(items)) {
        throw new Error(
          `Apify actor ${this.actorId} returned a non-array dataset payload — incompatible actor output shape`,
        );
      }
      const results: RawSearchResult[] = [];
      for (const item of items as ApifyDatasetItem[]) {
        const organic = Array.isArray(item.organicResults) ? item.organicResults : [];
        if (organic.length > 0) {
          for (const r of organic) {
            if (!r.url || !r.title) continue;
            results.push({
              title: r.title,
              link: r.url,
              snippet: r.description ?? "",
            });
          }
        } else if (item.url && item.title) {
          // Flat-shaped dataset items (one row per result) — common with
          // single-purpose scraper actors.
          results.push({
            title: item.title,
            link: item.url,
            snippet: item.description ?? "",
          });
        }
      }
      // Apify doesn't surface a true "total matches" count — use the
      // returned row count so the funnel stats still render meaningfully.
      return { results, totalResults: results.length };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new Error(`Apify actor ${this.actorId} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async run(input: AgentProviderRunInput): Promise<SourcingRunResult> {
    const payload = input.payload as ApifyPayload;
    const query = this.buildQuery(payload);

    logger.info(
      {
        providerId: this.id,
        runId: input.runId,
        jobId: input.jobId,
        actorId: this.actorId,
        query,
        hasKey: !!this.apiKey,
      },
      "Apify sourcing dispatched",
    );

    const { results, totalResults } = await this.runActor(query);

    if (results.length === 0) {
      const stats: ApifyStats = {
        searchTotalCount: totalResults ?? 0,
        consideredCount: 0,
        extractedCount: 0,
        droppedNoProfile: 0,
        droppedFabricated: 0,
        returnedCount: 0,
      };
      logger.info(
        { providerId: this.id, runId: input.runId, ...stats },
        "Apify sourcing returned no results",
      );
      return { candidates: [], stats };
    }

    const { candidates: extracted, stats: extractorStats } = await extractCandidates({ results });

    const mapped: SourcingCandidate[] = [];
    let droppedNoProfile = 0;
    for (const c of extracted) {
      if (!c.name || !c.profileUrl) {
        droppedNoProfile++;
        continue;
      }
      mapped.push(toSourcingCandidate(c));
    }

    const stats: ApifyStats = {
      searchTotalCount: totalResults ?? results.length,
      consideredCount: extractorStats.classifiedCount,
      extractedCount: extracted.length,
      droppedNoProfile,
      droppedFabricated:
        extractorStats.droppedFabricatedUrl + extractorStats.droppedFabricatedEvidence,
      returnedCount: mapped.length,
    };

    logger.info(
      { providerId: this.id, runId: input.runId, actorId: this.actorId, ...stats },
      "Apify sourcing completed",
    );
    return { candidates: mapped, stats };
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: "Apify token is not set" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
    try {
      const response = await fetch(`${APIFY_BASE}/users/me`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          "User-Agent": "recruiting-os-apify-agent",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          ok: false,
          error: `Apify HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ""}`,
        };
      }
      const data = (await response.json()) as ApifyUserMeResponse;
      if (data.error) return { ok: false, error: data.error.message ?? data.error.type ?? "Apify error" };
      const username = data.data?.username ?? "";
      const plan = data.data?.plan?.description ?? data.data?.plan?.id ?? "";
      return {
        ok: true,
        error: `Authenticated as ${username || "(unknown user)"}${plan ? ` on ${plan}` : ""} — actor: ${this.actorId}`,
      };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return {
          ok: false,
          error: `Apify connection check timed out after ${VALIDATE_TIMEOUT_MS / 1000}s`,
        };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toSourcingCandidate(c: ExtractedCandidate): SourcingCandidate {
  // Mirrors web-search.ts: linkedin/website hits route through linkedinUrl
  // (the durable identity field used for dedup), github hits go to githubUrl.
  const confidence = c.sourceType === "website" ? 0.5 : 0.85;
  const linkedinUrl =
    c.sourceType === "linkedin" || c.sourceType === "website" ? c.profileUrl : "";
  const githubUrl = c.sourceType === "github" ? c.profileUrl : "";
  let username: string | null = null;
  if (c.sourceType === "github") {
    try {
      const u = new URL(c.profileUrl);
      const seg = u.pathname.split("/").filter(Boolean);
      if (seg.length > 0) username = seg[0];
    } catch {
      username = null;
    }
  }
  return {
    name: c.name,
    headline: c.headline ?? "",
    location: c.location ?? "",
    currentCompany: c.currentCompany ?? "",
    email: null,
    emailSource: null,
    linkedinUrl,
    githubUrl,
    username,
    confidence,
    skills: [],
    summary: c.headline ?? "",
    evidence: `${c.profileUrl}\n${c.evidence}`,
    potentialRisks: "",
    source: "Apify",
  };
}
