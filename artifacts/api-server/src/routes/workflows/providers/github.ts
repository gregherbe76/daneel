import type { AgentProvider, AgentProviderRunInput } from "./interface";
import type { SourcingCandidate } from "./native-openai-sourcing";
import { logger } from "../../../lib/logger";

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;

type SourcingPayload = {
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

type GhUserSearchItem = { login: string; html_url: string };
type GhUserSearchResponse = { total_count: number; items: GhUserSearchItem[] };
type GhUser = {
  login: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  html_url: string;
  email: string | null;
};
type GhRepo = {
  name: string;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  fork: boolean;
};

export class GithubSourcingProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "github";
  private readonly token?: string;

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
    const t = process.env.GITHUB_TOKEN;
    this.token = t && t.trim() ? t.trim() : undefined;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "recruiting-os-github-agent",
    };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  private async ghFetch<T>(path: string): Promise<T> {
    const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.headers(),
        signal: controller.signal,
      });
      if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get("x-ratelimit-remaining");
        const reset = response.headers.get("x-ratelimit-reset");
        const text = await response.text().catch(() => "");
        throw new Error(
          `GitHub rate-limited (HTTP ${response.status}, remaining=${remaining ?? "?"}, resets=${reset ?? "?"})${
            this.token ? "" : " — set GITHUB_TOKEN to raise the limit"
          }${text ? `: ${text.slice(0, 200)}` : ""}`,
        );
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`GitHub API ${response.status} for ${url}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      return (await response.json()) as T;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new Error(`GitHub request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Build the GitHub user-search query from job context. */
  private buildQuery(payload: SourcingPayload): string {
    const job = payload.job;
    const rawLoc = payload.filters?.location?.trim() || job.location?.trim() || "";
    // Strip parentheticals like "(Hybrid)"/"(Remote)" and trailing country/state qualifiers
    // GitHub's location: filter is best-effort substring; keep just the primary city/region.
    const filterLoc = rawLoc
      .replace(/\([^)]*\)/g, "")
      .split(",")[0]
      .trim();
    const skills = (job.mustHaveSkills ?? [])
      .map((s) => s.trim())
      .filter(Boolean);

    const langs = skills.slice(0, 3).map((s) => `language:${quoteIfNeeded(s)}`);
    const parts: string[] = [];

    // Free-text role/seniority hint helps surface relevant bios.
    // GitHub's qualifier parser chokes on punctuation like em-dashes, so strip it.
    const sanitize = (s: string) => s.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
    const free = [job.title, payload.filters?.seniority || job.seniority]
      .filter(Boolean)
      .map((s) => sanitize(String(s)))
      .filter((s) => s.length > 0);
    if (free.length > 0) parts.push(free.join(" "));

    parts.push(...langs);
    if (filterLoc) parts.push(`location:${quoteIfNeeded(filterLoc)}`);
    parts.push("type:user");
    return parts.join(" ");
  }

  async run(input: AgentProviderRunInput): Promise<SourcingCandidate[]> {
    const payload = input.payload as SourcingPayload;
    const desired = Math.min(20, Math.max(1, Number(payload.count ?? 7)));
    const q = this.buildQuery(payload);

    logger.info(
      { providerId: this.id, runId: input.runId, jobId: input.jobId, q, hasToken: !!this.token },
      "GitHub sourcing search dispatched",
    );

    let search = await this.ghFetch<GhUserSearchResponse>(
      `/search/users?q=${encodeURIComponent(q)}&per_page=${desired}`,
    );

    // Fallback: GitHub's `language:` filter only matches real programming languages,
    // so skills like "PostgreSQL"/"AWS"/"Docker" can zero out results. If we got
    // nothing, retry without the language filters and rely on free-text + location.
    if (search.items.length === 0) {
      // Drop language: filters AND seniority — keep just role + location.
      const seniority = (payload.filters?.seniority || payload.job.seniority || "").trim();
      let relaxed = this.buildQuery(payload).replace(/\blanguage:\S+\s*/g, "");
      if (seniority) relaxed = relaxed.replace(new RegExp(`\\b${seniority}\\b`, "i"), "");
      relaxed = relaxed.replace(/\s+/g, " ").trim();
      if (relaxed && relaxed !== q) {
        logger.info(
          { providerId: this.id, runId: input.runId, jobId: input.jobId, q: relaxed },
          "GitHub sourcing retry without language filters",
        );
        search = await this.ghFetch<GhUserSearchResponse>(
          `/search/users?q=${encodeURIComponent(relaxed)}&per_page=${desired}`,
        );
      }
    }

    const mustHaves = (payload.job.mustHaveSkills ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
    const results: SourcingCandidate[] = [];

    for (const item of search.items.slice(0, desired)) {
      try {
        const [user, repos] = await Promise.all([
          this.ghFetch<GhUser>(`/users/${encodeURIComponent(item.login)}`),
          this.ghFetch<GhRepo[]>(`/users/${encodeURIComponent(item.login)}/repos?sort=stars&per_page=10&type=owner`),
        ]);

        const ownRepos = repos.filter((r) => !r.fork).slice(0, 5);
        const topRepos = ownRepos.slice(0, 3);

        // Derive skills from top repo languages (deduped, capped)
        const langSet = new Set<string>();
        for (const r of ownRepos) if (r.language) langSet.add(r.language);
        const skills = Array.from(langSet).slice(0, 10);

        // Confidence: fraction of must-haves found in (languages ∪ bio)
        const haystack = [
          ...skills.map((s) => s.toLowerCase()),
          (user.bio ?? "").toLowerCase(),
        ].join(" ");
        const matched = mustHaves.filter((mh) => haystack.includes(mh)).length;
        const confidence = mustHaves.length > 0 ? matched / mustHaves.length : 0.5;

        const summary = topRepos.length > 0
          ? `Top repos: ${topRepos
              .map((r) => `${r.name} (${r.stargazers_count}★${r.language ? `, ${r.language}` : ""})`)
              .join("; ")}`
          : "";

        const evidenceParts = [user.html_url, ...topRepos.map((r) => r.html_url)];
        const evidence = evidenceParts.join(" \n");

        results.push({
          // Preserve source fidelity — never fall back to login. If GitHub
          // does not expose a display name, leave it empty so the UI shows
          // the username (already on the candidate row) instead.
          name: user.name ?? "",
          headline: "",
          location: user.location ?? "",
          currentCompany: "",
          // Never fabricate an email — recruiters must see when GitHub does not expose one.
          email: user.email,
          linkedinUrl: "",
          githubUrl: user.html_url,
          username: user.login,
          confidence,
          skills,
          summary: [user.bio ?? "", summary].filter(Boolean).join(" — "),
          evidence,
          potentialRisks: "",
          source: "GitHub Agent",
        });
      } catch (err) {
        logger.warn(
          { providerId: this.id, login: item.login, err: err instanceof Error ? err.message : String(err) },
          "GitHub sourcing: skipping user due to fetch failure",
        );
      }
    }

    logger.info(
      { providerId: this.id, runId: input.runId, count: results.length },
      "GitHub sourcing completed",
    );
    return results;
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const data = await this.ghFetch<{ resources: { core: { remaining: number; limit: number } } }>(
        "/rate_limit",
      );
      const core = data.resources?.core;
      if (!core) return { ok: false, error: "Unexpected /rate_limit response" };
      return {
        ok: true,
        error: `${core.remaining}/${core.limit} core requests remaining${this.token ? "" : " (unauthenticated)"}`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function quoteIfNeeded(value: string): string {
  return /[\s:]/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
}
