# Daneel

*The open-source agentic workflow engine for recruiting.*

Give Daneel a job description and a list of candidates. It runs an agentic workflow — sourcing, enrichment, scoring, deliberation — and produces a ranked shortlist with an auditable hiring report. Every step is a pluggable provider, so you can swap models, add your own scoring logic, or wire in any external system.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](#)

[⭐ Star on GitHub](https://github.com/gregherbe76/Recruit-Pipeline) · [📖 Docs](DEVELOPER_GUIDE.md) · [🚀 Live demo coming soon](#)

---

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

Every step is a pluggable provider. Swap, extend, or replace anything.

---

## The Provider Marketplace

Daneel ships with built-in providers, optional commercial ones, and BYOK third-party connectors. Mix and match per workflow step.

### Built-in (free, ship with the engine)

| Provider | What it does | Key required |
|---|---|---|
| **Native OpenAI** | Job understanding, candidate matching, shortlist generation | `OPENAI_API_KEY` (BYOK) |
| **GitHub Public Search** | Sources candidates via the public GitHub REST API | None (optional `GITHUB_TOKEN` for higher rate limits) |
| **SerpAPI Web Search** | Sources candidates from public LinkedIn / GitHub profile pages | `SERPAPI_KEY` (BYOK) |
| **Apify Actors** | Runs Apify actors for sourcing or enrichment | `APIFY_TOKEN` (BYOK) |
| **Custom Webhook** | Routes any step to your own HTTP endpoint | None |

### Commercial providers ⭐

| Provider | What it does | Maintainer | Status |
|---|---|---|---|
| **A-Player Scout** | Job description → boolean LinkedIn shortlist | A-Player | Live |
| **Extend** | Pattern-match candidates from example profiles | A-Player | Live |
| **CodeMatch** | GitHub-based technical evaluation | A-Player | Live |
| **Council** | 15-persona hiring deliberation (multi-LLM) | A-Player | Live |

### Third-party connectors (BYOK)

| Connector | What it does | What you bring |
|---|---|---|
| **Twin Agent Browser** | Routes sourcing or enrichment to Twin's browser-agent runtime | Your own Twin account + templates |
| **Custom Webhook** | Plug in any other agent system, n8n flow, or internal service | Your own endpoint |

All commercial providers are optional. The engine is fully functional with built-in and BYOK providers. See [VISION.md](VISION.md) for full commercial disclosure.

---

## Quick Start

```bash
git clone https://github.com/gregherbe76/Recruit-Pipeline daneel
cd daneel
cp .env.example .env
docker compose up
```

Then open <http://localhost:5173>. The Native OpenAI provider needs your `OPENAI_API_KEY` in `.env`. Other providers can be added from the marketplace UI under **Settings → Agent Providers**.

`docker compose up` pulls prebuilt images from GHCR (`ghcr.io/gregherbe76/daneel-api`, `ghcr.io/gregherbe76/daneel-web`), so first boot is a quick image download instead of a multi-minute build. Postgres, the API server, and the frontend come up together; the schema is pushed and a small demo dataset is seeded automatically. Re-running is safe — the seed step is idempotent.

To stop and wipe the database volume: `docker compose down -v`.

### Local development without Docker

If you want to hack on the code with hot reload and direct access to a local Postgres, follow the pnpm workspace setup in [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md). It covers Node 20+ / pnpm 9+ install, environment variables, schema push, and running the API and web artifacts in separate terminals.

---

## Architecture for builders

Daneel separates the UI, the workflow engine, the provider layer, and the data store. Anything that talks to a model, an external API, or a webhook lives behind the provider interface — not in the engine.

```
┌────────────────────────────────────────────────┐
│                ATS Core (UI)                   │
│  Jobs · Candidates · Pipeline · Reports        │
│  React + Vite + Tailwind + shadcn/ui           │
│  artifacts/recruiting-os/                      │
└───────────────────┬────────────────────────────┘
                    │  REST API (OpenAPI → typed hooks + Zod)
┌───────────────────▼────────────────────────────┐
│           Agentic Workflow Engine              │
│  job_understanding · sourcing · enrichment     │
│  candidate_matching · shortlist · decision     │
│  artifacts/api-server/src/routes/workflows/    │
└───────────────────┬────────────────────────────┘
                    │  AgentProvider.run({ step, payload })
┌───────────────────▼────────────────────────────┐
│             Provider Layer                     │
│  Built-in · Commercial · BYOK connectors       │
│  Resolved per step from the marketplace UI     │
└───────────────────┬────────────────────────────┘
                    │
┌───────────────────▼────────────────────────────┐
│          PostgreSQL + Drizzle ORM              │
│  lib/db/   schema · types · push               │
└────────────────────────────────────────────────┘
```

Every workflow step calls `provider.run({ step, payload })` and stores the result. The engine never knows whether the work was done by a built-in OpenAI prompt, a commercial provider, a Twin browser agent, or your own webhook — that's the whole point of the contract.

---

## Use this repo as a template

| Goal | What to change |
|---|---|
| Swap the AI model or provider | Add a new `AgentProvider` class |
| Change how candidates are scored | Edit the scoring prompt in `native-openai.ts` |
| Change scoring weights or dimensions | Update the rubric weights in the prompt |
| Add a new workflow step | Register it in `engine.ts` and `interface.ts` |
| Connect an external AI system | Use `TwinWebhookProvider` or `CustomWebhookProvider` |
| Change what goes in the report | Edit `artifacts/api-server/src/routes/reports.ts` |
| Add a data field to candidates | Update the Drizzle schema → `pnpm --filter @workspace/db run push` |
| Add a new UI page | Drop a file in `artifacts/recruiting-os/src/pages/` |
| Add a new API endpoint | Add a route in `artifacts/api-server/src/routes/` and register it in `openapi.yaml` |
| Re-skin the UI for a different audience | Add a template under `lib/branding/src/templates/` and set `APP_TEMPLATE` |

Full extension guide: [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

---

## Examples

Step-by-step recipes for the most common extensions:

- [examples/custom-provider.md](examples/custom-provider.md) — implement the `AgentProvider` interface to plug in any model, vendor, or internal AI system.
- [examples/custom-scoring-rubric.md](examples/custom-scoring-rubric.md) — change scoring dimensions, weights, and recommendation thresholds.
- [examples/twin-provider.md](examples/twin-provider.md) — route one or more steps to a Twin Agent Browser flow via the BYOK connector.
- [examples/custom-workflow.md](examples/custom-workflow.md) — add a new step (background screening, culture fit, outreach draft, reference check) without rewriting the engine.

---

## Roadmap

- Live demo at `demo.daneel.dev`
- Extend provider (Phase 3)
- CodeMatch evaluation provider (Phase 4)
- Bias auditing module (EU AI Act)
- More built-in sources (Greenhouse import, Lever import)
- Multi-tenant white-label mode

---

## Disclosure & License

Daneel is MIT-licensed and the engine is fully functional without any commercial provider. Commercial providers (Scout, Extend, CodeMatch, Council) are maintained by A-Player and ship as optional plug-ins; they are listed in the marketplace UI but never required for the core workflow. Full commercial framing and the "engine ↔ providers ↔ connectors" model is documented in [VISION.md](VISION.md). License terms in [LICENSE](LICENSE).

## Built by

Built by [Greg Herbé](https://www.linkedin.com/in/gregherbe), Operating Partner @ Twin and founder of A-Player.
