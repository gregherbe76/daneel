import { openai } from "@workspace/integrations-openai-ai-server";
import type { AgentProvider, AgentProviderRunInput } from "./interface";
import { logger } from "../../../lib/logger";

export type EnrichmentCandidate = {
  id: number;
  name: string;
  email: string;
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
  enrichedSummary: string;
  enrichedSkills: string[];
  enrichedHeadline: string | null;
  additionalSignals: string[];
  confidence: number;
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

    const prompt = `You are an expert talent researcher. For each candidate below, enrich their profile based on any available signals in their data and the job context.

JOB CONTEXT:
Title: ${jobContext.title} (${jobContext.seniority})
Must-Have Skills: ${jobContext.mustHaveSkills.join(", ")}

CANDIDATES:
${candidates.map((c, i) => `[${i}] id=${c.id} name="${c.name}" headline="${c.headline ?? ""}" currentCompany="${c.currentCompany ?? ""}" skills=${JSON.stringify(c.skills)} summary="${(c.summary ?? "").slice(0, 200)}"`).join("\n")}

For each candidate, produce:
- enrichedSummary: a concise 2-3 sentence narrative connecting their background to the job context
- enrichedSkills: expanded skill list (inferred from role/company signals + existing skills, max 12 total)
- enrichedHeadline: improved headline if possible, else null
- additionalSignals: 1-3 concrete inferred signals relevant to this role (e.g. "Likely experienced with React given frontend role at fintech startup")
- confidence: float 0.0-1.0 representing how confident the enrichment is (higher = more data available)

Return a JSON array with exactly ${candidates.length} objects matching this shape:
[
  {
    "candidateId": <number matching the id field>,
    "enrichedSummary": "...",
    "enrichedSkills": ["skill1", "skill2"],
    "enrichedHeadline": "...",
    "additionalSignals": ["signal1"],
    "confidence": 0.7
  }
]

Return only valid JSON, no markdown.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 3000,
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
