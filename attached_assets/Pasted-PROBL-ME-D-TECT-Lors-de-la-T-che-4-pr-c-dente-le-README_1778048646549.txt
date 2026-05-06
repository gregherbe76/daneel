PROBLÈME DÉTECTÉ

Lors de la Tâche 4 précédente, le README a été mis à jour de manière 
incrémentale au lieu d'être réécrit selon la nouvelle structure 
demandée. Le contenu actuel sur main contient encore les anciennes 
sections ("What this is", "Use this repo as a template" en position 
2, "What can be customized", "Project structure", "Demo flow", etc.) 
qui auraient dû être supprimées ou réorganisées.

GOAL

Réécrire RÉELLEMENT le README from scratch, en supprimant tout le 
contenu actuel et en repartant d'une page blanche selon la structure 
ci-dessous. Ce n'est PAS une mise à jour. C'est un remplacement complet.

ÉTAPE 0 — Sauvegarde

Avant toute modification, copie le README actuel dans /docs/README-old.md 
pour archive. On pourra le supprimer plus tard.

ÉTAPE 1 — Suppression complète du README

Vide entièrement le contenu de README.md à la racine. Le fichier doit 
être à 0 ligne avant que tu ne réécrives.

ÉTAPE 2 — Réécriture complète selon cette structure EXACTE

Dans cet ordre, sans ajouter de sections non listées, sans omettre 
de sections listées :

[BLOC 1 — HERO, environ 12 lignes]

# Daneel

*The open-source agentic workflow engine for recruiting.*

Take a job description. Run an agentic workflow. Get a ranked shortlist 
and a hiring report. Every step is a pluggable provider — swap, extend, 
or replace anything.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-98%25-blue.svg)
![CI](https://github.com/gregherbe76/daneel/actions/workflows/<NOM_DU_WORKFLOW>.yml/badge.svg)

⭐ Star on GitHub · 📖 [Docs](DEVELOPER_GUIDE.md) · 🚀 Live demo coming soon

---

[BLOC 2 — WHAT DANEEL DOES, environ 20 lignes]

## What Daneel does
Job description → workflow → ranked shortlist + hiring report
│
├─ understands the job
├─ sources candidates       (optional)
├─ enriches profiles        (optional)
├─ scores against rubric
├─ deliberates              (optional, multi-LLM)
└─ produces report

Every step is a pluggable provider. The engine calls 
`provider.run({ step, payload })` and stores the result. You decide 
what runs on the other side.

---

[BLOC 3 — PROVIDER MARKETPLACE — SECTION CENTRALE]

## The Provider Marketplace

Daneel's value is in its provider ecosystem. Three categories ship with 
the engine.

### Built-in providers

| Provider | What it does | Auth |
|---|---|---|
| Native OpenAI | Default scoring, sourcing, enrichment | BYOK |
| GitHub Public | Open-source candidate discovery | None |
| SerpAPI | Google-powered search | BYOK |
| Apify | LinkedIn and web scraping | BYOK |
| Custom Webhook | Any HTTP POST endpoint | None |

### Commercial providers ⭐

Maintained by the project author. All optional. The engine works fully 
without them.

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

[BLOC 4 — QUICK START]

## Quick Start

```bash
git clone https://github.com/gregherbe76/daneel
cd daneel
cp .env.example .env
docker compose up
```

The first boot pulls prebuilt images from GitHub Container Registry. 
Once healthy:

- App UI: http://localhost:5173
- API: http://localhost:3000/api/healthz

You'll need an OPENAI_API_KEY in `.env` for the Native OpenAI provider. 
Other providers can be added from the marketplace UI at runtime.

For local development without Docker, see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

---

[BLOC 5 — ARCHITECTURE]

## Architecture for builders
┌────────────────────────────────────────────────┐
│                ATS Core (UI)                   │
│  Jobs · Candidates · Pipeline · Reports        │
│  React + Vite + Tailwind + shadcn/ui           │
└───────────────────┬────────────────────────────┘
│  REST API (OpenAPI → typed hooks + Zod)
┌───────────────────▼────────────────────────────┐
│          Agentic Workflow Engine                │
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

---

[BLOC 6 — DATA MODES]

## Data modes

Daneel enforces strict separation between simulated and real candidate 
data:

- **mock** — AI-generated profiles only. Used for demos, tests, development.
- **real** — Imported and provider-sourced candidates only. Production mode.
- **fallback** — Imported only, triggered when a sourcing provider fails.

Reports are clearly labelled. Mock and real data are never silently mixed.

---

[BLOC 7 — EXTEND THIS REPO]

## Extend this repo

| Goal | Where to go |
|---|---|
| Add a new AI provider | [examples/custom-provider.md](examples/custom-provider.md) |
| Change the scoring rubric | [examples/custom-scoring-rubric.md](examples/custom-scoring-rubric.md) |
| Connect an external system via webhook | [examples/twin-provider.md](examples/twin-provider.md) |
| Add a new workflow step | [examples/custom-workflow.md](examples/custom-workflow.md) |
| White-label with a different brand | See `lib/branding/templates/` |

Full extension guide: [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

---

[BLOC 8 — ROADMAP]

## Roadmap

- Live demo at demo.daneel.dev
- Extend provider integration (Phase 3)
- CodeMatch evaluation provider (Phase 4)
- Council deliberation provider (Phase 5)
- Bias auditing module
- Multi-tenant white-label mode

---

[BLOC 9 — DISCLOSURE & LICENSE]

## Disclosure & License

Four commercial providers (A-Player Scout, Extend, CodeMatch, Council) 
are maintained by the project author. All providers are optional and 
the engine works fully with built-in and BYOK providers. See 
[VISION.md](VISION.md) for full commercial disclosure.

Daneel includes opt-in usage telemetry. Disabled by default, fully 
documented in [docs/TELEMETRY.md](docs/TELEMETRY.md).

Licensed under [MIT](LICENSE).

---

[BLOC 10 — BUILT BY]

## Built by

[Greg Herbé](https://www.linkedin.com/in/gregherbe), Operating Partner 
at Twin and founder of A-Player.

ÉTAPE 3 — Identifier le bon nom du workflow CI

Avant d'écrire le badge CI dans le Hero (BLOC 1), regarde le contenu 
de .github/workflows/. Liste-moi les fichiers qui s'y trouvent. 
Choisis celui qui exécute les tests (généralement nommé ci.yml, 
test.yml, build.yml, ou similaire). Si aucun n'exécute de tests, 
remplace le badge CI par un badge statique :
![CI](https://img.shields.io/badge/tests-passing-green.svg)
et signale-le moi dans le chat.

ÉTAPE 4 — Vérification avant push

Une fois le README réécrit :
- Vérifier qu'aucune section "What this is", "What can be customized", 
  "Project structure", "Demo flow", "Replit-native setup" ne subsiste
- Vérifier que les 10 blocs ci-dessus sont présents dans le bon ordre
- Vérifier que les liens internes (VISION.md, LICENSE, DEVELOPER_GUIDE.md, 
  examples/*.md, docs/TELEMETRY.md) pointent vers des fichiers qui 
  existent réellement
- Compter les lignes du fichier final — devrait être entre 130 et 180 
  lignes

ÉTAPE 5 — Commit et push

Un seul commit avec ce message exact :
"docs: full rewrite of README per Phase 1 spec (4 commercial providers, 
BYOK connectors, marketplace-centric)"

Push immédiatement vers main.

DELIVERABLE OBLIGATOIRE FORMAT EXACT

Après le push, tu DOIS me coller dans le chat ces 4 informations :
1. Commit hash : <le sha7 du commit>
2. URL GitHub directe vers le README sur main : 
   https://github.com/gregherbe76/daneel/blob/main/README.md
3. Le nom du workflow CI choisi (ou "aucun, badge statique utilisé")
4. Le nombre de lignes du README final

Si l'une de ces 4 informations ne peut pas être fournie parce que le 
push est bloqué ou échoué, ARRÊTE et signale l'erreur précise. Ne dis 
pas "task done" tant que ces 4 informations ne sont pas vérifiables.

CONTRAINTES STRICTES

- Aucune modification de VISION.md, NAMING.md, LICENSE, le code, les 
  tests, la config
- Aucune section additionnelle non listée dans les 10 blocs
- Aucun "Replit-native setup" — le contenu Replit-spécifique appartient 
  à DEVELOPER_GUIDE.md, pas au README marketing
- Aucun arbre "Project structure" — non pertinent pour le README marketing
- Aucun "Demo flow" — redondant avec le bloc "What Daneel does"
- Aucune section "What can be customized" — fusionnée dans "Extend this 
  repo"

STOP

Après le push et le report des 4 informations, attends ma validation 
finale. Je vais vérifier sur GitHub avant de clôturer Tâche 4.