# Daneel — Agentic Recruiting OS

**The open-source agentic recruiting OS.** Build your own agentic recruiting tool.

Use this repo as a template. Fork it, extend it, and own the logic end-to-end.

Open-source · MIT licensed · production-ready starting point

---

## Daneel powers ShortlistPro

This repo ships with **ShortlistPro** — an AI-powered shortlist product for recruitment agencies — built on top of the Daneel engine.

- **ShortlistPro** = the product (UI, reports, agency workflow). What recruiters see.
- **Daneel** = the engine (workflow runtime, providers, agents). What builders fork.

Think Vercel ↔ Next.js: agencies use ShortlistPro, builders extend Daneel.

---

## What this is

A workflow engine with a recruiting interface — designed to be customized by builders.

```
Job Brief → Workflow Engine → Shortlist → Report
```

The system:
- Understands the job (structured criteria from your description)
- Scores every candidate with explainable, weighted reasoning
- Sources new candidates via your AI provider (real or mock)
- Enriches profiles with additional signals before scoring
- Produces a ranked shortlist and a shareable hiring report

You define the criteria. The agents do the work. Every step is logged.

---

## Use this repo as a template

| Goal | What to change |
|---|---|
| Swap the AI model or provider | Add a new `AgentProvider` class |
| Change how candidates are scored | Edit the scoring prompt in `native-openai.ts` |
| Change scoring weights or dimensions | Update `scoreBreakdown` weights in the prompt |
| Add a new workflow step | Register it in `engine.ts` and `interface.ts` |
| Connect an external AI system | Use `TwinWebhookProvider` or `CustomWebhookProvider` |
| Change what goes in the report | Edit `artifacts/api-server/src/routes/reports.ts` |
| Add a data field to candidates | Update Drizzle schema → `pnpm --filter @workspace/db run push` |
| Add a new UI page | Drop a file in `artifacts/recruiting-os/src/pages/` |
| Add a new API endpoint | Add a route in `artifacts/api-server/src/routes/` and register it in `openapi.yaml` |

Full extension guide: [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)

---

## Architecture for builders

```
┌────────────────────────────────────────────────┐
│                ATS Core (UI)                   │
│  Jobs · Candidates · Pipeline · Reports        │
│  React + Vite + Tailwind + shadcn/ui           │
│  artifacts/recruiting-os/                      │
└───────────────────┬────────────────────────────┘
                    │  REST API
                    │  OpenAPI spec → codegen → typed hooks + Zod
┌───────────────────▼────────────────────────────┐
│          Agentic Workflow Engine                │
│  1. job_understanding                          │
│  2. sourcing          (optional)               │
│  3. enrichment        (optional)               │
│  4. candidate_matching                         │
│  5. shortlist_generation                       │
│  artifacts/api-server/src/routes/workflows/    │
└───────────────────┬────────────────────────────┘
                    │  AgentProvider interface
                    │  provider.run({ step, payload }) → result
┌───────────────────▼────────────────────────────┐
│             Provider Layer                     │
│  NativeOpenAI     built-in GPT prompts         │
│  CustomWebhook    any HTTP POST endpoint        │
│  TwinWebhook      step-routed webhook system   │
│  YourProvider     implement AgentProvider ✓    │
└───────────────────┬────────────────────────────┘
                    │
┌───────────────────▼────────────────────────────┐
│          PostgreSQL + Drizzle ORM              │
│  lib/db/   schema · types · push               │
└────────────────────────────────────────────────┘
```

**Core idea:** every workflow step is a pluggable unit. The engine calls `provider.run({ step, payload })` and stores the result. You decide what runs on the other side — a prompt, a webhook, your own model.

---

## What can be customized

### Scoring rubric
Default dimensions and weights (in `native-openai.ts`):
- **Skills Match** (35%) — required skills coverage
- **Experience Depth** (30%) — seniority and ownership signals
- **Autonomy** (20%) — end-to-end project ownership evidence
- **Product Mindset** (15%) — user/business impact awareness

Change the weights, add/remove dimensions, or change the recommendation thresholds (80+ = Strong Yes, 60–79 = Yes, etc.) without touching the engine. See [examples/custom-scoring-rubric.md](./examples/custom-scoring-rubric.md).

### AI provider
Implement the two-method `AgentProvider` interface to plug in any model, vendor, or internal AI system. See [examples/custom-provider.md](./examples/custom-provider.md).

### External agent system (Twin / n8n / webhook)
Point a webhook provider at any HTTP service that handles one or more steps. See [examples/twin-provider.md](./examples/twin-provider.md).

### Workflow steps
Add new steps — background screening, culture fit scoring, outreach draft, reference check — without rewriting the engine. See [examples/custom-workflow.md](./examples/custom-workflow.md).

### Reports
Edit `artifacts/api-server/src/routes/reports.ts` to change the structure of Markdown and PDF exports.

---

## Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL

### 1. Install

```bash
git clone https://github.com/your-org/agentic-recruiting-os
cd agentic-recruiting-os
pnpm install
```

### 2. Environment variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/recruiting_os
SESSION_SECRET=your-session-secret
```

### 3. Database

```bash
pnpm --filter @workspace/db run push
```

Seed data is included — you can run a full workflow immediately after setup.

### 4. Run

```bash
# API server
pnpm --filter @workspace/api-server run dev

# Frontend (separate terminal)
pnpm --filter @workspace/recruiting-os run dev
```

### 5. Connect an AI provider

Go to **Settings → Agent Providers** in the UI. Add a Native OpenAI provider with your API key. Provider config is stored in the database — no extra env vars needed.

### After changing the API spec

```bash
pnpm --filter @workspace/api-spec run codegen
```

Regenerates React Query hooks and Zod validators from `lib/api-spec/openapi.yaml`.

---

## Project structure

```
.
├── artifacts/
│   ├── api-server/                    # Express API
│   │   └── src/routes/
│   │       ├── workflows/
│   │       │   ├── engine.ts          # Workflow orchestrator — edit to add steps
│   │       │   ├── engine-types.ts    # Shared step result types
│   │       │   └── providers/
│   │       │       ├── interface.ts   # AgentProvider contract — start here
│   │       │       ├── registry.ts    # Provider resolution per step
│   │       │       ├── native-openai.ts          # Scoring prompts live here
│   │       │       ├── native-openai-sourcing.ts
│   │       │       ├── native-openai-enrichment.ts
│   │       │       ├── custom-webhook.ts
│   │       │       └── twin-webhook.ts
│   │       ├── reports.ts             # Report generation (MD + PDF)
│   │       ├── jobs.ts
│   │       └── candidates.ts
│   └── recruiting-os/                 # React + Vite frontend
│       └── src/
│           ├── pages/jobs/            # Job detail, report, edit
│           └── components/
├── lib/
│   ├── db/src/schema/                 # Drizzle schema
│   │   ├── agent-runs.ts
│   │   ├── candidates.ts
│   │   └── jobs.ts
│   └── api-spec/openapi.yaml          # API source of truth → codegen
└── examples/                          # Extension guides for builders
    ├── custom-provider.md
    ├── custom-scoring-rubric.md
    ├── twin-provider.md
    └── custom-workflow.md
```

---

## Data modes

The system enforces strict separation between real and simulated data:

| Mode | What gets scored | Use for |
|---|---|---|
| `mock` | AI-generated mock profiles only | Demo, testing, development |
| `real` | Imported + Twin-sourced candidates only | Production recruiting |
| `fallback` | Imported only (Twin failed, auto-triggered) | Error recovery |

Reports are clearly labelled. Mock data is never silently mixed with real data.

---

## Demo flow

1. Create a job with description, skills, and seniority
2. Click **Run AI Workflow** (choose Demo Run or Real Data Run)
3. Optionally enable sourcing (generates mock candidates) or enrichment
4. Get structured job insights + evaluation criteria
5. Every candidate is scored 0–100 across 4 dimensions
6. Ranked shortlist of top 5 is generated with summaries
7. Export a hiring report (Markdown or PDF)

**Output:** a clear answer to "Who should I interview and why?"

---

## Roadmap

- Real sourcing — LinkedIn, GitHub, Lever, Greenhouse integrations
- Outreach agents — automated candidate contact
- Multi-provider workflows — different providers per step
- Evaluation templates — per-role rubric customization
- Multi-agent orchestration — parallel scoring, consensus decisions

---

## License

MIT
