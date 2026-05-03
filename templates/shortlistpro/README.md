# ShortlistPro Template

ShortlistPro re-skins the Recruiting OS for **recruitment & staffing agencies**.

## Who it's for

External recruiters who source candidates on behalf of multiple client companies, and live or die by how quickly they can hand over a credible, well-explained shortlist.

Typical user:

- 1–50 person boutique or mid-market agency
- Runs 5–40 active searches at any time
- Bills on placement fees or retained-search retainers
- Needs to look polished and "premium" to clients

## What changes vs the base product

| Area | Base Recruiting OS | ShortlistPro |
| --- | --- | --- |
| Audience | Internal hiring teams | External agency recruiters |
| Top-level org unit | Job | Client → Search → Role |
| Report output | "Hiring Manager Report" | "Client Shortlist" (white-labeled) |
| Pipeline framing | Internal pipeline | Submission tracking per client |
| Tone | Operational, informal | Polished, confidential, advisory |
| Visual identity | Clean SaaS blue | Premium navy + gold (parchment surface) |

## Files in this template

- `branding.ts` — Product name, copy, color tokens, typography, terminology overrides, stage label mapping, and feature flag hints. Import and spread into the runtime branding config.
- `prompts.md` — System prompts tuned for an agency-recruiter voice. Paste into the relevant workflow step (job_insight, candidate_matching, summary).
- `README.md` — This file.

## How to apply

1. Copy `branding.ts` into your runtime branding loader (or import it directly where the app reads its branding config).
2. Replace the prompt constants in `artifacts/api-server/src/routes/workflows/` with the variants in `prompts.md` (each prompt is labeled with its target step).
3. Update the report cover and footer strings using `reportDefaults` from `branding.ts`.
4. (Optional) Swap the favicon, logo, and login splash to match the gold-on-navy palette.

## Positioning one-liner

> "Turn raw candidate pools into client-ready shortlists in minutes — with explainable AI scoring, branded reports, and 1-click pipeline actions."

## Pricing posture (suggested)

Per-recruiter seat pricing with a per-search overage, since agencies value predictability and want to expose cost-per-search to their clients.
