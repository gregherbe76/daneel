# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Architecture

### Artifacts
- `artifacts/api-server` — Express 5 REST API, port 8080, path `/api` (Daneel engine: workflow runtime, providers, agents)
- `artifacts/recruiting-os` — React + Vite frontend, path `/` (HiringAI UI layer; package name `@workspace/recruiting-os` is the engine codename and stays unchanged)

### Product positioning
- **HiringAI** is the user-facing product (UI copy, reports, "Job" terminology, startup-oriented branding). Phase 1 of the "1 product + 3 templates" plan collapsed the live app into a single coherent HiringAI product — ShortlistPro / HireFlow agency vocabulary and white-label fields (`clientName`, `clientLogoUrl`) have been removed.
- **Daneel** is the underlying engine (kept in code naming, internal types, README, and the "Powered by Daneel" attribution shown in the sidebar and exported reports).
- Do NOT rename internal modules, package names, type names, or the engine architecture to "HiringAI" — only UI-visible strings and reports use the HiringAI brand.
- **Phase 2 (template loader, shipped)**: `lib/branding/src/index.ts` reads `APP_TEMPLATE` (Node) / `VITE_APP_TEMPLATE` (Vite, build-time inlined) and resolves to one of `hiringai` (default), `hireflow`, `shortlistpro`. Templates live at `lib/branding/src/templates/<name>/branding.ts` with a rich schema (terms, fonts, stageLabels, featureFlags, colors). Exposed as `template` (rich) and `branding` (legacy flattened shape for back-compat with existing report/UI consumers). Unknown values fall back to `hiringai` with a warning.
- **Phase 3 (externalized prompts, shipped)**: `lib/branding/src/templates/<name>/prompts.ts` exports `prompts = { jobUnderstanding, candidateMatching, shortlistGeneration }` — TS builder functions returning the full prompt strings with JSON-schema/rubric baked in. `native-openai.ts` imports `prompts` from `@workspace/branding` and calls them instead of inlining the strings. `hireflow` and `shortlistpro` re-export `hiringai/prompts` as placeholders, ready to be tuned per template.

### Shared Libraries
- `lib/db` — Drizzle ORM schema + DB client (`@workspace/db`)
- `lib/api-spec` — OpenAPI YAML spec (`@workspace/api-spec`)
- `lib/api-client-react` — Orval-generated React Query hooks (`@workspace/api-client-react`)
- `lib/api-zod` — Orval-generated Zod validation schemas (`@workspace/api-zod`)

## Features

### Core CRUD
- **Jobs** — title, description, location, seniority, mustHaveSkills
- **Candidates** — name, email, linkedIn, summary, skills + sourcing fields (headline, location, currentCompany, githubUrl, source)

### Team Collaboration
- **Team roster** — hard-coded HR roster in `artifacts/api-server/src/lib/team-roster.ts` (no auth yet); exposed via `GET /api/team`.
- **@mentions in comments** — `candidate_comments.mentions` JSONB column stores `{id,name}[]`; `MentionTextarea` provides `@`-triggered autocomplete and `CommentBody` renders matched names as highlighted chips.
- **Mentions inbox** — `GET /api/team/:memberId/mentions` lists comments mentioning a teammate (with candidate/job context). `/mentions` page shows the inbox; sidebar badge counts unread items per current user. The "current user" and "last read" timestamp are persisted in `localStorage` (keys `hiringai.currentUserId`, `hiringai.mentionsLastReadAt:{userId}`).
- **Applications** — candidateId + jobId join, stage pipeline (Sourced → Hired)

### AI Workflow Engine (`artifacts/api-server/src/routes/workflows/`)
4-step agentic pipeline run per job. Steps:
1. **Job Understanding** — extracts idealCandidateProfile, mustHaveSkills, evaluationCriteria, seniority
2. **Sourcing** (optional) — generates 7 mock AI candidates tailored to the role, inserts them as real candidates+applications
3. **Candidate Matching** — scores every candidate using three-score model (see below)
4. **Shortlist Generation** — top-5 ranked by decisionScore with hiring summaries

### Enrichment-First Logic (Pre-Matching)
Before any candidate is sent to the AI for evaluation, the engine pre-screens data confidence (using `computeDataConfidenceScore`):

- **If `dataConfidenceScore < 50` and an enrichment provider is configured** → `runInlineEnrichmentForCandidates()` is called for that batch, candidate rows are updated in DB, and the AI receives the enriched profiles. Server logs: `"Enrichment triggered before evaluation"`.
- **If `dataConfidenceScore < 50` and no enrichment provider** → scoring continues with existing data. The evaluation is stored with `requiresEnrichment = true` and `"Low reliability — enrichment recommended"` is appended to `missingDataWarnings`. Server logs: `"Skipped full evaluation due to low confidence — no enrichment provider configured"`.
- **Workflow never blocks**: enrichment failures fall back gracefully; low-confidence candidates always get scored.

`requiresEnrichment: boolean` on `ai_evaluations` is the persistent flag. UI surfaces it as an amber "Enrich recommended" badge on pipeline cards, all-evaluations list, and the Full Evaluation Table. The Score Reliability section also includes `requiresEnrichment` candidates.

### Three-Score Candidate Scoring Model
Each candidate evaluation stores three complementary scores:

| Score | Source | Formula |
|---|---|---|
| **Fit Score** (0-100) | AI (GPT) | Weighted: autonomy×0.35 + productMindset×0.30 + impact×0.35 (HiringAI 3-dimension rubric, configurable per-job). Recomputed server-side for consistency. |
| **Data Confidence Score** (0-100) | Server (engine.ts) | Derived from profile completeness: enrichmentStatus (+30-40), LinkedIn (+15), skills count (+5-20), summary length (+8-20), headline (+5). |
| **Decision Score** (0-100) | Server (engine.ts) | `round(fitScore × (0.6 + 0.4 × dataConfidence/100))`. Main ranking/sorting score. |

`confidenceLevel`: High (≥70), Medium (≥40), Low (<40) — derived from Data Confidence Score.  
`score` column = decisionScore (backward-compat for sorting).  
Shortlist is sorted by decisionScore. UI shows all three scores + confidence badge.  
Report page includes "Score Reliability" section listing high-fit but low-confidence candidates.

Workflow is triggered via `POST /api/workflows/run` with `{ jobId, runSourcing?: boolean }`.  
Results are fetched via `GET /api/workflows/jobs/:jobId/latest`.

### Agent Provider Layer (`artifacts/api-server/src/routes/workflows/providers/`)
- `NativeOpenAIProvider` — handles job_understanding, candidate_matching, shortlist_generation
- `NativeOpenAISourcingProvider` — handles the sourcing step specifically
- `CustomWebhookProvider` — delegates to any external HTTP endpoint
- `TwinWebhookProvider` — extends CustomWebhook with twinContext metadata
- `GithubSourcingProvider` — sources real public GitHub users via the public REST API (`/search/users`, `/users/{login}`, `/users/{login}/repos`); validateConnection hits `/rate_limit`; never fabricates email/name (leaves them null/empty when GitHub does not expose them); populates first-class `githubUsername` and `sourcingConfidence` columns; tagged as `source="GitHub Agent"`. Uses optional `GITHUB_TOKEN` for higher rate limits.
- `WebSearchSourcingProvider` — sources real candidates via SerpAPI Google Search; builds queries from job title/skills/location with optional `extraKeywords`, `targetSites` (default linkedin.com/in, github.com), and `excludeSites`; pipes raw results through the existing `extractCandidates` lib (strict no-fabrication: emails always null, name/headline/location only when visible); confidence 0.85 for linkedin/github profiles, 0.5 for other sites; tagged as `source="Web Search"`. Requires `SERPAPI_KEY` env secret.
- `resolveProvider(step)` — looks up DB setting, falls back to native
- `resolveSourcingProvider()` — same but defaults to NativeOpenAISourcingProvider

### Settings > Agent Providers
UI at `/settings/providers` to configure which AI provider handles each workflow step.
Workflow steps: `job_understanding`, `candidate_matching`, `shortlist_generation`, `sourcing`.

### DB Schema (`lib/db/src/schema/`)
- `jobs` — job postings
- `candidates` — includes `headline`, `location`, `currentCompany`, `githubUrl`, `source` (null for manual, "AI Generated / Mock Sourcing" for sourced)
- `applications` — job ↔ candidate many-to-many with stage enum
- `agent_runs` — one per workflow execution; has `runSourcing: boolean`
- `agent_logs` — step-level log with input/output JSON
- `ai_evaluations` — per-candidate scoring: score (=decisionScore), fitScore, dataConfidenceScore, decisionScore, confidenceLevel, confidenceReason, missingDataWarnings
- `job_insights` — extracted job understanding
- `shortlists` — ranked shortlist with summaries
- `agent_providers` — configured provider records
- `workflow_provider_settings` — step → provider assignments

### Re-scoring historical evaluations (rubric changes)
The HiringAI scoring rubric is currently the 3-dimension startup-tuned set:
`autonomy 0.35`, `productMindset 0.30`, `impact 0.35`. When the rubric changes,
historical `ai_evaluations` rows still carry the old `scoreBreakdown` shape and
need to be re-scored so old reports render the new dimensions.

One-shot script: `scripts/src/rescore-3d.ts`

```bash
pnpm --filter @workspace/scripts run rescore-3d -- --job 12          # one job
pnpm --filter @workspace/scripts run rescore-3d -- --run 47          # one agent run
pnpm --filter @workspace/scripts run rescore-3d -- --all-hiringai    # everything
pnpm --filter @workspace/scripts run rescore-3d -- --job 12 --dry    # preview, no writes
```

The script REFUSES to run globally without an explicit scope flag — this
prevents accidentally overwriting evaluations that came from a different
rubric variant (the HireFlow/ShortlistPro 6-dimension rubric is tracked in
a separate task). Use `--all-hiringai` only when every row in `ai_evaluations`
is known to be a HiringAI evaluation.

It re-runs candidate matching against the 3-D rubric (using stored
`job_insights` + candidate profile) and updates the row in place — preserving
`runId/jobId/candidateId` so historical agent runs stay linked.
`dataConfidenceScore` is preserved when present; for legacy rows where it is
null, it is recomputed from the candidate profile using the same logic as
`engine.ts:computeDataConfidenceScore` (no arbitrary defaults).
`decisionScore` and `score` are recomputed from the new `fitScore`.

If the rubric changes again, edit the `RUBRIC` constant and the prompt in
`scripts/src/rescore-3d.ts`, then re-run the script.
