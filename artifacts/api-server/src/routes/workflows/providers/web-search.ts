import type { AgentProvider, AgentProviderRunInput } from "./interface";
import type {
  SourcingCandidate,
  SourcingRunResult,
  SourcingStats,
} from "./native-openai-sourcing";
import type { WebSearchProviderConfig } from "@workspace/db";
import type { JobInsightResult } from "../engine-types";
import { extractCandidates, type RawSearchResult, type ExtractedCandidate } from "../../../lib/extract-candidates";
import { logger } from "../../../lib/logger";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const SERPAPI_ACCOUNT_ENDPOINT = "https://serpapi.com/account.json";
const REQUEST_TIMEOUT_MS = 15_000;

/** Default sites to focus the search on when the recruiter hasn't customised. */
const DEFAULT_TARGET_SITES = ["linkedin.com/in", "github.com"];

export type WebSearchPayload = {
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

/** Per-run summary stats specific to the web-search provider. */
export type WebSearchStats = SourcingStats & {
  /** Total candidates emitted by the LLM extractor (before validation drops). */
  extractedCount?: number;
  /** Dropped because the URL or evidence didn't match a result we sent. */
  droppedFabricated?: number;
  /** Dropped because the row was missing a name or profile URL. */
  droppedNoProfile?: number;
};

type SerpApiOrganicResult = {
  title?: string;
  link?: string;
  snippet?: string;
};

type SerpApiResponse = {
  organic_results?: SerpApiOrganicResult[];
  search_information?: { total_results?: number };
  error?: string;
};

type SerpApiAccountResponse = {
  searches_per_month?: number;
  this_month_usage?: number;
  plan_name?: string;
  account_email?: string;
  error?: string;
};

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
}

function sanitizeKeyword(value: string): string {
  return value.replace(/[^\p{L}\p{N}\s.+#-]/gu, " ").replace(/\s+/g, " ").trim();
}

export class WebSearchSourcingProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "web_search";
  private readonly apiKey: string | undefined;
  private readonly config: WebSearchProviderConfig;

  constructor(id: number, name: string, config?: WebSearchProviderConfig | null) {
    this.id = id;
    this.name = name;
    this.config = config ?? {};
    const k = process.env.SERPAPI_KEY;
    this.apiKey = k && k.trim() ? k.trim() : undefined;
  }

  /**
   * Build the Google query string. Pure function over (config, payload) so it
   * can be exercised by tests / preview endpoints without any I/O.
   */
  buildQuery(payload: WebSearchPayload): string {
    const job = payload.job;
    const skills = (job.mustHaveSkills ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);

    const seniority = payload.filters?.seniority?.trim() || job.seniority?.trim() || "";
    const rawLoc = payload.filters?.location?.trim() || job.location?.trim() || "";
    const filterLoc = rawLoc.replace(/\([^)]*\)/g, "").split(",")[0].trim();

    const parts: string[] = [];

    // Role + seniority as quoted free-text terms.
    const role = sanitizeKeyword(job.title);
    if (role) parts.push(quoteIfNeeded(role));
    const cleanSeniority = sanitizeKeyword(seniority);
    if (cleanSeniority) parts.push(quoteIfNeeded(cleanSeniority));

    // Must-have skills — quoted so multi-word skills stay together.
    for (const s of skills) {
      const cleaned = sanitizeKeyword(s);
      if (cleaned) parts.push(quoteIfNeeded(cleaned));
    }

    // Recruiter-tunable extra keywords.
    const extra = sanitizeKeyword(this.config.extraKeywords ?? "");
    if (extra) parts.push(extra);

    if (filterLoc) parts.push(quoteIfNeeded(filterLoc));

    // Target sites — wrap in parens with OR so any of them satisfies the filter.
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

    // Exclude sites — `-site:` operator per entry.
    const excludeSites = (this.config.excludeSites ?? [])
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of excludeSites) parts.push(`-site:${s}`);

    return parts.join(" ");
  }

  /**
   * Single SerpAPI call. Returns raw organic results so the extractor can
   * apply its own rule-based + LLM filtering.
   */
  async runSearch(query: string): Promise<{ results: RawSearchResult[]; totalResults: number | null }> {
    if (!this.apiKey) {
      throw new Error("SERPAPI_KEY is not set — add it as a project secret to enable Web Search sourcing.");
    }
    const url = new URL(SERPAPI_ENDPOINT);
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("num", "20");
    url.searchParams.set("api_key", this.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`SerpAPI HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      const data = (await response.json()) as SerpApiResponse;
      if (data.error) throw new Error(`SerpAPI error: ${data.error}`);
      const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
      const results: RawSearchResult[] = [];
      for (const r of organic) {
        if (!r.link || !r.title) continue;
        results.push({
          title: r.title,
          link: r.link,
          snippet: r.snippet ?? "",
        });
      }
      return { results, totalResults: data.search_information?.total_results ?? null };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new Error(`SerpAPI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async run(input: AgentProviderRunInput): Promise<SourcingRunResult> {
    const payload = input.payload as WebSearchPayload;
    const query = this.buildQuery(payload);

    logger.info(
      { providerId: this.id, runId: input.runId, jobId: input.jobId, query, hasKey: !!this.apiKey },
      "Web search sourcing dispatched",
    );

    const { results, totalResults } = await this.runSearch(query);

    if (results.length === 0) {
      const stats: WebSearchStats = {
        searchTotalCount: totalResults ?? 0,
        consideredCount: 0,
        extractedCount: 0,
        droppedNoProfile: 0,
        droppedFabricated: 0,
        returnedCount: 0,
      };
      logger.info({ providerId: this.id, runId: input.runId, ...stats }, "Web search sourcing returned no results");
      return { candidates: [], stats };
    }

    const { candidates: extracted, stats: extractorStats } = await extractCandidates({ results });

    // Map ExtractedCandidate → SourcingCandidate. The extractor already enforces
    // strict validation (no fabricated URLs, no fabricated evidence, names + profile
    // URLs required), so we just pass the data through with NO synthesis.
    const mapped: SourcingCandidate[] = [];
    let droppedNoProfile = 0;
    for (const c of extracted) {
      if (!c.name || !c.profileUrl) {
        droppedNoProfile++;
        continue;
      }
      mapped.push(toSourcingCandidate(c));
    }

    const stats: WebSearchStats = {
      searchTotalCount: totalResults ?? results.length,
      consideredCount: extractorStats.classifiedCount,
      extractedCount: extracted.length,
      droppedNoProfile,
      // Honest fabrication count comes straight from the extractor's
      // post-validation step rather than a derived delta.
      droppedFabricated:
        extractorStats.droppedFabricatedUrl + extractorStats.droppedFabricatedEvidence,
      returnedCount: mapped.length,
    };

    logger.info({ providerId: this.id, runId: input.runId, ...stats }, "Web search sourcing completed");
    return { candidates: mapped, stats };
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: "SERPAPI_KEY is not set" };
    }
    const url = new URL(SERPAPI_ACCOUNT_ENDPOINT);
    url.searchParams.set("api_key", this.apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, error: `SerpAPI HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ""}` };
      }
      const data = (await response.json()) as SerpApiAccountResponse;
      if (data.error) return { ok: false, error: data.error };
      const used = data.this_month_usage ?? 0;
      const limit = data.searches_per_month ?? 0;
      const remaining = limit > 0 ? Math.max(0, limit - used) : null;
      const planSuffix = data.plan_name ? ` on ${data.plan_name}` : "";
      return {
        ok: true,
        error:
          remaining != null
            ? `${remaining}/${limit} SerpAPI searches remaining this month${planSuffix}`
            : `${used} searches used this month${planSuffix}`,
      };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return { ok: false, error: `SerpAPI account check timed out after ${REQUEST_TIMEOUT_MS / 1000}s` };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toSourcingCandidate(c: ExtractedCandidate): SourcingCandidate {
  // sourcingConfidence: linkedin & github profile pages are the highest-signal
  // hits SerpAPI returns; personal sites are weaker because layout varies.
  const confidence = c.sourceType === "website" ? 0.5 : 0.85;
  // The downstream candidates table has columns for linkedIn, githubUrl and
  // email — there is no dedicated "personal site" column. We route a website
  // candidate's profileUrl through linkedinUrl so it acts as the durable
  // identity key for dedup (engine.ts and import.ts both dedupe on linkedIn).
  // The UI already renders linkedIn as a generic "profile link", so this is
  // semantically a canonical-profile-URL field rather than a strict LinkedIn
  // field.
  const linkedinUrl =
    c.sourceType === "linkedin" || c.sourceType === "website" ? c.profileUrl : "";
  const githubUrl = c.sourceType === "github" ? c.profileUrl : "";
  // GitHub username extraction: github.com/<user>
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
    // Never synthesise — extractor returns null when not visible in the snippet.
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
    // The candidate's profile URL is the primary evidence; we keep the snippet
    // alongside it so recruiters can see the matched line at a glance.
    evidence: `${c.profileUrl}\n${c.evidence}`,
    potentialRisks: "",
    source: "Web Search",
  };
}
