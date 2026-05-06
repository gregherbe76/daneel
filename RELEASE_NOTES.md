# Daneel — First Public Release

## What Daneel is

Daneel is an open-source, MIT-licensed agentic recruiting workflow engine.

You describe a role, plug in your own AI providers (OpenAI, GitHub, SerpAPI, Apify, custom webhooks…), and Daneel runs a 4-step workflow that sources candidates, scores them, and produces a ranked shortlist with auditable explanations.

The default UI ships as **Daneel** — neutral recruiting vocabulary, the engine's own brand. A second template, **HiringAI**, ships in the same repository as a startup-tuned alternative skin (founder-friendly copy, compressed funnel labels). Switching templates is one env var (`APP_TEMPLATE` / `VITE_APP_TEMPLATE`); the engine, schema, and JSON output contract stay identical.

## Main workflow

1. **Add a job** — title, description, must-have skills, scoring weights across the 3 dimensions
2. **Add candidates** — paste profiles, upload, or let a sourcing provider find new ones (GitHub, web search, Twin Agent Browser, mock)
3. **Run the workflow** — Daneel runs all 4 steps end-to-end, scores every candidate, and produces a top-5 shortlist
4. **View the report** — read the per-candidate breakdown, edit narratives, export to PDF or Markdown

## Key differentiators

### Triple scoring
Every candidate gets three complementary scores, not one opaque number:

| Score | Computed by | What it means |
|---|---|---|
| **Fit Score** | AI provider | How well the candidate matches the rubric (autonomy, product mindset, impact) |
| **Data Confidence Score** | Engine | How much profile data we actually had to judge them on |
| **Decision Score** | Engine | Fit Score discounted by Data Confidence — the score that drives ranking |

A high Fit Score on a thin profile will not beat a medium Fit Score on a complete profile. Decisions stay honest.

### Data confidence
Every evaluation carries a confidence level (High / Medium / Low) derived from profile completeness — enrichment status, LinkedIn presence, skills count, summary length, headline. Surfaced as a badge on every candidate card and called out in a dedicated "Score Reliability" section on the report.

### Enrichment-first
Before scoring, the engine pre-screens each candidate. If data confidence is below 50 and an enrichment provider is configured, the engine enriches the profile **before** sending it to the AI. If no enrichment provider is available, the candidate is still scored, but flagged as "Enrich recommended" so you know not to over-trust the result.

The workflow never blocks. Enrichment failures degrade gracefully.

### No fabrication
The AI is constrained to score only on data it actually received. Missing data shows up as missing-data warnings, not as invented strengths. Hiring decisions stay grounded in real evidence.

### Provider layer (BYOK — Bring Your Own Keys)
Every workflow step (`job_understanding`, `candidate_matching`, `shortlist_generation`, `sourcing`, `enrichment`, `decision`) has a configurable provider. Out of the box: native OpenAI for the AI steps. Pluggable: GitHub, SerpAPI, Apify, Twin Agent Browser, Council, or any custom webhook with optional twin-context metadata. Configure per-step in Settings → Agent Providers. Daneel never bundles or resells provider quota — operators bring their own keys.

### Templates
Two templates ship in this release: **Daneel** (default — neutral recruiting vocabulary) and **HiringAI** (startup-tuned — founder-friendly copy, compressed funnel labels). Each template owns its own brand colors, product name, terminology, stage labels, and full prompt pack. Engine, schema, and JSON output contract are template-agnostic.

## Demo flow (60 seconds)

1. **Create or open a job** — set title, description, and the 3 scoring weights
2. **Add candidates** — paste profiles, upload, or let a sourcing provider source new ones
3. **Run the workflow** — one click triggers all 4 Daneel steps end-to-end
4. **Show decision summary** — top-5 shortlist with Fit / Confidence / Decision scores, why-relevant, key risks, recommendation
5. **Export PDF** — branded report, ready to share

## Known limitations

- **Single-tenant** — no auth, no organizations, no per-user data isolation. The team roster is a hard-coded HR list. Run one instance per company.
- **No native job board multiposting** — there is no integration with LinkedIn Jobs, Indeed, Welcome to the Jungle, or any other board. Job posts live inside Daneel only.
- **No direct LinkedIn integration** — candidate profiles are added by paste, upload, or by sourcing providers (GitHub, web search, Twin Agent Browser, mock). There is no LinkedIn API, no scraper, no Sales Navigator hook.
- **Templates are mostly branding + prompt-level** — switching templates changes the product name, colors, copy, and the AI's voice. It does not yet change the rubric, the workflow steps, the data model, or the bulk of UI string literals. Deeper template-driven customization (per-template rubrics, full terms maps, stage label propagation) is defined in the template schema but not yet consumed end-to-end.
