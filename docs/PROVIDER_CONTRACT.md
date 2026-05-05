# Provider Contract

This document describes the `AgentProvider` interface that every Daneel
provider must implement, and how each of the four commercial A-Player
provider products maps onto it.

The canonical TypeScript source for this contract lives at
`artifacts/api-server/src/routes/workflows/providers/interface.ts`.
If anything below disagrees with that file, the file wins — update this
doc.

## The `AgentProvider` interface

```ts
type WorkflowStep =
  | "job_understanding"
  | "candidate_matching"
  | "shortlist_generation"
  | "sourcing"
  | "sourcing_later"   // reserved, not yet implemented
  | "enrichment";

interface AgentProviderRunInput {
  step:    WorkflowStep;
  runId:   number;          // engine-assigned, used for log correlation
  jobId:   number;
  payload: Record<string, unknown>;   // step-specific shape
}

interface AgentProvider {
  readonly id:   number;    // -1 for native fallback providers
  readonly name: string;    // shown in Settings UI and run logs
  readonly type: string;    // matches the `provider_type` DB enum

  run(input: AgentProviderRunInput): Promise<unknown>;
  validateConnection(): Promise<{ ok: boolean; error?: string }>;
}
```

### Rules

- `run()` returns a step-specific shape:
  - `job_understanding`    → `JobInsightResult`
  - `candidate_matching`   → `CandidateMatchResult[]`
  - `shortlist_generation` → `ShortlistResult[]`
  - `sourcing`             → `SourcingCandidate[]`
  - `enrichment`           → `EnrichmentResult[]`
- `run()` throws on failure. The engine catches, logs to `agent_logs`,
  and decides whether to abort the run based on step criticality.
- `validateConnection()` MUST NOT throw. Return
  `{ ok: false, error }` on failure. Powers the "Test Connection"
  button in Settings → Agent Providers.
- Adding a new provider: implement the interface, register the type
  in `providers/registry.ts`, add it to the `provider_type` DB enum
  in `lib/db/src/schema/agent-providers.ts`, and add it to
  `ProviderType` in `lib/api-spec/openapi.yaml` (then run codegen).

Built-in implementations already shipping:
`NativeOpenAIProvider`, `NativeOpenAISourcingProvider`,
`NativeOpenAIEnrichmentProvider`, `CustomWebhookProvider`,
`TwinWebhookProvider`, `GithubSourcingProvider`,
`WebSearchSourcingProvider`.

---

## A-Player Scout

Sourcing from a job description. JD in, candidate profiles out.

- **Workflow step**: `sourcing`
- **Input payload**: `{ job: { title, description, location?, seniority?,
  mustHaveSkills[] }, count?: number, extraKeywords?: string[] }`
- **Output**: `SourcingCandidate[]` — `{ name, headline?, location?,
  currentCompany?, linkedinUrl?, githubUrl?, summary?, skills[],
  source: "A-Player Scout", sourcingConfidence: number }`. Emails MUST
  be `null` unless the upstream provider exposed a verified address.
- **Auth method**: **none today** — see build state below.
- **Pricing tier**: paid SaaS (per-search or per-candidate, TBD by
  A-Player).
- **Build state**: **needs SaaS shell.** A working sourcing engine
  exists internally but has no auth layer, no per-tenant persistence,
  no billing, and no public provider type yet. Phase 2 of the
  `commercial-suite` plan adds the SaaS shell (auth, tenancy,
  persistence) and registers it through the standard
  `AgentProvider` interface — most likely as a `twin_webhook`-style
  provider, since the legacy `TwinWebhookProvider` and `twinContext`
  metadata in the engine were the original "Twin Scout" plumbing for
  this product.

### A-Player Scout Connect (redirect-based credential exchange)

To remove the friction of recruiters copy-pasting an API key into the
Twin Webhook form, A-Player Scout connects via an OAuth-flavored
redirect. The recruiter never sees or handles the API key. Both sides
must implement the contract below verbatim.

**Daneel-side env var**

`SCOUT_CONNECT_BASE_URL` (default `https://scout.aplayer.ai`) lets the
same code work against a Scout staging instance.

**1. Outbound redirect (Daneel → Scout)**

When the recruiter clicks **Connect Scout** on the marketplace card,
Daneel mints a single-use CSRF `state` (server-side, ~10 min TTL,
in-memory) and opens this URL in a new tab:

```
GET {SCOUT_CONNECT_BASE_URL}/connect
    ?return_to=<absolute Daneel callback URL>
    &state=<csrf>
```

`return_to` is always `${origin}/api/integrations/scout/callback` on
the requesting Daneel instance. Scout MUST preserve `state` verbatim
when redirecting back.

**2. Inbound redirect (Scout → Daneel)**

After Scout authenticates the recruiter, it redirects back to
`return_to` with one of two query shapes:

- Success: `?token=<one-time, short-lived>&state=<echoed CSRF>`
- Failure: `?error=<short machine-readable code>&state=<echoed CSRF>`

`token` is single-use, expires within ~5 minutes, and is validated
exclusively via the exchange endpoint below — Daneel never inspects
its contents.

**3. Server-to-server token exchange**

Daneel's callback handler validates `state` (single-use, not expired,
not replayed), then immediately POSTs `token` to Scout:

```
POST {SCOUT_CONNECT_BASE_URL}/api/connect/exchange
Content-Type: application/json

{ "token": "<one-time token from step 2>" }
```

Scout responds with the credentials Daneel will store as a
`twin_webhook` provider:

```
200 OK
Content-Type: application/json

{
  "apiKey":  "<long-lived API key for this Daneel instance>",
  "baseUrl": "<https URL Daneel hits for /workflow/sourcing etc>"
}
```

Any non-2xx response, or a body that doesn't match the schema above,
is surfaced to the recruiter as a 502 with a "connection failed"
message and the provider row is NOT created.

**4. Persistence on the Daneel side**

On a successful exchange, Daneel:

1. Upserts an `agent_providers` row named `"A-Player Scout"` with
   `type=twin_webhook`, the returned `baseUrl`, and the returned
   `apiKey` stored in `apiKeyEncryptedPlaceholder`.
2. If — and only if — no row exists yet in `workflow_provider_settings`
   for `workflow_step="sourcing"`, auto-assigns the new provider as
   the sourcing step. Pre-existing assignments are left untouched.
3. Renders an HTML page that pings the originating tab (via
   `BroadcastChannel("daneel:scout-connect")`, a `localStorage`
   `daneel.scoutConnect` write, and `window.opener.postMessage`) so
   the marketplace card flips to **Connected** without a manual
   refresh, then auto-closes after ~800ms.

The existing manual `twin_webhook` create/edit form is left alone —
power users and the Scout staging environment can still wire a
provider by hand.

---

## Extend

Sourcing by extending a small set of "look-alike" example profiles
into a larger candidate list with similar shape.

- **Workflow step**: `sourcing`
- **Input payload**: `{ job: {...}, examples: Array<{ name?, headline?,
  linkedinUrl?, githubUrl?, skills[], summary? }>, count?: number }`.
  The provider treats `examples` as the seed set and returns more
  profiles that match the same archetype.
- **Output**: `SourcingCandidate[]` with
  `source: "Extend"`. Same no-fabrication rules as Scout — emails
  null unless verified.
- **Auth method**: API key (Extend-issued), passed as
  `Authorization: Bearer <key>` from a tenant-level secret. Wired
  through the standard provider config row in `agent_providers`.
- **Pricing tier**: paid SaaS, per-extended-profile.
- **Build state**: **integrated, with known bugs.** A working
  `extend_webhook` provider class exists and is callable end-to-end
  through `resolveSourcingProvider()`, but has known correctness
  issues — duplicate candidates across extends, occasional
  hallucinated emails leaking past the strip step, and skill arrays
  containing the seed profile's exact skills instead of expanded
  variants. Phase 3 of the commercial-suite plan fixes these (dedupe
  by `linkedinUrl`/`githubUrl`, hard-strip emails before insert,
  rebuild the skill-extension prompt). Until Phase 3 ships, Extend is
  flagged as `experimental: true` in the provider registry and is
  hidden from new tenants by default.

---

## CodeMatch

GitHub-based technical evaluation of engineering candidates. Reads a
candidate's public GitHub footprint and produces a rubric-aligned fit
score.

- **Workflow step**: `candidate_matching`
- **Input payload**: `{ job: {...}, jobInsights: JobInsightResult,
  candidates: Array<{ id, name, githubUsername?, githubUrl?, summary?,
  skills[] }> }`. Candidates without a usable GitHub handle are
  scored at `confidenceLevel: "Low"` with an explicit
  `requiresEnrichment: true` flag and a missing-data warning.
- **Output**: `CandidateMatchResult[]` — one row per input candidate
  with `fitScore`, `dataConfidenceScore`, `decisionScore`,
  `confidenceLevel`, `confidenceReason`, `scoreBreakdown` (per-rubric
  dimension), and `missingDataWarnings[]`. Same shape as
  `NativeOpenAIProvider.candidate_matching`, so it is a drop-in
  swap in the Settings → Agent Providers UI.
- **Auth method**: API key (CodeMatch-issued), Bearer token. Optional
  `GITHUB_TOKEN` passthrough so the SaaS can use the tenant's higher
  rate limit when available.
- **Pricing tier**: paid SaaS, per-candidate-evaluated.
- **Build state**: **needs SaaS shell.** The scoring logic exists as a
  prototype CLI script using the same public GitHub endpoints as
  `GithubSourcingProvider` (`/users/{login}`, `/users/{login}/repos`)
  but has no hosted endpoint, no auth, and no `agent_providers` row
  yet. Phase 4 of the commercial-suite plan ships the hosted SaaS
  and wires it as a first-class `codematch` provider type.

---

## Council

Multi-LLM deliberation for final hiring decisions. Takes a shortlist
plus the full evaluation context and runs N models in a structured
debate, then emits a consolidated recommendation.

- **Workflow step**: `shortlist_generation`
- **Input payload**: `{ job: {...}, jobInsights: JobInsightResult,
  evaluations: CandidateMatchResult[], topN?: number,
  models?: string[] }`
- **Output**: `ShortlistResult[]` — ranked top-N candidates, each
  with a consolidated `summary`, a `dissent` field listing models
  that disagreed, and a `confidence` field reflecting inter-model
  agreement.
- **Auth method**: API key (Council-issued), Bearer token. Per-model
  upstream keys are managed inside Council, not by the tenant.
- **Pricing tier**: paid SaaS, per-deliberation (priced by panel
  size).
- **Build state**: **needs pivot.** The codebase that will become
  Council currently ships as **AI Boardroom**, a generic multi-LLM
  debate tool with no recruiting-specific schema, no rubric input,
  and no `ShortlistResult` output shape. Phase 5 of the
  commercial-suite plan rebrands it to Council, narrows the prompt
  surface to hiring deliberations, and adapts the I/O to the
  `shortlist_generation` contract above. Until that pivot lands,
  Council is **not** registered as a provider type and the engine
  falls back to `NativeOpenAIProvider` for `shortlist_generation`.
