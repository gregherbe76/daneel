import { openai } from "@workspace/integrations-openai-ai-server";
import type { AgentProvider, AgentProviderRunInput } from "./interface";
import type { JobInsightResult } from "../engine-types";

/**
 * Optional per-run summary stats a sourcing provider can return alongside
 * the candidate list. Lets the UI explain WHY a run returned few/no results
 * (e.g. quality filters dropped them) instead of looking broken.
 */
export type SourcingStats = {
  /** Raw hit count reported by the upstream search (e.g. GitHub total_count). */
  searchTotalCount?: number;
  /** Number of candidates the provider actually fetched and inspected. */
  consideredCount?: number;
  /** Number of candidate rows the provider extracted before validation drops. */
  extractedCount?: number;
  /** Dropped because the provider's "must have a bio" filter rejected them. */
  droppedNoBio?: number;
  /** Dropped because the provider's "active within N months" filter rejected them. */
  droppedStale?: number;
  /** Dropped because of a transient per-candidate fetch failure. */
  droppedFetchError?: number;
  /** Dropped because the row was missing required identity fields (name, profile URL, etc). */
  droppedInvalid?: number;
  /** Dropped because the row was missing a profile URL. */
  droppedNoProfile?: number;
  /** Dropped because the row's URL or evidence didn't match a real upstream result. */
  droppedFabricated?: number;
  /** Final count of candidates returned to the engine. */
  returnedCount?: number;
};

/** Sourcing providers may return a bare array OR an object with stats. */
export type SourcingRunResult =
  | SourcingCandidate[]
  | { candidates: SourcingCandidate[]; stats?: SourcingStats };

export type SourcingCandidate = {
  name: string;
  headline: string;
  location: string;
  currentCompany: string;
  /**
   * Email may be empty/null when the upstream source (e.g. GitHub) has no public
   * email. We never fabricate one — recruiters need to know if a contact email
   * is missing.
   */
  email: string | null;
  linkedinUrl: string;
  githubUrl: string;
  /** GitHub login when sourced from GitHub; otherwise null. */
  username: string | null;
  /** Confidence 0..1 derived by the provider; null if not computed. */
  confidence: number | null;
  /**
   * Where the email came from, so recruiters can judge how confidently to reach out.
   *  - "profile":  taken from a verified profile field (e.g. public GitHub email)
   *  - "commit":   inferred from public commit metadata (best-effort, not verified)
   *  - "noreply":  placeholder address (e.g. GitHub noreply) — not deliverable
   *  - "generated":fabricated for mock/demo data — not deliverable
   *  - null:       no email is associated with this candidate
   */
  emailSource: "profile" | "commit" | "noreply" | "generated" | null;
  skills: string[];
  summary: string;
  evidence: string;
  potentialRisks: string;
  /** "AI Generated / Mock Sourcing" for native, "GitHub Agent" for github, etc. */
  source: string;
};

export type SourcingPayload = {
  job: {
    title: string;
    description: string;
    location: string;
    seniority: string;
    mustHaveSkills: string[];
  };
  insight: JobInsightResult;
};

function json<T>(content: string): T {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(match ? match[1] : content);
}

export class NativeOpenAISourcingProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "native_openai";

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }

  async run(input: AgentProviderRunInput): Promise<SourcingRunResult> {
    const { job, insight } = input.payload as SourcingPayload;
    const desiredCount = 7;

    const prompt = `You are a recruiting researcher. Generate 7 realistic but clearly mock candidate profiles for this role.

JOB: ${job.title} (${job.seniority})
Location: ${job.location}
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
Ideal Profile: ${insight.idealCandidateProfile}
Evaluation Criteria: ${insight.evaluationCriteria.join(", ")}

Generate 7 diverse candidate profiles. They must be clearly fictional — use placeholder emails and LinkedIn URLs.
Vary seniority levels, backgrounds, and locations within the same field. Avoid stereotypes.

Return a JSON array with exactly 7 objects:
[
  {
    "name": "Full Name",
    "headline": "Current title at current company",
    "location": "City, Country",
    "currentCompany": "Company Name",
    "email": "firstname.lastname.mock@example.com",
    "linkedinUrl": "https://linkedin.com/in/mock-profile-slug",
    "githubUrl": "https://github.com/mock-username",
    "skills": ["skill1", "skill2", "skill3"],
    "summary": "2-3 sentence professional background. Be specific about what they have built or led.",
    "evidence": "1-2 specific signals that make them a plausible fit (e.g. led a rewrite of X, shipped Y at Z scale)",
    "potentialRisks": "1 sentence on the main uncertainty or gap",
    "source": "AI Generated / Mock Sourcing"
  }
]

IMPORTANT:
- All profiles are clearly mock/generated. Use 'mock' in email and linkedin slug.
- No profile should claim certainty about things AI cannot know.
- Be honest in potentialRisks — make each risk specific and different.
- Return only valid JSON, no markdown or other text.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = json<Array<Omit<SourcingCandidate, "username" | "confidence"> & { username?: string | null; confidence?: number | null }>>(
      response.choices[0]?.message?.content ?? "[]",
    );

    // Drop rows missing the bare-minimum identity field so the UI can explain
    // why a "0 candidates" mock run was actually a malformed LLM response —
    // matching how GitHub surfaces filter drop counts.
    const candidates: SourcingCandidate[] = [];
    let droppedInvalid = 0;
    for (const c of raw) {
      if (!c.name || !String(c.name).trim()) {
        droppedInvalid++;
        continue;
      }
      candidates.push({
        ...c,
        username: c.username ?? null,
        confidence: c.confidence ?? null,
        // Mock candidates use placeholder *.mock@example.com addresses — flag them
        // so the UI can warn recruiters not to send real outreach.
        emailSource: c.email ? "generated" : null,
      });
    }

    const stats: SourcingStats = {
      searchTotalCount: desiredCount,
      consideredCount: raw.length,
      extractedCount: raw.length,
      droppedInvalid,
      returnedCount: candidates.length,
    };
    return { candidates, stats };
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await openai.chat.completions.create({
        model: "gpt-5.1",
        max_completion_tokens: 5,
        messages: [{ role: "user", content: "ping" }],
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
