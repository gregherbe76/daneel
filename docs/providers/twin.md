# Twin Agent Browser sourcing provider

Provider type: `twin_agent`
Workflow step: `sourcing`
Connector card: **Settings → Marketplace → Twin Agent Browser** (yellow `Twin` badge, accent `#FEDA3D`).

## What it is

Twin Agent Browser is a first-class Daneel sourcing provider that delegates
a "let an agent explore the open web in a real browser" sourcing run to the
[Twin](https://twin.aplayer.ai) product. It is **distinct** from the legacy
`twin_webhook` provider (which is the generic step-routed webhook re-used by
the A-Player Scout connector). Twin Agent Browser targets Twin's dedicated
sourcing API and supports both:

- **Sync mode** — a single JSON response with the full candidate list.
- **Streaming mode** — Server-Sent Events that stream partial candidate
  cards as Twin's browser agent finds them, plus a final `stats` frame.

The recruiter chooses the mode in the connector card. Sync is the default
because it is more reliable on flaky networks; streaming is recommended
when the recruiter wants to watch progress in the kickoff loader UI.

## Why it exists alongside `twin_webhook`

| | `twin_webhook` | `twin_agent` |
|---|---|---|
| Purpose | Generic step-routed webhook (re-used by A-Player Scout integration) | Dedicated Twin Agent Browser sourcing |
| Steps | Any step | `sourcing` only |
| Wire format | Custom payload + `twinContext` metadata | Twin sourcing API JSON / SSE |
| Quota / pricing | Self-hosted | Enforced by Twin (HTTP 402 → upgrade CTA) |
| Marketplace card | Hidden (created by the A-Player Scout OAuth-style flow) | Visible — recruiter pastes Twin API key |

Both can co-exist on the same workspace without conflict.

## Configuration

| Field | UI | DB column | Required |
|---|---|---|---|
| Twin API key | password input | `apiKeyEncryptedPlaceholder` (encrypted at rest) | yes |
| Streaming on/off | switch | `config.twin_agent.streaming` | no, default false |
| Base URL override | advanced section | `config.twin_agent.baseUrl` | no, default `https://twin.aplayer.ai` |

The API key is sent on every request as `Authorization: Bearer <key>`. Quota
and pricing are enforced by Twin itself — Daneel never tracks counts.

## Wire contract

### Request

`POST <baseUrl>/api/sourcing/run` — `Content-Type: application/json`

```json
{
  "job": {
    "title": "...",
    "description": "...",
    "location": "...",
    "seniority": "...",
    "mustHaveSkills": ["..."]
  },
  "filters": { "location": "...", "seniority": "..." },
  "count": 7,
  "runId": 123,
  "jobId": 45,
  "streaming": true
}
```

### Response (sync)

```json
{
  "candidates": [ /* Daneel SourcingCandidate[] */ ],
  "stats":      { /* optional SourcingStats */ }
}
```

### Response (streaming)

`Content-Type: text/event-stream`. Twin emits one of:

```
event: candidate
data: { ...SourcingCandidate }

event: stats
data: { ...SourcingStats }

event: error
data: { "message": "..." }

event: done
data: { "ok": true }
```

The provider accumulates all `candidate` frames, merges any `stats` frame,
and finalises on `done`. An `error` frame aborts the stream but the
already-collected candidates are NOT discarded — they are still returned.

### Quota exceeded

HTTP `402` from Twin → the provider raises `TwinQuotaExceededError` with
the upgrade URL parsed out of the response body. The kickoff loader maps
this to a "Reconnect Twin / Manage on Twin" CTA banner.

## Strict no-fabrication

Daneel's sourcing contract requires that providers never invent contact
data. Twin Agent Browser passes raw candidate cards through the same
`normaliseSourcingResponse` helper used by the legacy `twin_webhook`
provider — emails are kept null when Twin doesn't surface one, and every
row is re-tagged with `source: "Twin Agent Browser"` regardless of what
the upstream response set.

## Operational notes

- Default request timeout: **90s** (Twin browsing runs are slower than
  GitHub or SerpAPI).
- `validateConnection()` calls `GET <baseUrl>/api/whoami` and surfaces the
  Twin plan, email, and remaining quota in the marketplace status pill
  when available. Falls back to a `HEAD` on the base URL if Twin doesn't
  yet implement `/api/whoami`.
- `engine.ts` requires no special-casing — `twin_agent` is registered in
  `REAL_SOURCING_TYPES` and `UI_DEFAULT_REAL_SOURCING_TYPES` and resolved
  through the standard sourcing-step dispatch path.
