# Daneel

*The open-source agentic workflow engine for recruiting.*

Take a job description. Run an agentic workflow. Get a ranked shortlist and a hiring report. Every step is a pluggable provider — swap, extend, or replace anything.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-98%25-blue.svg)
![CI](https://img.shields.io/badge/tests-passing-green.svg)

⭐ Star on GitHub · 📖 [Docs](DEVELOPER_GUIDE.md) · 🚀 Live demo coming soon

---

## What Daneel is

Daneel is an MIT-licensed, self-hostable runtime that turns a job description into a ranked, auditable shortlist by orchestrating AI agents through a 4-step workflow: **job understanding → sourcing → matching → shortlist**.

It is **not** a closed SaaS, **not** a candidate database, and **not** another opaque scoring black box. The engine ships with the boring-but-critical plumbing — provider routing, evaluations, audit logs, soft deletes, mentions, team collaboration — so any provider, model, or scoring strategy plugs in without rewriting the pipeline.

Every workflow step calls `provider.run({ step, payload })`. **You bring the keys, you keep the data, you control what runs on the other side.** Daneel never bundles or resells provider quota.

## What Daneel does

```
Job description → workflow → ranked shortlist + hiring report
                   │
                   ├─ understands the job
                   ├─ sources candidates       (optional)
                   ├─ enriches profiles        (optional)
                   ├─ scores against rubric
                   ├─ deliberates              (optional, multi-LLM)
                   └─ produces report
```

Every candidate gets three complementary scores — **Fit** (rubric match), **Data Confidence** (how much profile we actually had), **Decision** (Fit discounted by Confidence) — so a thin profile can never beat a complete one on raw model output. Hiring decisions stay grounded in real evidence.

---

## Quick Start

```bash
git clone https://github.com/gregherbe76/daneel
cd daneel
cp .env.example .env
docker compose up
```

The first boot pulls prebuilt images from GHCR. Once healthy:

- App UI: <http://localhost:5173>
- API health: <http://localhost:3000/api/healthz>

Add your `OPENAI_API_KEY` to `.env` for the Native OpenAI provider; every other provider is wired up at runtime from **Settings → Marketplace**. For local development without Docker, see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

### Switching templates

Daneel ships with two UI templates. Switch with `APP_TEMPLATE` (server) and `VITE_APP_TEMPLATE` (web build); the engine, schema, and JSON contract stay identical.

| Template   | Variable (server)        | Variable (web build)         | Tone                                                 |
| ---------- | ------------------------ | ---------------------------- | ---------------------------------------------------- |
| `daneel`   | `APP_TEMPLATE=daneel`    | `VITE_APP_TEMPLATE=daneel`   | **Default.** Neutral recruiting vocabulary.          |
| `hiringai` | `APP_TEMPLATE=hiringai`  | `VITE_APP_TEMPLATE=hiringai` | Startup-tuned: founder-friendly copy, tighter funnel.|

---

## The Provider model (BYOK)

Daneel's value is in its provider ecosystem. Three categories ship with the engine — all optional, all replaceable.

### Built-in providers (free or BYOK)

| Provider                  | What it does                                  | Auth                                  |
| ------------------------- | --------------------------------------------- | ------------------------------------- |
| Native OpenAI             | Default scoring, sourcing, enrichment         | BYOK (`OPENAI_API_KEY`)               |
| GitHub public search      | Open-source candidate discovery               | None (optional `GITHUB_TOKEN`)        |
| SerpAPI                   | Google-powered web-search sourcing            | BYOK                                  |
| Apify                     | LinkedIn / Bing / Google scraper sourcing     | BYOK                                  |
| Custom Webhook            | Any HTTP POST endpoint                        | None                                  |

### Third-party connectors (BYOK)

Technical integrations, not commercial offerings of the project maintainer.

| Connector             | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| Twin Agent Browser    | Bring your own Twin account and templates                  |
| Custom Webhook        | Any other HTTP service                                     |

### Commercial extensions ⭐

Four paid, hosted services maintained by the project author plug into Daneel through the **same public provider interface** any third-party developer can use. All are optional. The engine works fully without any of them.

| Product                | What it does                                             | Domain             |
| ---------------------- | -------------------------------------------------------- | ------------------ |
| **A-Player Scout** \*  | Job description → boolean LinkedIn shortlist             | `aplayerscout.com` |
| **Extend** \*          | Pattern-match candidates from example "look-alike" profiles | `extend.hr`     |
| **CodeMatch** \*       | GitHub-based technical evaluation of engineers           | `codematch.dev`    |
| **Council** \*         | 15-persona multi-LLM hiring deliberation                 | `council.hr`       |

\* Commercial offerings from the project maintainer. See [VISION.md](VISION.md) → "Commercial Disclosure" for the full statement.

---

## Architecture for builders

```
┌────────────────────────────────────────────────┐
│                ATS Core (UI)                   │
│  Jobs · Candidates · Pipeline · Reports        │
│  React + Vite + Tailwind + shadcn/ui           │
└───────────────────┬────────────────────────────┘
                    │  REST API (OpenAPI → typed hooks + Zod)
┌───────────────────▼────────────────────────────┐
│           Agentic Workflow Engine              │
│  job_understanding · sourcing · enrichment     │
│  candidate_matching · technical_evaluation     │
│  shortlist · decision                          │
└───────────────────┬────────────────────────────┘
                    │  AgentProvider / EvaluationProvider
┌───────────────────▼────────────────────────────┐
│             Provider Layer                     │
│  Built-in · BYOK connectors · Commercial ⭐    │
└───────────────────┬────────────────────────────┘
                    │
┌───────────────────▼────────────────────────────┐
│          PostgreSQL + Drizzle ORM              │
└────────────────────────────────────────────────┘
```

### Data modes

Daneel enforces strict separation between simulated and real candidate data. Reports are clearly labelled; mock and real data are never silently mixed.

- **mock** — AI-generated profiles only. Demos, tests, development.
- **real** — Imported and provider-sourced candidates only. Production mode.
- **fallback** — Imported only, triggered automatically when a sourcing provider fails.

---

## Extend this repo

| Goal                                       | Where to go                                                 |
| ------------------------------------------ | ----------------------------------------------------------- |
| Add a new AI provider                      | [examples/custom-provider.md](examples/custom-provider.md) |
| Change the scoring rubric                  | [examples/custom-scoring-rubric.md](examples/custom-scoring-rubric.md) |
| Connect an external system via webhook     | [examples/twin-provider.md](examples/twin-provider.md)     |
| Add a new workflow step                    | [examples/custom-workflow.md](examples/custom-workflow.md) |
| White-label the UI                         | Add a template under `lib/branding/src/templates/<your-brand>/` and set `APP_TEMPLATE` / `VITE_APP_TEMPLATE`. |

Full extension guide: [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

---

## Roadmap

- ✅ Native OpenAI, GitHub, SerpAPI, Apify, Custom Webhook providers
- ✅ Twin Agent Browser BYOK connector
- ✅ A-Player Scout, Extend integrations
- ✅ CodeMatch technical evaluation provider
- ✅ Council multi-LLM deliberation provider
- 🔜 Live demo at `demo.daneel.dev`
- 🔜 Bias auditing module
- 🔜 Multi-tenant white-label mode

---

## Disclosure & License

Four commercial provider products (**A-Player Scout** \*, **Extend** \*, **CodeMatch** \*, **Council** \*) are maintained by the project author, [Greg Herbé](https://www.linkedin.com/in/gregherbe) / A-Player. They integrate with Daneel through the same public provider interface any third party can use. They are paid, hosted services. **The Daneel engine itself works fully end-to-end with built-in and BYOK providers — you never need an A-Player subscription to run, fork, self-host, or extend Daneel.** See [VISION.md](VISION.md) for the full disclosure.

Daneel includes opt-in usage telemetry. Disabled by default, fully documented in [docs/TELEMETRY.md](docs/TELEMETRY.md).

Licensed under [MIT](LICENSE) © 2025–2026 Greg Herbé.

---

## Built by

[Greg Herbé](https://www.linkedin.com/in/gregherbe), Operating Partner at Twin and founder of A-Player.
