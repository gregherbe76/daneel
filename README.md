# Agentic Recruiting OS

**From job brief to shortlist, powered by AI agents.**

---

## What this is

Agentic Recruiting OS is not an ATS.

It is a **control layer for agentic recruiting workflows**. It gives you a minimal interface to manage jobs, candidates, and pipeline — then hands off the analysis to AI agents that do the actual work: understanding your job, scoring candidates, sourcing profiles, generating a shortlist, and producing a shareable report.

You stay in control. The agents do the grunt work.

---

## Demo flow

1. **Create a job** — title, location, seniority, must-have skills, description
2. **Click "Run AI Workflow"** — optionally check "Generate new candidates before matching"
3. **Job Understanding** — the agent extracts an ideal candidate profile and evaluation criteria
4. **Sourcing (optional)** — the agent generates 7 realistic mock candidate profiles tailored to the role
5. **Candidate Matching** — every candidate is scored 0–100 with strengths, gaps, risks, and a recommendation
6. **Shortlist Generation** — the top 5 are ranked and summarised for a hiring manager
7. **Export Report** — download a Markdown or PDF report ready to share

---

## Features

- **Minimal ATS core** — jobs, candidates, application pipeline with stage tracking
- **Agentic workflow engine** — multi-step, async, with per-step logging
- **Job Understanding** — AI extracts structured insights from free-text job descriptions
- **AI Matching** — candidates scored against the role with explainable recommendations
- **Sourcing** — mock candidate generation to seed the pipeline before matching
- **Shortlist Generation** — ranked top-5 with hiring summaries
- **Exportable Reports** — clean Markdown and PDF hiring manager reports
- **Pluggable Agent Providers** — use OpenAI natively, bring your own webhook, or connect a Twin agent

---

## Architecture

```
┌─────────────────────────────────────┐
│            ATS Core                 │
│  Jobs · Candidates · Pipeline UI    │
│  React + Vite + Tailwind            │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│       Agentic Workflow Engine       │
│  job_understanding → sourcing →     │
│  candidate_matching → shortlist     │
│  Express · PostgreSQL · Drizzle     │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│          Provider Layer             │
│  NativeOpenAI · CustomWebhook ·     │
│  TwinWebhook · (plug in your own)   │
└─────────────────────────────────────┘
```

**ATS Core** — stores jobs, candidates, and applications. Serves as the data layer and gives the workflow engine something to work with.

**Workflow Engine** — orchestrates the steps, logs every input/output, handles failures gracefully, and writes results back to the database.

**Provider Layer** — each workflow step resolves a provider at runtime. The default is the native OpenAI integration. You can override per-step with any HTTP webhook or a Twin agent endpoint.

---

## Why this exists

Existing ATSs are heavy, rigid, and built for enterprise procurement cycles. AI recruiting tools are fragmented — a plugin here, a Chrome extension there, an expensive add-on that doesn't talk to anything else. And despite all of it, recruiting is still largely manual: read a resume, write a scorecard, copy-paste into a spreadsheet.

Agentic Recruiting OS is one control layer where:

- **Agents do the analysis** — screening, scoring, sourcing, summarising
- **You keep control** — every step is logged, every output is inspectable
- **The provider is swappable** — run it on OpenAI today, wire in your own model tomorrow

---

## Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL

### Install

```bash
git clone https://github.com/your-org/agentic-recruiting-os
cd agentic-recruiting-os
pnpm install
```

### Environment variables

Copy `.env.example` to `.env` and fill in:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/recruiting_os
SESSION_SECRET=your-session-secret
```

For the AI workflow engine, connect an OpenAI-compatible provider via Settings → Agent Providers in the UI. The API key is stored encrypted and never exposed to the frontend.

### Database

```bash
pnpm --filter @workspace/db run push
```

### Run

```bash
# API server (port 8080)
pnpm --filter @workspace/api-server run dev

# Frontend (port 5173)
pnpm --filter @workspace/recruiting-os run dev
```

### Codegen (after changing the API spec)

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Roadmap

- **Real sourcing** — LinkedIn and GitHub profile ingestion via API
- **Outreach agents** — draft and send personalised candidate messages
- **Automation integrations** — trigger workflows from ATS events or external systems
- **Multi-provider workflows** — route different steps to different models or services
- **Evaluation templates** — per-role scoring rubrics and structured interview kits

---

## License

MIT
