# HiringAI — First Public Release

## What HiringAI is

HiringAI is an open-source agentic recruiting product for founders and hiring leads. You describe the role, drop in a list of candidates, and an AI workflow scores, ranks, and shortlists them with explanations you can audit.

It is built as a single coherent product on top of a reusable engine (Daneel) and ships with three brand templates (HiringAI, HireFlow, ShortlistPro) so the same engine can be re-skinned for different audiences.

## What Daneel is

Daneel is the underlying engine that powers HiringAI. It is decoupled from the UI and from any specific brand. Daneel owns:

- The 4-step agentic workflow (Job Understanding → Sourcing → Candidate Matching → Shortlist Generation)
- The provider abstraction layer (which AI handles each step)
- The scoring contract (3-dimension rubric, three complementary scores)
- The data model (jobs, candidates, applications, evaluations, runs, logs)

Daneel is what stays stable. Templates are what changes.

## Main workflow

1. **Add a job** — title, description, must-have skills, scoring weights across the 3 dimensions
2. **Add candidates** — paste profiles, upload, or let the AI source mock candidates for the role
3. **Run AI Workflow** — Daneel runs all 4 steps, scores every candidate, and produces a top-5 shortlist
4. **View the report** — read the per-candidate breakdown, edit narratives, export to PDF or Markdown

## Key differentiators

### Triple scoring
Every candidate gets three complementary scores, not one opaque number:

| Score | Computed by | What it means |
|---|---|---|
| **Fit Score** | AI | How well the candidate matches the rubric (autonomy, product mindset, impact) |
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

### Provider layer
Every workflow step (`job_understanding`, `candidate_matching`, `shortlist_generation`, `sourcing`) has a configurable provider. Out of the box: native OpenAI. Pluggable: any custom webhook, with optional twin-context metadata. Configure per-step in Settings → Agent Providers.

### Templates
One product, three templates:

| Template | Audience | Voice |
|---|---|---|
| **HiringAI** (default) | founders & hiring leads | direct, startup-tuned |
| **HireFlow** | TA teams | formal, ATS / compliance |
| **ShortlistPro** | agency recruiters | polished, client-facing |

Switching is one env var (`APP_TEMPLATE` / `VITE_APP_TEMPLATE`). Each template ships its own brand colors, product name, primary user vocabulary, and full prompt pack with its own voice. The engine, schema, and JSON output contract stay identical across all three.

## Known limitations

- **Single-tenant** — no auth, no organizations, no per-user data isolation. The team roster is a hard-coded HR list. Run one instance per company.
- **No native job board multiposting** — there is no integration with LinkedIn Jobs, Indeed, Welcome to the Jungle, or any other board. Job posts live inside HiringAI only.
- **No direct LinkedIn integration** — candidate profiles are added by paste, upload, or AI sourcing (mock). There is no LinkedIn API, no scraper, no Sales Navigator hook.
- **Templates are mostly branding + prompt-level** — switching templates changes the product name, colors, and the AI's voice. It does not yet change the rubric, the workflow steps, the data model, or the bulk of UI string literals. Deeper template-driven customization (per-template rubrics, terms maps, stage labels) is defined in the template schema but not yet consumed end-to-end.
