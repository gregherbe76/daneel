import type { AgentProvider, AgentProviderRunInput } from "./interface";
import type { SourcingCandidate, SourcingRunResult, SourcingStats } from "./native-openai-sourcing";
import type { GithubProviderConfig } from "@workspace/db";
import { logger } from "../../../lib/logger";

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;

export type SourcingPayload = {
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
type GhCommitAuthor = { name?: string; email?: string };
type GhPushEventCommit = { sha: string; author: GhCommitAuthor };
type GhEvent = {
  type: string;
  created_at?: string;
  actor?: { login?: string };
  payload?: { commits?: GhPushEventCommit[] };
};

function isUsableEmail(email: string | undefined | null, login: string): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  if (e.endsWith("@users.noreply.github.com")) return false;
  if (e.endsWith("@noreply.github.com")) return false;
  // Filter out bot/automation accounts that frequently appear in events.
  if (e.includes("[bot]")) return false;
  if (e === `action@github.com`) return false;
  if (e.startsWith(`${login.toLowerCase()}+`) && e.includes("@users.noreply")) return false;
  return true;
}

export class GithubSourcingProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "github";
  private readonly token?: string;
  private readonly config: GithubProviderConfig;

  constructor(id: number, name: string, config?: GithubProviderConfig | null) {
    this.id = id;
    this.name = name;
    this.config = config ?? {};
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

  /**
   * Build the GitHub user-search query from job context.
   *
   * Public so route handlers (e.g. /providers/preview-github-query) can
   * surface the exact query a recruiter is about to run before they kick
   * off the workflow. Pure function over (config, payload) — no I/O.
   */
  buildQuery(payload: SourcingPayload): string {
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

    // Recruiter-tunable extra keywords are appended to the free-text portion verbatim
    // (sanitised the same way as title/seniority so GitHub's parser doesn't choke).
    const extraKeywords = sanitize(this.config.extraKeywords ?? "");
    if (extraKeywords) parts.push(extraKeywords);

    parts.push(...langs);
    if (filterLoc) parts.push(`location:${quoteIfNeeded(filterLoc)}`);

    // Per-provider numeric filters
    const minFollowers = this.config.minFollowers;
    if (typeof minFollowers === "number" && minFollowers > 0) {
      parts.push(`followers:>=${Math.floor(minFollowers)}`);
    }
    const minRepos = this.config.minRepos;
    if (typeof minRepos === "number" && minRepos > 0) {
      parts.push(`repos:>=${Math.floor(minRepos)}`);
    }

    // Exclude orgs/users — split on commas, whitespace, or semicolons.
    const excludeOrgs = (this.config.excludeOrgs ?? "")
      .split(/[\s,;]+/)
      .map((o) => o.trim().replace(/^@/, ""))
      .filter(Boolean);
    for (const org of excludeOrgs) {
      parts.push(`-user:${quoteIfNeeded(org)}`);
    }

    parts.push("type:user");
    return parts.join(" ");
  }

  /**
   * Fetch the user's public events. Returns null on failure (rate limit,
   * 5xx, etc) so callers can distinguish "no recent activity" from "we
   * could not check" — the activity filter must not silently drop a
   * candidate just because GitHub timed out.
   */
  private async fetchPublicEvents(login: string): Promise<GhEvent[] | null> {
    try {
      return await this.ghFetch<GhEvent[]>(
        `/users/${encodeURIComponent(login)}/events/public?per_page=100`,
      );
    } catch (err) {
      logger.debug(
        { login, err: err instanceof Error ? err.message : String(err) },
        "GitHub events fetch failed",
      );
      return null;
    }
  }

  private discoverEmailFromCommits(
    login: string,
    displayName: string | null,
    events: GhEvent[],
  ): string | null {
    const loginLc = login.toLowerCase();
    const nameLc = (displayName ?? "").toLowerCase().trim();

    // Only accept commits whose author identity strongly matches the user.
    // This avoids attributing a co-author / merged-commit email to the wrong
    // person — a real risk when scanning PushEvent payloads in bulk.
    const matchedCounts = new Map<string, number>();
    for (const ev of events) {
      if (ev.type !== "PushEvent") continue;
      const commits = ev.payload?.commits ?? [];
      for (const c of commits) {
        const email = c.author?.email;
        if (!isUsableEmail(email, login)) continue;
        const authorName = (c.author?.name ?? "").toLowerCase().trim();
        const emailLc = email!.toLowerCase();
        const looksLikeUser =
          authorName === loginLc ||
          (nameLc && authorName === nameLc) ||
          emailLc.startsWith(`${loginLc}@`) ||
          emailLc.startsWith(`${loginLc}+`);
        if (!looksLikeUser) continue;
        matchedCounts.set(email!, (matchedCounts.get(email!) ?? 0) + 1);
      }
    }
    if (matchedCounts.size === 0) return null;
    let best: string | null = null;
    let bestCount = 0;
    for (const [e, n] of matchedCounts) {
      if (n > bestCount) {
        best = e;
        bestCount = n;
      }
    }
    return best;
  }

  /** Last-resort noreply address — never deliverable, but signals identity. */
  private noreplyEmail(login: string): string {
    return `${login}@users.noreply.github.com`;
  }

  /**
   * Hit the GitHub user-search endpoint with the given query and return only
   * the total_count. Uses per_page=1 so the response is tiny — recruiters can
   * call this from the provider edit dialog to gauge a query before kicking
   * off a full sourcing run. Throws on rate-limit / network errors so the
   * caller can surface a friendly message.
   */
  async previewMatchCount(query: string): Promise<number> {
    const res = await this.ghFetch<{ total_count: number }>(
      `/search/users?q=${encodeURIComponent(query)}&per_page=1`,
    );
    return res.total_count ?? 0;
  }

  /** Build a SourcingPayload from a Job row and run-time filters. */
  static buildPayloadFromJob(
    job: { title: string; description?: string | null; location?: string | null; seniority?: string | null; mustHaveSkills?: string[] | null },
    filters?: { location?: string; seniority?: string },
  ): SourcingPayload {
    return {
      job: {
        title: job.title,
        description: job.description ?? undefined,
        location: job.location ?? undefined,
        seniority: job.seniority ?? undefined,
        mustHaveSkills: job.mustHaveSkills ?? [],
      },
      filters,
    };
  }

  async run(input: AgentProviderRunInput): Promise<SourcingRunResult> {
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

    const requireBio = this.config.requireBio === true;
    const activeWithinMonths =
      typeof this.config.activeWithinMonths === "number" && this.config.activeWithinMonths > 0
        ? Math.floor(this.config.activeWithinMonths)
        : null;
    const activityCutoffMs =
      activeWithinMonths != null
        ? Date.now() - activeWithinMonths * 30 * 24 * 60 * 60 * 1000
        : null;
    let droppedNoBio = 0;
    let droppedStale = 0;
    let droppedFetchError = 0;
    const searchTotalCount = search.total_count;
    const consideredCount = Math.min(search.items.length, desired);

    // Only fetch /events/public when we actually need it: either to enforce
    // the activity filter or to discover an email when the public profile
    // doesn't expose one. Skipping it otherwise saves a request per
    // candidate against GitHub's tight rate limit.
    const needEventsForActivity = activityCutoffMs != null;

    for (const item of search.items.slice(0, desired)) {
      try {
        const [user, repos] = await Promise.all([
          this.ghFetch<GhUser>(`/users/${encodeURIComponent(item.login)}`),
          this.ghFetch<GhRepo[]>(`/users/${encodeURIComponent(item.login)}/repos?sort=stars&per_page=10&type=owner`),
        ]);

        if (requireBio && !(user.bio ?? "").trim()) {
          droppedNoBio++;
          logger.debug(
            { providerId: this.id, login: item.login },
            "GitHub sourcing: dropped (empty bio)",
          );
          continue;
        }

        const profileEmailUsable = isUsableEmail(user.email, user.login);
        const needEvents = needEventsForActivity || !profileEmailUsable;
        const events = needEvents ? await this.fetchPublicEvents(item.login) : null;

        if (activityCutoffMs != null) {
          // events === null means the events fetch failed (rate-limited,
          // timeout, etc). Treat that as "unknown activity" and keep the
          // candidate — better to surface a possibly-stale account than to
          // silently drop everyone during a transient GitHub outage.
          if (events != null) {
            const latest = events.reduce<number>((max, ev) => {
              const t = ev.created_at ? Date.parse(ev.created_at) : NaN;
              return Number.isFinite(t) && t > max ? t : max;
            }, 0);
            if (latest === 0 || latest < activityCutoffMs) {
              droppedStale++;
              logger.debug(
                { providerId: this.id, login: item.login, latest, cutoff: activityCutoffMs },
                "GitHub sourcing: dropped (stale activity)",
              );
              continue;
            }
          }
        }

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

        // Email resolution order:
        //   1. Public profile email (when GitHub exposes it).
        //   2. Real address discovered from the user's public commit metadata.
        //   3. Noreply fallback so the candidate row always carries a stable
        //      identifier — recruiters can tell at a glance it isn't deliverable.
        // Track the *source* alongside the value so the UI can label trust
        // (verified profile vs. inferred from commits vs. undeliverable noreply).
        // Reuses the pre-fetched `profileEmailUsable` and `events` from above
        // so we avoid a second events round-trip per candidate.
        let resolvedEmail: string;
        let emailSource: "profile" | "commit" | "noreply";
        if (profileEmailUsable) {
          resolvedEmail = user.email!;
          emailSource = "profile";
        } else {
          const fromCommits = events != null
            ? this.discoverEmailFromCommits(user.login, user.name, events)
            : null;
          if (fromCommits) {
            resolvedEmail = fromCommits;
            emailSource = "commit";
          } else {
            resolvedEmail = this.noreplyEmail(user.login);
            emailSource = "noreply";
          }
        }

        results.push({
          // Preserve source fidelity — never fall back to login. If GitHub
          // does not expose a display name, leave it empty so the UI shows
          // the username (already on the candidate row) instead.
          name: user.name ?? "",
          headline: "",
          location: user.location ?? "",
          currentCompany: "",
          email: resolvedEmail,
          emailSource,
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
        droppedFetchError++;
        logger.warn(
          { providerId: this.id, login: item.login, err: err instanceof Error ? err.message : String(err) },
          "GitHub sourcing: skipping user due to fetch failure",
        );
      }
    }

    const stats: SourcingStats = {
      searchTotalCount,
      consideredCount,
      // GitHub hits the API directly (no LLM extraction step), so the number of
      // candidates we attempted to extract equals consideredCount. Surface it
      // explicitly so the funnel badge UI can render the same shape across
      // providers.
      extractedCount: consideredCount,
      droppedNoBio,
      droppedStale,
      droppedFetchError,
      // GitHub returns real URLs from the search API — no fabrication is
      // possible — but we emit a 0 so the contract stays consistent with the
      // LLM-backed providers.
      droppedFabricated: 0,
      returnedCount: results.length,
    };

    logger.info(
      {
        providerId: this.id,
        runId: input.runId,
        ...stats,
      },
      "GitHub sourcing completed",
    );
    return { candidates: results, stats };
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
