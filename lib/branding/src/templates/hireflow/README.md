# HireFlow Template

HireFlow re-skins the Recruiting OS for **mid-market and enterprise HR / Talent Acquisition teams**.

## Who it's for

In-house TA partners and recruiting coordinators at companies of 200–10,000 employees who run structured, compliance-aware hiring across many open requisitions.

Typical user:

- TA team of 5–50, often segmented by business unit
- Already runs an ATS (Greenhouse, Lever, Workday, SmartRecruiters)
- Has Legal / People Ops oversight on hiring decisions
- Cares about audit trails, bias mitigation, and EEOC reporting

## What changes vs the base product

| Area | Base Recruiting OS | HireFlow |
| --- | --- | --- |
| Audience | Generic | In-house TA partners |
| Top-level unit | Job | Requisition (with intake & approval) |
| Report output | "Hiring Manager Report" | "Candidate Evaluation Report" (auditable) |
| Pipeline framing | 7 generic stages | Standard ATS funnel labels |
| Tone | Operational | Formal, governance-aware, neutral |
| Visual identity | Clean SaaS blue | Trusted enterprise blue + teal accent |
| Compliance | Optional | First-class (audit log, EEOC, bias disclosures) |

## Files in this template

- `branding.ts` — Product name, copy, enterprise color tokens, terminology aligned with ATS conventions, stage label remapping, and governance feature flags.
- `prompts.md` — System prompts tuned for a neutral, defensible, bias-aware TA voice. Designed to survive Legal review.
- `README.md` — This file.

## How to apply

1. Copy `branding.ts` into your runtime branding loader.
2. Replace the prompt constants in `artifacts/api-server/src/routes/workflows/` with the variants in `prompts.md`.
3. Enable the governance feature flags in your app config: SSO, audit log export, bias review banner.
4. Wire the ATS integration hooks (Greenhouse / Lever / Workday) so requisitions and stage moves sync both ways.
5. Update the report cover and footer using `reportDefaults` from `branding.ts`.

## Positioning one-liner

> "Standardize evaluation rubrics, automate candidate screening with explainable AI, and give every hiring manager a defensible report — without leaving your ATS workflow."

## Pricing posture (suggested)

Annual contract, priced per requisition slot or per recruiter seat with volume tiers. Enterprise procurement will expect SSO, SCIM, DPA, and a security questionnaire — bake the docs in early.

## Compliance notes

The HireFlow voice is intentionally **neutral and evidence-based**. Every AI evaluation must:

- Cite the specific must-have or evaluation criterion it scored against
- Avoid inferring protected characteristics (age, gender, ethnicity, family status)
- Be exportable to a tamper-evident audit log along with the prompt and model version
- Carry a visible "AI-assisted decision" banner on any candidate-facing artifact
