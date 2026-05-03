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
- `artifacts/api-server` — Express 5 REST API, port 8080, path `/api`
- `artifacts/recruiting-os` — React + Vite frontend, path `/`

### Shared Libraries
- `lib/db` — Drizzle ORM schema + DB client (`@workspace/db`)
- `lib/api-spec` — OpenAPI YAML spec (`@workspace/api-spec`)
- `lib/api-client-react` — Orval-generated React Query hooks (`@workspace/api-client-react`)
- `lib/api-zod` — Orval-generated Zod validation schemas (`@workspace/api-zod`)

## Features

### Core CRUD
- **Jobs** — title, description, location, seniority, mustHaveSkills
- **Candidates** — name, email, linkedIn, summary, skills + sourcing fields (headline, location, currentCompany, githubUrl, source)
- **Applications** — candidateId + jobId join, stage pipeline (Sourced → Hired)

### AI Workflow Engine (`artifacts/api-server/src/routes/workflows/`)
4-step agentic pipeline run per job. Steps:
1. **Job Understanding** — extracts idealCandidateProfile, mustHaveSkills, evaluationCriteria, seniority
2. **Sourcing** (optional) — generates 7 mock AI candidates tailored to the role, inserts them as real candidates+applications
3. **Candidate Matching** — scores every candidate (0-100) with strengths/gaps/risks/recommendation
4. **Shortlist Generation** — top-5 ranked candidates with hiring summaries

Workflow is triggered via `POST /api/workflows/run` with `{ jobId, runSourcing?: boolean }`.  
Results are fetched via `GET /api/workflows/jobs/:jobId/latest`.

### Agent Provider Layer (`artifacts/api-server/src/routes/workflows/providers/`)
- `NativeOpenAIProvider` — handles job_understanding, candidate_matching, shortlist_generation
- `NativeOpenAISourcingProvider` — handles the sourcing step specifically
- `CustomWebhookProvider` — delegates to any external HTTP endpoint
- `TwinWebhookProvider` — extends CustomWebhook with twinContext metadata
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
- `ai_evaluations` — per-candidate scoring results
- `job_insights` — extracted job understanding
- `shortlists` — ranked shortlist with summaries
- `agent_providers` — configured provider records
- `workflow_provider_settings` — step → provider assignments
