# Daneel

*The open-source agentic workflow engine for recruiting.*

Take a job description. Run an agentic workflow. Get a ranked shortlist and a hiring report. Every step is a pluggable provider — swap, extend, or replace anything.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-98%25-blue.svg)
![CI](https://img.shields.io/badge/tests-passing-green.svg)

⭐ Star on GitHub · 📖 [Docs](DEVELOPER_GUIDE.md) · 🚀 Live demo coming soon

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

Every step is a pluggable provider. The engine calls `provider.run({ step, payload })` and stores the result. You decide what runs on the other side.

---

## The Provider Marketplace

Daneel's value is in its provider ecosystem. Three categories ship with the engine.

### Built-in providers

| Provider | What it does | Auth |
|---|---|---|
| Native OpenAI | Default scoring, sourcing, enrichment | BYOK |
| GitHub Public | Open-source candidate discovery | None |
| SerpAPI | Google-powered search | BYOK |
| Apify | LinkedIn and web scraping | BYOK |
| Custom Webhook | Any HTTP POST endpoint | None |

### Commercial providers ⭐

Maintained by the project author. All optional. The engine works fully without them.

| Provider | What it does | Maintainer | Status |
|---|---|---|---|
| **A-Player Scout** | Job description → boolean LinkedIn shortlist | A-Player | Live |
| **Extend** | Pattern-match candidates from example profiles | A-Player | Live |
| **CodeMatch** | GitHub-based technical evaluation | A-Player | Live |
| **Council** | 15-persona hiring deliberation (multi-LLM) | A-Player | Live |

### Third-party connectors (BYOK)

| Connector | Description |
|---|---|
| Twin Agent Browser | Bring your own Twin account and templates |
| Custom Webhook | Any other HTTP service |

See [VISION.md](VISION.md) for the full commercial disclosure.

---

## Quick Start

```bash
git clone https://github.com/gregherbe76/daneel
cd daneel
cp .env.example .env
docker compose up
```

The first boot pulls prebuilt images from GitHub Container Registry. Once healthy:

- App UI: <http://localhost:5173>
- API: <http://localhost:3000/api/healthz>

You'll need an `OPENAI_API_KEY` in `.env` for the Native OpenAI provider. Other providers can be added from the marketplace UI at runtime.

For local development without Docker, see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

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
│  candidate_matching · shortlist · decision     │
└───────────────────┬────────────────────────────┘
                    │  AgentProvider interface
┌───────────────────▼────────────────────────────┐
│             Provider Layer                     │
│  Built-in · Commercial ⭐ · BYOK connectors    │
└───────────────────┬────────────────────────────┘
                    │
┌───────────────────▼────────────────────────────┐
│          PostgreSQL + Drizzle ORM              │
└────────────────────────────────────────────────┘
```

---

## Data modes

Daneel enforces strict separation between simulated and real candidate data:

- **mock** — AI-generated profiles only. Used for demos, tests, development.
- **real** — Imported and provider-sourced candidates only. Production mode.
- **fallback** — Imported only, triggered when a sourcing provider fails.

Reports are clearly labelled. Mock and real data are never silently mixed.

---

## Extend this repo

| Goal | Where to go |
|---|---|
| Add a new AI provider | [examples/custom-provider.md](examples/custom-provider.md) |
| Change the scoring rubric | [examples/custom-scoring-rubric.md](examples/custom-scoring-rubric.md) |
| Connect an external system via webhook | [examples/twin-provider.md](examples/twin-provider.md) |
| Add a new workflow step | [examples/custom-workflow.md](examples/custom-workflow.md) |
| White-label the UI | Add a template under `lib/branding/src/templates/` and set `APP_TEMPLATE` (server) or `VITE_APP_TEMPLATE` (frontend). Daneel ships with two templates: `daneel` (default) and `hiringai` (alternative example). |

Full extension guide: [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

### White-label templates

Daneel ships with a pluggable branding system. Switch between templates via the `APP_TEMPLATE` (server) and `VITE_APP_TEMPLATE` (frontend) environment variables. Two templates are included out of the box:

- `daneel` — the default open-source branding
- `hiringai` — an example alternative template, showing how agencies or partners can re-skin the UI without touching the engine

Add your own template under `lib/branding/src/templates/<your-brand>/` following the same structure.

---

## Roadmap

- Live demo at demo.daneel.dev
- Extend provider integration (Phase 3)
- CodeMatch evaluation provider (Phase 4)
- Council deliberation provider (Phase 5)
- Bias auditing module
- Multi-tenant white-label mode

---

## Disclosure & License

Four commercial providers (A-Player Scout, Extend, CodeMatch, Council) are maintained by the project author. All providers are optional and the engine works fully with built-in and BYOK providers. See [VISION.md](VISION.md) for full commercial disclosure.

Daneel includes opt-in usage telemetry. Disabled by default, fully documented in [docs/TELEMETRY.md](docs/TELEMETRY.md).

Licensed under [MIT](LICENSE).

---

## Built by

[Greg Herbé](https://www.linkedin.com/in/gregherbe), Operating Partner at Twin and founder of A-Player.
