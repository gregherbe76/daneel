import { z } from "zod/v4";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

export type RawSearchResult = {
  title: string;
  link: string;
  snippet: string;
};

export type ExtractedCandidate = {
  name: string;
  headline: string;
  profileUrl: string;
  currentCompany: string | null;
  location: string | null;
  evidence: string;
  sourceType: "linkedin" | "github" | "website";
};

export type ExtractCandidatesResult = {
  candidates: ExtractedCandidate[];
};

const LINKEDIN_PROFILE_RE = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#]+/i;
const GITHUB_PROFILE_RE = /^https?:\/\/github\.com\/[^/?#]+\/?$/i;

const SKIP_HOST_PATTERNS: RegExp[] = [
  /linkedin\.com\/jobs/i,
  /linkedin\.com\/company/i,
  /linkedin\.com\/pub\/dir/i,
  /linkedin\.com\/school/i,
  /linkedin\.com\/showcase/i,
  /indeed\.com/i,
  /glassdoor\./i,
  /monster\.com/i,
  /ziprecruiter\.com/i,
  /wellfound\.com\/jobs/i,
  /wellfound\.com\/company/i,
  /lever\.co/i,
  /greenhouse\.io/i,
  /workable\.com/i,
  /smartrecruiters\.com/i,
  /ashbyhq\.com/i,
  /jobs\.ashbyhq/i,
  /careers\./i,
  /\/careers\//i,
  /\/jobs\//i,
  /github\.com\/(orgs|topics|trending|marketplace|sponsors|collections|events|enterprise)/i,
];

const COMMON_PUBLIC_HOSTS = new Set([
  "youtube.com",
  "youtu.be",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com",
  "wikipedia.org",
  "stackoverflow.com",
  "medium.com",
  "dev.to",
  "hashnode.dev",
]);

function classify(link: string): ExtractedCandidate["sourceType"] | null {
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const full = url.toString();
  for (const re of SKIP_HOST_PATTERNS) {
    if (re.test(full)) return null;
  }
  if (LINKEDIN_PROFILE_RE.test(full)) return "linkedin";
  if (GITHUB_PROFILE_RE.test(full)) return "github";
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (COMMON_PUBLIC_HOSTS.has(host)) return null;
  // Personal websites: must have a path or be a non-trivial domain.
  // Skip bare TLD landing pages like "example.com/" with nothing else.
  // Allow anything that has a path AND isn't on the skip list.
  if (url.pathname && url.pathname !== "/") return "website";
  return "website";
}

const ExtractedCandidateSchema = z.object({
  name: z.string().trim().min(1),
  headline: z.string().trim().default(""),
  profileUrl: z.string().trim().url(),
  currentCompany: z.string().trim().nullable().default(null),
  location: z.string().trim().nullable().default(null),
  evidence: z.string().trim().min(1),
});

const LlmResponseSchema = z.object({
  candidates: z.array(ExtractedCandidateSchema).default([]),
});

const SYSTEM_PROMPT = `You extract candidate profile data from web search results.

Strict rules:
- Only output a candidate if the result is a personal profile of a real human (LinkedIn /in/ profile, GitHub user profile, or personal portfolio website).
- NEVER output a candidate for: job listings, company pages, ATS pages, directories, school pages, news articles, blog posts (unless the blog is clearly the person's own portfolio).
- NEVER invent data. If a field is not visible in the title or snippet, set it to null (for currentCompany, location) or empty string (for headline).
- "evidence" MUST be the exact snippet text supplied for that result. Do not paraphrase.
- "profileUrl" MUST be the exact link supplied. Do not modify it.
- "name" MUST be a real person's name visible in the title or snippet. If no clear human name is present, skip the result.
- If unsure whether a result is a person, skip it.

Output JSON shape:
{
  "candidates": [
    { "name": string, "headline": string, "profileUrl": string, "currentCompany": string|null, "location": string|null, "evidence": string }
  ]
}`;

function buildUserPrompt(results: RawSearchResult[]): string {
  const lines = results.map((r, i) => {
    return `[${i}]
title: ${r.title}
link: ${r.link}
snippet: ${r.snippet}`;
  });
  return `Extract candidate profiles from these ${results.length} search results.\n\n${lines.join("\n\n")}`;
}

export async function extractCandidates(input: {
  results: RawSearchResult[];
}): Promise<ExtractCandidatesResult> {
  const { results } = input;

  // Step 1: rule-based pre-filter. Drop anything that obviously isn't a profile.
  const filtered: Array<RawSearchResult & { sourceType: ExtractedCandidate["sourceType"] }> = [];
  for (const r of results) {
    if (!r?.link || !r?.title) continue;
    const sourceType = classify(r.link);
    if (!sourceType) continue;
    filtered.push({ ...r, sourceType });
  }

  if (filtered.length === 0) {
    return { candidates: [] };
  }

  // Step 2: LLM extraction with strict no-fabrication system prompt.
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(filtered) },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  let parsed: z.infer<typeof LlmResponseSchema>;
  try {
    parsed = LlmResponseSchema.parse(JSON.parse(content));
  } catch (err) {
    logger.warn({ err, content }, "extractCandidates: failed to parse LLM response");
    return { candidates: [] };
  }

  // Step 3: post-validate. Only keep candidates whose profileUrl matches a
  // result we actually sent (no URL fabrication) AND whose evidence matches a
  // snippet we sent (no evidence fabrication).
  const linkToSourceType = new Map(filtered.map((r) => [r.link, r.sourceType]));
  const allowedSnippets = new Set(filtered.map((r) => r.snippet));

  const candidates: ExtractedCandidate[] = [];
  for (const c of parsed.candidates) {
    if (!c.name || !c.profileUrl || !c.evidence) continue;
    const sourceType = linkToSourceType.get(c.profileUrl);
    if (!sourceType) {
      logger.warn({ profileUrl: c.profileUrl }, "extractCandidates: dropped candidate with fabricated URL");
      continue;
    }
    if (!allowedSnippets.has(c.evidence)) {
      logger.warn({ profileUrl: c.profileUrl }, "extractCandidates: dropped candidate with fabricated evidence");
      continue;
    }
    candidates.push({
      name: c.name,
      headline: c.headline ?? "",
      profileUrl: c.profileUrl,
      currentCompany: c.currentCompany ?? null,
      location: c.location ?? null,
      evidence: c.evidence,
      sourceType,
    });
  }

  return { candidates };
}
