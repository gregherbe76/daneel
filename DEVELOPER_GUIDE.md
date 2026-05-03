# Developer Guide — Agentic Recruiting OS

This guide is for builders who want to extend, customize, or build on top of this system. You should be able to understand the full architecture and make your first meaningful change in under 30 minutes.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [ATS core](#ats-core)
3. [Workflow engine](#workflow-engine)
4. [Provider layer](#provider-layer)
5. [How to add a provider](#how-to-add-a-provider)
6. [How to add a workflow step](#how-to-add-a-workflow-step)
7. [How to customize scoring](#how-to-customize-scoring)
8. [How to customize reports](#how-to-customize-reports)
9. [Data modes](#data-modes)
10. [API contract and codegen](#api-contract-and-codegen)
11. [Database schema](#database-schema)

---

## Architecture overview

The system has three layers:

```
UI  →  Workflow Engine  →  Provider Layer  →  Database
```

**UI** (`artifacts/recruiting-os/`)
React + Vite + Tailwind. Talks to the API via generated React Query hooks. Never import directly from the API package — always go through the generated client.

**Workflow Engine** (`artifacts/api-server/src/routes/workflows/`)
The core orchestrator. When a run is triggered, the engine executes steps in sequence, each step delegated to a provider. Results are stored in PostgreSQL after each step. Every step is logged to `agent_logs`.

**Provider Layer** (`artifacts/api-server/src/routes/workflows/providers/`)
A provider is anything that can execute a workflow step. The engine doesn't care what runs inside — a prompt, a webhook, a fine-tuned model. All providers implement the same two-method `AgentProvider` interface.

**Database** (`lib/db/`)
PostgreSQL via Drizzle ORM. Schema is in `lib/db/src/schema/`. Run `pnpm --filter @workspace/db run push` after any schema change.

---

## ATS core

The minimal ATS tracks three entities:

### Jobs (`lib/db/src/schema/jobs.ts`)
- `title`, `description`, `location`, `seniority`, `mustHaveSkills` (text array)
- The job description + must-have skills are the primary inputs to the workflow

### Candidates (`lib/db/src/schema/candidates.ts`)
- `name`, `email`, `headline`, `summary`, `skills`, `source`
- `source` tracks where the candidate came from: `"Twin"`, `"Mock"`, `"Imported"`, or `null`
- Enrichment fields: `enrichedAt`, `enrichmentSource`, `enrichmentConfidence`

### Applications (`lib/db/src/schema/applications.ts`)
- Links a candidate to a job with a `stage` (Sourced → Screening → Interview → Offer → Hired)
- Created automatically when a candidate is sourced or imported

Everything else (scoring, shortlists, insights) is generated data tied to a specific **run**.

---

## Workflow engine

### Entry point

`artifacts/api-server/src/routes/workflows/engine.ts` → `runWorkflowEngine(runId, jobId, options)`

The engine is called asynchronously after a run is created:
```typescript
setImmediate(() => runWorkflowEngine(run.id, jobId, { dataMode, runSourcing, runEnrichment }));
```

### Step sequence

```
1. job_understanding       Always runs. Produces structured evaluation criteria.
2. sourcing                Optional. Runs if runSourcing=true.
3. enrichment              Optional. Runs if runEnrichment=true.
4. candidate_matching      Always runs (if candidates exist).
5. shortlist_generation    Always runs (if evaluations exist).
```

### How each step works

1. The engine calls `resolveProvider(step)` to get the assigned provider
2. The provider's `run({ step, runId, jobId, payload })` is called
3. The result is stored in the appropriate table (e.g. `ai_evaluations`, `job_insights`)
4. A log entry is written to `agent_logs` with input, output, and status

### Run state

A run row in `agent_runs` tracks:
- `status`: `pending → running → completed | failed`
- `dataMode`: `real | mock | fallback`
- `runSourcing`, `runEnrichment`: booleans for optional steps
- `variantOf`, `variantLabel`, `variantCriteria`: for variant runs

### Variant runs

A variant run applies overrides (different seniority, skills, or focus) to re-run matching against the same candidates. The engine merges the variant criteria over the job definition before passing it to providers.

---

## Provider layer

### The `AgentProvider` interface

Located at `artifacts/api-server/src/routes/workflows/providers/interface.ts`.

```typescript
interface AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type: string;

  // Execute a workflow step. Return the result object for that step.
  run(input: AgentProviderRunInput): Promise<unknown>;

  // Check if the provider is reachable. Used by the test-connection UI.
  validateConnection(): Promise<{ ok: boolean; error?: string }>;
}

interface AgentProviderRunInput {
  step: WorkflowStep;   // which step is running
  runId: number;        // the current agent_runs.id
  jobId: number;        // the current job
  payload: Record<string, unknown>;  // step-specific data
}
```

That's the entire contract. Implement those two methods and your provider works.

### Built-in providers

| Class | Type string | What it does |
|---|---|---|
| `NativeOpenAIProvider` | `native_openai` | Runs GPT prompts for all core steps |
| `NativeOpenAISourcingProvider` | `native_openai` | Generates mock candidate profiles |
| `NativeOpenAIEnrichmentProvider` | `native_openai` | Enriches candidate profiles |
| `CustomWebhookProvider` | `custom_webhook` | POSTs the payload to any HTTP endpoint |
| `TwinWebhookProvider` | `twin_webhook` | Routes each step to a dedicated Twin endpoint |

### Provider registry

`artifacts/api-server/src/routes/workflows/providers/registry.ts`

The registry resolves which provider runs each step at runtime by querying `workflow_provider_settings`. If no setting is configured for a step, the native fallback is used. This means you can assign different providers to different steps from the Settings UI without redeploying.

Resolution order:
1. Look up `workflow_provider_settings` for this step
2. If no setting or disabled → use native fallback
3. If setting exists → look up the provider row → build provider instance

---

## How to add a provider

**5 steps. ~15 minutes.**

### 1. Create the provider class

```typescript
// artifacts/api-server/src/routes/workflows/providers/my-provider.ts
import type { AgentProvider, AgentProviderRunInput } from "./interface";

export class MyProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "my_provider";  // must be unique

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }

  async run(input: AgentProviderRunInput): Promise<unknown> {
    const { step, payload } = input;

    if (step === "candidate_matching") {
      // Call your model, API, or logic here
      // payload contains: { job, insight, candidates }
      return myMatchingLogic(payload);
    }

    throw new Error(`MyProvider does not handle step: ${step}`);
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Ping your service to verify it's reachable
      await myService.ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

### 2. Register the type in the registry

In `registry.ts`, add a case to `buildProvider`:

```typescript
case "my_provider":
  return new MyProvider(row.id, row.name);
```

### 3. Add the type to the DB enum

In `lib/db/src/schema/agent-providers.ts`, add `"my_provider"` to the `providerTypeEnum`.

```bash
pnpm --filter @workspace/db run push
```

### 4. Add the type to the OpenAPI spec

In `lib/api-spec/openapi.yaml`, find `ProviderType` and add `my_provider`.

```bash
pnpm --filter @workspace/api-spec run codegen
```

### 5. Test it

Go to Settings → Agent Providers → Add Provider, select your type, and assign it to a step.

See also: [examples/custom-provider.md](./examples/custom-provider.md)

---

## How to add a workflow step

**6 steps. ~20 minutes.**

### 1. Name the step

Pick a name like `"background_check"`. Add it to `WorkflowStep` in `interface.ts`:

```typescript
export type WorkflowStep =
  | "job_understanding"
  | "candidate_matching"
  | "shortlist_generation"
  | "sourcing"
  | "enrichment"
  | "background_check";  // ← add here
```

### 2. Define the result type

In `engine-types.ts`:

```typescript
export type BackgroundCheckResult = {
  candidateId: number;
  flagged: boolean;
  notes: string;
};
```

### 3. Add a DB table (if needed)

In `lib/db/src/schema/`, create a new schema file or add columns to an existing table. Run `pnpm --filter @workspace/db run push`.

### 4. Implement the step function in the engine

In `engine.ts`, add a private async function:

```typescript
async function runBackgroundCheck(
  runId: number,
  jobId: number,
  candidates: Array<{ id: number; name: string }>,
): Promise<void> {
  await logStep(runId, "background_check", "running", { candidateCount: candidates.length });

  const provider = await resolveProvider("background_check");
  const results = (await provider.run({
    step: "background_check",
    runId,
    jobId,
    payload: { candidates },
  })) as BackgroundCheckResult[];

  // Store results
  for (const r of results) {
    await db.insert(backgroundChecksTable).values({ runId, jobId, ...r });
  }

  await logStep(runId, "background_check", "completed", null, { checked: results.length });
}
```

### 5. Call the step from the main runner

In `runWorkflowEngine`, add it at the right point in the sequence:

```typescript
if (options.runBackgroundCheck) {
  await runBackgroundCheck(runId, jobId, candidates);
}
```

### 6. Expose it in the API

Add `runBackgroundCheck` to `RunWorkflowBody` in `openapi.yaml`, then run codegen.

See also: [examples/custom-workflow.md](./examples/custom-workflow.md)

---

## How to customize scoring

All scoring logic for the native provider lives in one place:

`artifacts/api-server/src/routes/workflows/providers/native-openai.ts` → `runCandidateMatching()`

### Changing dimensions and weights

The scoring prompt defines 4 dimensions with weights that sum to 1.0:

```
skillsMatch      weight: 0.35
experienceDepth  weight: 0.30
autonomy         weight: 0.20
productMindset   weight: 0.15
```

To add a new dimension (e.g. `domainExpertise` at 15%), redistribute the weights, add it to the prompt, and add it to the `scoreBreakdown` structure. The engine re-computes the weighted score server-side to prevent model drift.

### Changing recommendation thresholds

The prompt defines:
```
80–100 → Strong Yes
60–79  → Yes
40–59  → Maybe
0–39   → No
```

Update these in the prompt string to match your hiring bar.

### Changing the rubric per role

To support role-specific rubrics, pass the rubric as part of the job payload and template it into the prompt:

```typescript
const rubric = job.customRubric ?? DEFAULT_RUBRIC;
const prompt = `...Evaluation rubric: ${rubric}...`;
```

See also: [examples/custom-scoring-rubric.md](./examples/custom-scoring-rubric.md)

---

## How to customize reports

Report generation is in `artifacts/api-server/src/routes/reports.ts`.

### Structure

```typescript
// buildReport() constructs the data object used by all report formats
function buildReport(run, job, candidates, evaluations, insight, shortlist) {
  return {
    generatedAt,
    run: { id, runDate, status, dataMode, ... },
    job,
    insight,
    top5,
    evaluations,
    recommendationSummary,
    interviewFocusAreas,
    risks,
  };
}
```

There are three output routes:
- `GET /api/reports/job/:jobId/latest` → JSON (used by the UI)
- `GET /api/reports/job/:jobId/latest/markdown` → Markdown file
- `GET /api/reports/job/:jobId/latest/pdf` → PDF file

### Adding a new section to the report

1. Compute the new data in `buildReport()`
2. Add it to the returned object
3. Add it to the Markdown template (the large template string in `reports.ts`)
4. Add it to the PDF generation function

### Changing the PDF layout

PDF generation uses `pdfkit` directly. The layout is defined imperatively in the `generatePDF()` function. Fonts, colors, and spacing are all configurable there.

---

## Data modes

The engine enforces strict separation between real and simulated data via the `dataMode` field on each run:

```typescript
type DataMode = "real" | "mock" | "fallback";
```

**`mock`** (default) — only AI-generated mock candidates are scored. Sourcing creates mock profiles tagged `source = "Mock"`. Matching filters to `source = "Mock"` only.

**`real`** — only imported and Twin-sourced candidates are scored. Sourcing is skipped if no Twin provider is assigned. Candidates are tagged `source = "Twin"`. Matching filters to `source !== "Mock"`.

**`fallback`** — automatically set when a `real` run's Twin sourcing fails. The engine demotes the run and continues with imported candidates. Never silently falls back to generating mock data.

Reports show a banner indicating the mode. Mock data is never mixed into real runs.

---

## API contract and codegen

The API is defined in `lib/api-spec/openapi.yaml`. This is the single source of truth.

After any change to the spec:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This generates:
- `lib/api-client-react/` — React Query hooks (e.g. `useGetJob`, `useRunWorkflow`)
- `lib/api-zod/` — Zod validators for request bodies (used server-side in routes)

**Never manually edit the generated files.** Always edit the spec and regenerate.

On the server, use Zod schemas to validate incoming request bodies:
```typescript
const body = RunWorkflowBody.parse(req.body);  // throws if invalid
```

On the client, use the generated hooks:
```typescript
const { data: job } = useGetJob(jobId);
```

---

## Database schema

All schema files are in `lib/db/src/schema/`. Export types from `lib/db/src/index.ts` to use them across the monorepo.

After any schema change:
```bash
pnpm --filter @workspace/db run push
```

This runs `drizzle-kit push` which applies the diff directly (no migration files — suitable for development). For production, use `drizzle-kit generate` + `drizzle-kit migrate` instead.

Key tables:

| Table | Purpose |
|---|---|
| `jobs` | Job definitions |
| `candidates` | Candidate profiles |
| `applications` | Candidate ↔ Job link + pipeline stage |
| `agent_runs` | One row per workflow execution |
| `agent_logs` | Per-step logs (input, output, status) |
| `job_insights` | Output of job_understanding step |
| `ai_evaluations` | Per-candidate scores and reasoning |
| `shortlists` | Ranked top-5 with summaries |
| `agent_providers` | Registered provider instances |
| `workflow_provider_settings` | Step → provider assignment |

---

## Quick reference

| Task | File |
|---|---|
| Add a provider type | `providers/interface.ts` + `providers/registry.ts` + DB enum |
| Change scoring logic | `providers/native-openai.ts` → `runCandidateMatching()` |
| Add a workflow step | `providers/interface.ts` + `engine.ts` + new table if needed |
| Change report structure | `routes/reports.ts` → `buildReport()` |
| Add an API endpoint | `routes/*.ts` + `lib/api-spec/openapi.yaml` → codegen |
| Add a UI page | `artifacts/recruiting-os/src/pages/` |
| Add a DB column | `lib/db/src/schema/*.ts` → `pnpm --filter @workspace/db run push` |
| Change API types | `lib/api-spec/openapi.yaml` → `pnpm --filter @workspace/api-spec run codegen` |
