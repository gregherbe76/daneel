# Example: Adding a Custom Provider

This example walks through adding a provider that calls an Anthropic Claude model instead of OpenAI, handling all core workflow steps.

Estimated time: 15 minutes.

---

## What a provider does

A provider handles one or more workflow steps. When the engine runs a step, it calls:

```typescript
provider.run({ step, runId, jobId, payload }) → result
```

The result shape depends on the step. The provider must return an object that matches the expected structure for each step (defined in `engine-types.ts`).

---

## Step 1: Create the provider file

```typescript
// artifacts/api-server/src/routes/workflows/providers/anthropic-provider.ts

import Anthropic from "@anthropic-ai/sdk";
import type { AgentProvider, AgentProviderRunInput, WorkflowStep } from "./interface";
import type { JobInsightResult, CandidateMatchResult, ShortlistResult } from "../engine-types";

function json<T>(content: string): T {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(match ? match[1] : content);
}

export class AnthropicProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "anthropic";  // unique type string — used in DB enum + registry

  private readonly client: Anthropic;
  private readonly model: string;

  constructor(id: number, name: string, apiKey: string, model = "claude-opus-4-5") {
    this.id = id;
    this.name = name;
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async run(input: AgentProviderRunInput): Promise<unknown> {
    const { step, payload } = input;

    switch (step as WorkflowStep) {
      case "job_understanding":
        return this.runJobUnderstanding(payload as any);
      case "candidate_matching":
        return this.runCandidateMatching(payload as any);
      case "shortlist_generation":
        return this.runShortlistGeneration(payload as any);
      default:
        throw new Error(`AnthropicProvider does not handle step: ${step}`);
    }
  }

  private async runJobUnderstanding(payload: { job: any }): Promise<JobInsightResult> {
    const { job } = payload;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Analyze this job and return JSON with fields: mustHaveSkills, seniority, evaluationCriteria, idealCandidateProfile.

Job: ${job.title} (${job.seniority})
Must-have skills: ${job.mustHaveSkills.join(", ")}
Description: ${job.description}

Return only valid JSON.`,
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return json<JobInsightResult>(text);
  }

  private async runCandidateMatching(payload: { job: any; insight: any; candidates: any[] }): Promise<CandidateMatchResult[]> {
    const { job, insight, candidates } = payload;

    return Promise.all(candidates.map(async (candidate) => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 900,
        messages: [{
          role: "user",
          content: `Score this candidate for ${job.title}.

Candidate: ${candidate.name}
Skills: ${candidate.skills.join(", ")}
Summary: ${candidate.summary ?? "none"}

Score on 4 dimensions (each 0-100):
- skillsMatch (weight 0.35)
- experienceDepth (weight 0.30)
- autonomy (weight 0.20)
- productMindset (weight 0.15)

Return JSON: { scoreBreakdown: { skillsMatch: { score, weight: 0.35, reasoning }, experienceDepth: { score, weight: 0.30, reasoning }, autonomy: { score, weight: 0.20, reasoning }, productMindset: { score, weight: 0.15, reasoning } }, score, strengths, gaps, risks, recommendation }
Recommendation: 80+ = Strong Yes, 60-79 = Yes, 40-59 = Maybe, <40 = No`,
        }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const raw = json<any>(text);

      return {
        ...raw,
        candidateId: candidate.id,
        candidateName: candidate.name,
      };
    }));
  }

  private async runShortlistGeneration(payload: { job: any; insight: any; evaluations: any[] }): Promise<ShortlistResult[]> {
    const { job, evaluations } = payload;
    const top5 = [...evaluations].sort((a, b) => b.score - a.score).slice(0, 5);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Create shortlist summaries for ${job.title}.

Candidates:
${top5.map(c => `- ${c.candidateName} (score: ${c.score}, rec: ${c.recommendation})`).join("\n")}

Return JSON array: [{ candidateId, candidateName, whyRelevant, keyRisks, finalRecommendation }]`,
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return json<ShortlistResult[]>(text);
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 5,
        messages: [{ role: "user", content: "ping" }],
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

---

## Step 2: Register the type in the registry

In `providers/registry.ts`, add to the `buildProvider` switch:

```typescript
import { AnthropicProvider } from "./anthropic-provider";

function buildProvider(row: typeof agentProvidersTable.$inferSelect): AgentProvider {
  switch (row.type) {
    case "native_openai":
      return new NativeOpenAIProvider(row.id, row.name);
    case "anthropic":
      // apiKeyEncryptedPlaceholder stores the API key reference
      if (!row.apiKeyEncryptedPlaceholder) throw new Error(`Provider "${row.name}" is missing API key`);
      return new AnthropicProvider(row.id, row.name, row.apiKeyEncryptedPlaceholder);
    // ... other cases
  }
}
```

---

## Step 3: Add the type to the DB enum

In `lib/db/src/schema/agent-providers.ts`:

```typescript
export const providerTypeEnum = pgEnum("provider_type", [
  "native_openai",
  "custom_webhook",
  "twin_webhook",
  "anthropic",  // ← add this
]);
```

Then push:

```bash
pnpm --filter @workspace/db run push
```

---

## Step 4: Add to the OpenAPI spec

In `lib/api-spec/openapi.yaml`, find `ProviderType` and add `anthropic`:

```yaml
ProviderType:
  type: string
  enum: [native_openai, custom_webhook, twin_webhook, anthropic]
```

Then regenerate:

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Step 5: Use it

Go to **Settings → Agent Providers → Add Provider**, select `anthropic`, paste your API key, then assign it to one or more steps in **Workflow Step Assignments**.

---

## Notes

- A provider only needs to handle the steps you assign to it. If a step is assigned to your provider but `run()` throws, the engine will log the error and fail the run.
- For per-candidate parallelism, use `Promise.all()` or a batch utility like the built-in `batchProcess()` from the OpenAI integration package.
- The `apiKeyEncryptedPlaceholder` field is currently a plaintext reference (name for the key). In production, replace this with proper secret management.
