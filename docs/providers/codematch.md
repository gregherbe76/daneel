# CodeMatch — Technical Evaluation Provider

CodeMatch (https://assess.codes) is the first **technical evaluation** provider integrated with Daneel. It scores a candidate's public GitHub footprint along five dimensions and returns explicit strengths and red flags that surface on the candidate detail page.

CodeMatch is closed-source SaaS. You bring your own API key.

## What it does

For every candidate that reaches the (optional) `technical_evaluation` workflow step, CodeMatch is called once over HTTP and returns:

| Dimension          | What it measures                                       |
| ------------------ | ------------------------------------------------------ |
| `technical_depth`  | Engineering complexity of authored code (0–100)         |
| `ownership`        | Whether the candidate ships meaningful work end-to-end  |
| `consistency`      | Long-term commit cadence and follow-through            |
| `taste`            | Code quality, naming, abstractions, dependency choices  |
| `impact`           | Stars, forks, downstream usage, real adoption          |
| `overall`          | CodeMatch's published composite — Daneel never recomputes it |

Plus: `strengths[]`, `red_flags[]`, `summary`, optional `report_url`.

## Setup

1. Get a CodeMatch API key from `assess.codes → Settings → API Keys`.
2. In Daneel, go to **Settings → Marketplace** and click **Connect** on the CodeMatch card.
3. Paste your API key. Optional: override the base URL under *Advanced settings* if you self-host (default `https://assess.codes/api/v1`).
4. Saving auto-assigns CodeMatch to the `technical_evaluation` workflow step.
5. On each job you want technical scoring for, open **Edit Job** and toggle **Technical evaluation** on. The step is opt-in per job — it never runs by default.

## Requirements per candidate

- The candidate must have a public GitHub username on file (`candidates.github_username`). Sourced candidates from the GitHub Agent populate this automatically.
- If the username is missing, the candidate gets an `evaluated: false` row with `error: "no_github_username"` so the UI can explain why.

## Stable error codes

CodeMatch responses are mapped to a stable set of error codes. The candidate page renders specific copy per code, and reports surface them in the Score Reliability section.

| HTTP status   | Code                     | UI message                                               |
| ------------- | ------------------------ | -------------------------------------------------------- |
| 401, 403      | `auth_failed`            | "CodeMatch rejected the API key. Reconnect the provider…" |
| 402           | `premium_required`       | "Upgrade your plan at assess.codes to score them."       |
| 404           | `github_user_not_found`  | "CodeMatch couldn't find this GitHub user."              |
| 429           | `rate_limited`           | "CodeMatch rate-limited the request. The next run will retry." |
| 5xx           | `server_error`           | "CodeMatch returned a server error."                     |
| (timeout 30s) | `timeout`                | "CodeMatch request timed out."                            |
| (network)     | `network_error`          | "Network error reaching CodeMatch. The next run will retry." |
| (parse)       | `invalid_response`       | "CodeMatch returned a malformed response."               |
| (no key)      | `auth_failed`            | "API key is not set."                                     |
| (no GH user)  | `no_github_username`     | "Add a GitHub username to enable technical evaluation."   |

`evaluated: false` rows are persisted to `technical_evaluations` for **per-candidate** provider failures (auth, premium, GitHub miss, rate limit, timeout, network, malformed response, missing GitHub username) so the UI can explain *why* that candidate wasn't scored.

Step-level conditions (the job has `technicalEvaluationEnabled = false`, or no evaluation provider is configured for the `technical_evaluation` step) are handled by the engine *before* per-candidate work and produce no `technical_evaluations` rows. The candidate page falls back to its empty-state message in that case.

## Where the data shows up

- **Candidate detail page → Technical Evaluation tab** — bar chart of all five dimensions, overall score, strengths and red flags as chips, link to the full CodeMatch report when available.
- **Workflow latest payload** (`GET /api/workflows/jobs/:jobId/latest`) — every row is returned in `technicalEvaluations[]`.

## Pricing & quota

Pricing and quotas are enforced by CodeMatch — Daneel never tracks counts. `premium_required` (HTTP 402) is the signal that an account upgrade is needed for a particular candidate or volume tier.

## Testing the connection

The marketplace card uses the standard `POST /api/providers/:id/test` endpoint. CodeMatch's `validateConnection()` POSTs `{ github_username: "torvalds" }` to `/evaluate` with a 5s timeout and treats `200 / 402 / 404 / 429` as "reachable + auth OK", and `401 / 403` as "invalid key".

## Engine integration

The technical evaluation step runs **after** Candidate Matching and **before** Shortlist Generation. It never modifies shortlist ranking — the recruiter sees both scores side-by-side and decides how to weigh them.

The step is fail-soft: provider errors and missing GitHub usernames are logged and persisted, but the workflow always continues to Shortlist Generation. See `runTechnicalEvaluation()` in `artifacts/api-server/src/routes/workflows/engine.ts`.
