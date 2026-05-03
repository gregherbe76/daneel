# HiringAI Template

HiringAI re-skins the Recruiting OS as an **AI-native hiring tool for startups**.

## Who it's for

Founders, founding engineers, and early hiring leads at seed–Series B startups who are doing 80% of the recruiting themselves and need the product to do as much of the work as possible.

Typical user:

- 5–50 person company
- No dedicated recruiter (or one part-time contractor)
- Hires 1–5 people per quarter, often urgent
- Lives in Slack, Linear, GitHub, and a Notion ATS
- Trusts AI tools, brings their own OpenAI / Anthropic API key

## What changes vs the base product

| Area | Base Recruiting OS | HiringAI |
| --- | --- | --- |
| Audience | Generic | Founder / hiring lead |
| Vocabulary | Formal ("candidate", "requisition") | Plain ("person", "hire") |
| Default mode | Manual review | Auto-pilot agent |
| Pipeline | 7 stages | Compressed founder funnel (Found → Talked → Founder chat → Signed) |
| Tone | Operational | Direct, energetic, "co-founder voice" |
| Visual identity | Clean SaaS blue | Dark, AI-native, electric violet accent |
| Approvals | Optional | Off by default |

## Files in this template

- `branding.ts` — Dark AI-native theme, founder-friendly terminology, compressed funnel stages, agent-mode feature flags.
- `prompts.md` — System prompts tuned for a fast, decisive, founder-to-founder voice that takes initiative instead of asking permission.
- `README.md` — This file.

## How to apply

1. Copy `branding.ts` into your runtime branding loader.
2. Replace the prompt constants in `artifacts/api-server/src/routes/workflows/` with the variants in `prompts.md`.
3. Turn on the `autoSource`, `autoOutreach`, and `chatWithShortlist` feature flags so the agent runs end-to-end without intervention.
4. Wire the Slack integration so candidate replies and weekly digests land in the founder's DMs.
5. Make sure the "bring your own key" path for OpenAI / Anthropic is exposed in settings — founders will want to control their own spend.

## Positioning one-liner

> "Describe the role in one paragraph. HiringAI sources, screens, scores, and shortlists — so you only spend time on the final interview."

## Pricing posture (suggested)

Flat monthly subscription with unlimited roles, since founders hate seat counts and per-job pricing. Charge for AI usage above a generous monthly cap, or default to BYO-LLM-key.

## Product principles

The HiringAI voice and UX are built around four principles:

1. **Default to action.** The agent moves the funnel forward without asking — and shows what it did.
2. **One screen per decision.** Everything the founder needs to say yes/no fits on one mobile screen.
3. **No HR jargon.** "Hire", "person", "shortlist" — never "requisition" or "candidate evaluation report".
4. **Talk back to the AI.** Every shortlist has a chat sidebar so the founder can ask "why this one?" or "show me more like Priya".
