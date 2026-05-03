# Example: Adding a Custom Workflow Step

This example adds a `culture_fit` scoring step that runs after candidate matching and before shortlisting. It scores candidates on three culture dimensions and flags mismatches before the shortlist is generated.

---

## Overview of changes

1. Register the step name in `interface.ts`
2. Define the result type in `engine-types.ts`
3. Add a DB table to store results
4. Implement the step function in `engine.ts`
5. Call the step from the main runner
6. Expose it in the API spec

---

## Step 1: Register the step name

In `artifacts/api-server/src/routes/workflows/providers/interface.ts`:

```typescript
export type WorkflowStep =
  | "job_understanding"
  | "candidate_matching"
  | "shortlist_generation"
  | "sourcing"
  | "enrichment"
  | "culture_fit";  // ← add this
```

---

## Step 2: Define the result type

In `artifacts/api-server/src/routes/workflows/engine-types.ts`:

```typescript
export type CultureFitResult = {
  candidateId: number;
  candidateName: string;
  overallScore: number;            // 0–100
  dimensions: {
    collaboration: number;         // 0–100
    ownership: number;
    learningMindset: number;
  };
  signals: string[];               // positive signals from the profile
  redFlags: string[];              // potential culture mismatches
  fitSummary: string;              // 1-sentence narrative
};
```

---

## Step 3: Add a DB table

In `lib/db/src/schema/culture-fit.ts`:

```typescript
import { pgTable, serial, integer, real, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { agentRunsTable } from "./agent-runs";
import { candidatesTable } from "./candidates";
import { jobsTable } from "./jobs";

export const cultureFitTable = pgTable("culture_fit_evaluations", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => agentRunsTable.id, { onDelete: "cascade" }),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  overallScore: real("overall_score").notNull(),
  dimensions: jsonb("dimensions").notNull(),
  signals: text("signals").array().notNull().default([]),
  redFlags: text("red_flags").array().notNull().default([]),
  fitSummary: text("fit_summary").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

Export it from `lib/db/src/index.ts` and push:

```bash
pnpm --filter @workspace/db run push
```

---

## Step 4: Add the step function in the engine

In `artifacts/api-server/src/routes/workflows/engine.ts`:

```typescript
import { cultureFitTable } from "@workspace/db";
import type { CultureFitResult } from "./engine-types";

async function runCultureFit(
  runId: number,
  jobId: number,
  job: { title: string; description: string },
  candidates: Array<{ id: number; name: string; skills: string[]; summary: string | null }>,
): Promise<void> {
  await logStep(runId, "culture_fit", "running", { candidateCount: candidates.length });

  const provider = await resolveProvider("culture_fit");
  logger.info({ runId, step: "culture_fit", provider: provider.name }, "Step dispatched");

  try {
    const results = (await provider.run({
      step: "culture_fit",
      runId,
      jobId,
      payload: { job, candidates },
    })) as CultureFitResult[];

    await Promise.all(
      results.map((r) =>
        db.insert(cultureFitTable).values({
          runId,
          jobId,
          candidateId: r.candidateId,
          overallScore: r.overallScore,
          dimensions: r.dimensions,
          signals: r.signals,
          redFlags: r.redFlags,
          fitSummary: r.fitSummary,
        }),
      ),
    );

    await logStep(runId, "culture_fit", "completed", { candidateCount: candidates.length }, {
      scored: results.length,
      avgScore: results.length > 0
        ? (results.reduce((s, r) => s + r.overallScore, 0) / results.length).toFixed(1)
        : null,
    });
  } catch (err) {
    await logStep(runId, "culture_fit", "failed", null, {
      error: err instanceof Error ? err.message : String(err),
    });
    // Culture fit failure is non-fatal — continue to shortlisting
    logger.error({ runId, err }, "Culture fit step failed — continuing to shortlist");
  }
}
```

---

## Step 5: Handle the step in a provider

Add `culture_fit` to `NativeOpenAIProvider.run()` in `native-openai.ts`:

```typescript
case "culture_fit":
  return this.runCultureFit(payload as CultureFitPayload);
```

And implement the method:

```typescript
private async runCultureFit(payload: { job: any; candidates: any[] }): Promise<CultureFitResult[]> {
  const { job, candidates } = payload;

  return batchProcess(candidates, async (candidate) => {
    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 600,
      messages: [{
        role: "user",
        content: `Assess culture fit for ${candidate.name} at ${job.title}.

Candidate summary: ${candidate.summary ?? "none"}
Skills: ${candidate.skills.join(", ")}
Job context: ${job.description.slice(0, 300)}

Score three dimensions 0-100:
- collaboration: evidence of working well in teams, async communication, cross-functional projects
- ownership: bias toward accountability, seeing things through, not waiting for direction
- learningMindset: curiosity, growth trajectory, adapting to new domains

Return JSON:
{
  "candidateId": ${candidate.id},
  "candidateName": "${candidate.name}",
  "overallScore": <average of three dimensions>,
  "dimensions": { "collaboration": <0-100>, "ownership": <0-100>, "learningMindset": <0-100> },
  "signals": ["<positive signal>"],
  "redFlags": ["<potential mismatch>"],
  "fitSummary": "<1 sentence>"
}`,
      }],
    });

    return json<CultureFitResult>(response.choices[0]?.message?.content ?? "{}");
  }, { concurrency: 3 });
}
```

---

## Step 6: Call the step from the main runner

In `runWorkflowEngine()`, add it between matching and shortlisting:

```typescript
// After candidate_matching
if (options.runCultureFit) {
  await runCultureFit(runId, jobId, effectiveJob, matchingCandidates);
}

// Then shortlist continues as before
```

Add `runCultureFit` to the engine options type:

```typescript
options: {
  dataMode?: DataMode;
  runSourcing?: boolean;
  runEnrichment?: boolean;
  runCultureFit?: boolean;    // ← add this
  variantCriteria?: VariantCriteria;
}
```

---

## Step 7: Expose it in the API

In `lib/api-spec/openapi.yaml`, add `runCultureFit: boolean` to `RunWorkflowBody` and `RunVariantBody`.

```bash
pnpm --filter @workspace/api-spec run codegen
```

In the workflow router (`index.ts`), read and pass it:

```typescript
const runCultureFit = (body as { runCultureFit?: boolean }).runCultureFit ?? false;
setImmediate(() => runWorkflowEngine(run.id, jobId, { ..., runCultureFit }));
```

---

## Step 8: Surface it in the UI

Add a checkbox to the workflow panel in `artifacts/recruiting-os/src/pages/jobs/detail.tsx` (follow the pattern for `runSourcing` and `runEnrichment`).

To show culture fit scores in the report, add a new section to `artifacts/api-server/src/routes/reports.ts` that fetches from `cultureFitTable` and includes the results in the response.

---

## Key points

- **Non-fatal steps**: wrap the step in try/catch and continue if it fails. The workflow should complete even if an optional step errors.
- **Step logging**: always call `logStep(runId, step, "running")` before and `logStep(runId, step, "completed" | "failed")` after. This populates the run log in the UI.
- **Provider assignment**: after registering the step name, it appears in the Settings → Workflow Step Assignments table. Assign any provider (native or webhook) without code changes.
