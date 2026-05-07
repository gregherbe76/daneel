# Extend Sourcing Provider

## What it does

Extend (https://extend.aplayer.ai) is a **pattern-matching sourcing provider**.
You give it 1-10 LinkedIn profiles of people you already love (your A-players,
ideal hires, top performers). Extend's pipeline crawls LinkedIn for look-alikes,
scores each match against your example pattern, and returns ranked candidates
with a score (0-10) and a one-paragraph reason.

In Daneel, Extend powers the **Sourcing** workflow step when assigned. It's an
alternative to GitHub Agent / Web Search / Apify / Twin Agent for teams whose
ideal hires are best described by example rather than by a keyword search.

## How to connect

1. Create an account at https://extend.aplayer.ai
2. Upgrade to **Premium** (`$29/mo` at https://extend.aplayer.ai/account)
3. Configure your **LinkedIn cookie** in Extend's settings (required for
   crawling — Extend handles this server-side)
4. Generate an **API key** from Extend's Account → API page
5. In Daneel, open **Settings → Marketplace → Extend → Connect**
6. Paste the key into the dialog and click **Save**

Connecting auto-assigns Extend to the **Sourcing** workflow step. The Save
action runs an immediate connection probe (`GET /api/v1/me`) and surfaces
the result in the toast (OK or the upstream error).

## Pricing

- `$29/mo` at https://extend.aplayer.ai/account
- All quota and rate-limit enforcement happens on Extend's side. Daneel
  forwards your key as `Authorization: Bearer <key>` on every call.

## Workflow integration

Each job that should be sourced via Extend must declare 1-10 example LinkedIn
profile URLs:

1. Open the job edit page
2. Expand **Advanced sourcing inputs**
3. Add 1-10 LinkedIn profile URLs (validated client-side: must match
   `https?://(www\.)?linkedin\.com/in/...`)
4. Save

When a workflow run starts and Extend is assigned to the sourcing step:

1. Daneel posts `POST /v1/find-similar` with the example URLs, job
   description, location, and must-have skills as scoring criteria
2. Extend returns `202` with an `analysis_id`
3. Daneel waits **30s** (Extend's pipeline is 60-150s on average), then
   polls `GET /v1/find-similar/:id` every **10s**
4. Total polling budget is **12 minutes** (Extend's server watchdog is 10
   minutes, so we leave headroom)
5. When status flips to `completed`, candidates are ingested with:
   - `confidence = score / 10` (clamped 0-1)
   - `summary = scoreReason` (joined if returned as an array)
   - `source = "Extend pattern-match"`
   - `email`, `githubUrl`, `username`, `emailSource` are all `null`
     (Extend returns LinkedIn-only data; downstream enrichment can fill
     these in if configured)

The Run timeline surfaces Extend-specific stats:
`extend_analysis_id`, `extend_pattern_title`, `extend_total_found`,
`extend_below_minimum`, `extend_polling_duration_ms`.

## Error states

Daneel maps Extend errors to typed codes that show on the failed
sourcing step in the run timeline:

| Code | Trigger | Recovery |
|---|---|---|
| `no_profile_urls` | The job has no `exampleProfileUrls` | Add 1-10 URLs in Advanced sourcing inputs |
| `auth_failed` | API key missing or upstream `401`/`403` | Re-paste the key in the marketplace |
| `premium_required` | Upstream `402` (account not on Premium) | Upgrade at extend.aplayer.ai/account |
| `linkedin_cookie_required` | Upstream `412` / `428` | Refresh the LinkedIn cookie in Extend's settings |
| `extend_timeout` | POST aborted at 8s, or polling exceeds 12 min | Retry the run; Extend may be under load |
| `pipeline_failed` | Poll returned `status: "failed"` | Inspect `extend_analysis_id` on extend.aplayer.ai |
| `server_error` | Upstream `5xx` or `429` | Retry the run |
| `network_error` | Generic fetch rejection | Check Daneel's outbound network access |
| `invalid_response` | POST returned no `analysis_id` | File a bug — likely an API contract drift |

## Limitations

- **1-10 example profiles per job** (validated on both client and provider
  sides; the provider slices any excess)
- **Pipeline duration: 2-5 min on average** (cold starts can hit 8 min)
- **No refinement loop** — Extend's standalone product supports a feedback
  loop where you flag good/bad results and the pattern auto-tightens.
  This is **not implemented** in Daneel for now. Use Extend's standalone
  UI directly (https://extend.aplayer.ai) if you need refinement.
- **LinkedIn-only output** — Extend returns no email, no GitHub username,
  no current-company field. Configure an enrichment provider downstream
  if you need those.
- **No streaming** — candidates arrive as a single batch when polling
  completes. The run UI shows "Sourcing: running" for the entire 2-5 min
  window without intermediate progress.
