# Naming — Final Names & Domains

This document is the single source of truth for the canonical names of
the open-source engine and the four commercial provider products that
plug into it. If a name appears anywhere else in this repo (code,
docs, UI, prompts, marketing copy) it must match the canonical form
listed here.

## Open-source engine

| Canonical name | Role                                                          | Domain (planned)   |
| -------------- | ------------------------------------------------------------- | ------------------ |
| **Daneel**     | The open-source agentic workflow engine for recruiting (MIT). | `daneel.dev`       |

Daneel is the runtime. The four products below plug into it through
the standard provider interface.

## Commercial provider products (A-Player suite)

All four products below are commercial offerings from the project
maintainer (Greg Herbé / A-Player). They are optional — Daneel runs
end-to-end without any of them.

| Canonical name      | Role                                                           | Domain (planned)        |
| ------------------- | -------------------------------------------------------------- | ----------------------- |
| **A-Player Scout**  | Sourcing from a job description (JD-driven candidate sourcing) | `aplayerscout.com`      |
| **Extend**          | Sourcing by extending a small set of example "look-alike" profiles | `extend.hr`         |
| **CodeMatch**       | GitHub-based technical evaluation of engineering candidates    | `codematch.dev`         |
| **Council**         | Multi-LLM deliberation for final hiring decisions              | `council.hr`            |

## Important naming notes

### "Twin Scout" → use **A-Player Scout**

Some legacy code, internal docs, and the engine's `twin_webhook` /
`TwinWebhookProvider` types still carry the working name **"Twin
Scout"** (sometimes shortened to "Twin"). These refer to the same tool
as **A-Player Scout**. The canonical, user-facing name is
**A-Player Scout**. Internal type names (`twin_webhook`, `twinContext`,
`TwinWebhookProvider`) may stay as-is for engine stability — only
user-visible strings need to migrate.

### Dropped names — do not reintroduce

The following names appeared in earlier phases of the project and have
been **dropped**. They must not be used in new code, UI copy,
documentation, or marketing material:

- ~~**HireFlow**~~ — dropped. (Was an agency-flavored brand template.)
- ~~**ShortlistPro**~~ — dropped. (Was a shortlist-focused brand template.)

The HiringAI front-end branding currently shipped on top of Daneel is
a separate concern (UI template) and is not affected by this rename.
HiringAI is the default UI brand on top of the Daneel engine; it is
not one of the four commercial provider products.

### Naming rules of thumb

- **Daneel** is always the engine. Never use it as a product/feature
  name.
- The four commercial tools are always written with their canonical
  capitalization: **A-Player Scout**, **Extend**, **CodeMatch**,
  **Council** — never lowercased, never hyphenated differently.
- When listing the four together, mark each with an asterisk (`*`)
  and disclose commercial status in the same paragraph (see
  `VISION.md` → "Commercial Disclosure").
