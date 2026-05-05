# Daneel — Vision

## Tagline

**The open-source agentic workflow engine for recruiting.**

## What Daneel Is

Daneel is an open-source, self-hostable runtime that lets recruiting teams
compose AI agents into reproducible, auditable hiring workflows. The engine
handles the boring-but-critical plumbing — job-understanding, candidate
sourcing, candidate matching, shortlist generation, scoring rubrics,
provider routing, evaluations, audit logs, soft deletes, mentions,
team collaboration — so that any provider, model, or scoring strategy can
be plugged in without rewriting the pipeline.

The engine is provider-agnostic. Out of the box it ships with free and
bring-your-own-key providers (native OpenAI, custom webhooks, public
GitHub search, web search via SerpAPI) so a team can run the full
4-step pipeline (Job Understanding → Sourcing → Matching → Shortlist)
end-to-end without paying for anything beyond their own LLM keys.

## What Daneel Is Not

- **Not a closed SaaS.** The engine is MIT-licensed and runs anywhere.
- **Not a black box.** Every agent step writes structured input/output
  logs; every score is recomputed server-side from a transparent rubric.
- **Not an ATS replacement** for compliance-heavy enterprise pipelines —
  it is the *agentic layer* that sits in front of (or alongside) one.
- **Not a candidate database.** Daneel orchestrates sourcing through
  pluggable providers; it does not scrape or resell candidate data.

## Audience

- **Startup founders & hiring managers** who want a leaner, AI-native
  alternative to legacy ATS workflows.
- **Recruiting agencies** who want to white-label and tune the engine
  for their own clients.
- **AI/recruiting tool builders** who want a battle-tested workflow
  runtime to plug their own sourcing, scoring, or deliberation models
  into without rebuilding the orchestration layer.

## The Four-Tool Funnel

Daneel is the engine. On top of it, four commercial provider products
plug in via the standard provider interface to cover the full hiring
funnel:

1. **A-Player Scout*** — sourcing from a job description.
2. **Extend*** — sourcing by extending a small set of example
   "look-alike" profiles.
3. **CodeMatch*** — GitHub-based technical evaluation of engineers.
4. **Council*** — multi-LLM deliberation for final hiring decisions.

Each tool is an optional drop-in. Daneel itself never requires any of
them to function.

## Commercial Disclosure

The four tools marked with an asterisk above (**A-Player Scout**,
**Extend**, **CodeMatch**, **Council**) are commercial offerings from
the project maintainer, **Greg Herbé / A-Player**. They are paid,
hosted services that integrate with Daneel through the same public
provider interface that any third-party developer can use.

The Daneel engine itself is, and will remain, fully functional with
free and bring-your-own-key providers (native OpenAI, custom webhooks,
public GitHub search, SerpAPI web search). You never need an A-Player
subscription to run, fork, self-host, or extend Daneel.

## License

Daneel is released under the **MIT License**. Fork it, ship it,
white-label it, integrate it into your own product. The commercial
A-Player provider products are licensed separately under their own
commercial terms.
