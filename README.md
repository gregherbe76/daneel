# Agentic Recruiting OS

**From job brief to shortlist, powered by AI agents.**

Open-source control layer for agentic recruiting workflows.

Stop using ATS as data entry tools.  
Start using them as execution layers for AI.

---

## What this is

Agentic Recruiting OS is not an ATS.

It is a control layer where:
- you define the job
- agents do the analysis
- you get a decision

Instead of manually:
- reading CVs
- writing scorecards
- building shortlists

You run a workflow.

The system:
- understands the job
- scores candidates
- generates new ones (optional)
- produces a shortlist
- exports a hiring report

You stay in control.  
The agents do the work.

---

## Demo flow

1. Create a job
2. Click "Run AI Workflow"
3. (Optional) Generate new candidates
4. Get structured job insights
5. Score all candidates (0–100)
6. Generate a ranked shortlist
7. Export a hiring report (Markdown or PDF)

**Output:** a clear answer to  
→ "Who should I interview and why?"

---

## Features

- **Minimal ATS core** — Jobs, candidates, pipeline — nothing more

- **Agentic workflow engine** — Multi-step, async, fully logged

- **Job Understanding** — Turns a job description into structured evaluation criteria

- **AI Matching** — Scores every candidate with explainable reasoning

- **Sourcing (mock)** — Generates realistic candidate profiles to seed the pipeline

- **Shortlist Generation** — Ranked top candidates with hiring summaries

- **Exportable Reports** — Markdown + PDF, ready to share with hiring managers

- **Pluggable Agent Providers** — Native OpenAI, custom webhooks, Twin-ready

---

## Why this exists

Recruiting is still manual.

Even with modern tools, most teams:
- read CVs manually
- write scorecards manually
- build shortlists manually

ATS are:
- heavy
- rigid
- built for enterprise workflows

AI tools are:
- fragmented
- disconnected
- hard to trust

Agentic Recruiting OS solves this:

- One control layer
- Agents do the work
- Every step is logged and inspectable
- You can swap providers anytime

This is not "AI inside an ATS".

This is a system where:  
**the ATS becomes the execution layer for agents.**

---

## Positioning

This is not:
- an ATS
- a sourcing tool
- a recruiting CRM

This is:  
**an agentic recruiting system**

Job → workflow → shortlist → decision

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

```env
DATABASE_URL=postgresql://user:password@localhost:5432/recruiting_os
SESSION_SECRET=your-session-secret
```

For AI workflows, connect an OpenAI-compatible provider via Settings → Agent Providers in the UI.

### Database

```bash
pnpm --filter @workspace/db run push
```

Seed data is included to test the full workflow immediately.

### Run

```bash
# API server
pnpm --filter @workspace/api-server run dev

# Frontend
pnpm --filter @workspace/recruiting-os run dev
```

### Codegen (after changing the API spec)

```bash
pnpm --filter @workspace/api-spec run codegen
```

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

---

## Roadmap

- Real sourcing — LinkedIn, GitHub
- Outreach agents — automated candidate contact
- Automation integrations — n8n, Zapier, Twin
- Multi-provider workflows
- Evaluation templates
- Multi-agent orchestration (parallel workflows, decision consensus)

---

## License

MIT
