import { openai } from "@workspace/integrations-openai-ai-server";
import type { AgentProvider, AgentProviderRunInput } from "./interface";
import { logger } from "../../../lib/logger";

export type EnrichmentCandidate = {
  id: number;
  name: string;
  email: string | null;
  skills: string[];
  summary: string | null;
  headline: string | null;
  location: string | null;
  currentCompany: string | null;
  githubUrl: string | null;
  linkedIn: string | null;
};

export type EnrichmentResult = {
  candidateId: number;
  enrichedHeadline: string | null;
  currentCompany: string | null;
  location: string | null;
  skills: string[];
  experienceSummary: string;
  evidence: string;
  confidence: number;
  missingFields: string[];
};

export type EnrichmentPayload = {
  candidates: EnrichmentCandidate[];
  jobContext: {
    title: string;
    seniority: string;
    mustHaveSkills: string[];
  };
};

function json<T>(content: string): T {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(match ? match[1] : content);
}

export class NativeOpenAIEnrichmentProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "native_openai";

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }

  async run(input: AgentProviderRunInput): Promise<EnrichmentResult[]> {
    const { candidates, jobContext } = input.payload as EnrichmentPayload;

    logger.info({ runId: input.runId, candidateCount: candidates.length }, "Native enrichment starting");

    const prompt = `You are a candidate data normalizer. Your job is to improve candidate records using ONLY data explicitly present in the profile provided — you must NEVER fabricate, infer, or guess information that is not clearly stated in the input.

STRICT RULES:
1. NEVER invent skills, companies, locations, or any facts not explicitly present in the candidate data
2. If a field cannot be determined from the available data alone, add it to missingFields and return null/[] for it
3. Set confidence based on how much verifiable data was available (0.0 = essentially no data, 1.0 = complete profile)
4. A LinkedIn placeholder email like "linkedin-*@placeholder.import" means the profile was imported from a URL slug — you have almost no real data; set confidence ≤ 0.2 and list most fields as missing
5. experienceSummary must only describe what is explicitly known — never embellish or speculate
6. evidence must cite which specific data points you used (e.g. "headline field", "email domain", "existing skills list")
7. skills may only include skills already listed in the candidate's skills array — do not add new ones unless they appear in the headline or summary verbatim

JOB CONTEXT (for relevance framing only — do not use to invent skills):
Title: ${jobContext.title} (${jobContext.seniority})
Must-Have Skills: ${jobContext.mustHaveSkills.join(", ")}

CANDIDATES:
${candidates.map((c, i) => `[${i}] id=${c.id}
  name: "${c.name}"
  email: "${c.email ?? "(none)"}"
  headline: "${c.headline ?? "(none)"}"
  currentCompany: "${c.currentCompany ?? "(none)"}"
  location: "${c.location ?? "(none)"}"
  linkedIn: "${c.linkedIn ?? "(none)"}"
  skills: ${JSON.stringify(c.skills)}
  summary: "${(c.summary ?? "(none)").slice(0, 300)}"`).join("\n\n")}

For each candidate return an object in this JSON array:
[
  {
    "candidateId": <number matching id>,
    "enrichedHeadline": "<improved headline or null if cannot determine>",
    "currentCompany": "<company name if clearly present in data, else null>",
    "location": "<location if clearly present, else null>",
    "skills": ["only skills already in their data or explicitly mentioned in headline/summary"],
    "experienceSummary": "<brief factual summary of what is known, no invention>",
    "evidence": "<which data points were used>",
    "confidence": <float 0.0-1.0 — be conservative, most placeholder profiles should be ≤ 0.2>,
    "missingFields": ["list of field names that could not be determined from available data"]
  }
]

Return only valid JSON array, no markdown.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    return json<EnrichmentResult[]>(response.choices[0]?.message?.content ?? "[]");
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
