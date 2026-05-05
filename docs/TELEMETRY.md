# Telemetry

Daneel ships with **opt-in** product analytics so we can measure marketplace
funnel performance before integrating real providers. Telemetry is **off by
default** and only ever runs after the user explicitly clicks "Yes" on the
consent banner (or flips the toggle in Settings → Telemetry).

## What we collect

Exactly five events. Nothing else is sent.

| Event | When it fires | Fields |
|---|---|---|
| `workflow_started` | A workflow run is triggered from the UI | `workflow_step?`, `timestamp`, anonymous `distinct_id` |
| `workflow_completed` | A previously started workflow run is observed as completed | `workflow_step?`, `timestamp`, anonymous `distinct_id` |
| `provider_card_viewed` | A provider card becomes visible on the providers screen | `provider`, `timestamp`, anonymous `distinct_id` |
| `provider_connect_clicked` | The "Test Connection" / connect CTA is clicked on a provider card | `provider`, `timestamp`, anonymous `distinct_id` |
| `provider_connected` | A connection attempt succeeds | `provider`, `timestamp`, anonymous `distinct_id` |

Allow-listed payload fields (and only these):

- `provider` — provider name string (e.g. `GitHub Agent`).
- `workflow_step` — workflow step key (e.g. `candidate_matching`).
- `timestamp` — ISO 8601 UTC timestamp of the event.
- PostHog `distinct_id` — a UUID generated locally on first use and stored in
  `localStorage` under `daneel.telemetryAnonId`. It is not tied to any account.

## What we do **not** collect

- Candidate names, emails, LinkedIn URLs, GitHub handles, profile fields, or
  any other candidate data.
- Job titles, descriptions, must-have skills, or any other job content.
- Recruiter or team-member names, emails, or identifiers.
- Free-text comments, mentions, evaluations, or scores.
- IP addresses are subject to PostHog Cloud's standard handling — we do not
  store or process them ourselves.

## Where the data lives

PostHog Cloud, **EU region** (`https://eu.i.posthog.com`). The host is
configurable via `VITE_POSTHOG_HOST` if a self-hosted EU PostHog instance is
preferred.

## How to opt out

Three independent mechanisms — any one of them is sufficient:

1. **Banner**: click **No** when the consent banner appears on first load. The
   choice is remembered in `localStorage` (`daneel.telemetryConsent = "denied"`)
   and the banner does not reappear.
2. **Settings**: go to **Settings → Telemetry** and turn off "Share anonymous
   usage data". This calls `posthog.opt_out_capturing()`, resets local state,
   and prevents any further events.
3. **Config**: leave `VITE_POSTHOG_KEY` unset at build time — the integration
   silently disables itself, the banner does not appear, and no PostHog code
   is loaded.

## Dev-mode short-circuit

When the frontend is running under `import.meta.env.DEV` (i.e. `vite dev`),
telemetry is **fully disabled** regardless of consent state:

- `initIfConsented()` returns immediately without loading `posthog-js`.
- `track()` returns immediately without emitting.
- The consent banner is hidden.

## How to verify nothing is sent before consent

1. Open the app in a fresh browser profile (or clear `localStorage` for the
   site).
2. Open DevTools → Network and filter by `posthog`.
3. Reload the page. You should see **zero** requests to `eu.i.posthog.com`
   (or whatever `VITE_POSTHOG_HOST` is set to).
4. Click **Yes** on the consent banner. The PostHog SDK is fetched and an
   `/e/` capture request appears.
5. Trigger a workflow or visit `/settings/providers`. You should see the
   matching event in the network tab.
6. Go to **Settings → Telemetry**, turn the toggle off. No further `/e/`
   requests should be sent.

## Implementation pointers

- Wrapper module: `artifacts/recruiting-os/src/lib/telemetry.ts`
- Banner: `artifacts/recruiting-os/src/components/telemetry-consent-banner.tsx`
- Settings page: `artifacts/recruiting-os/src/pages/settings/telemetry.tsx`
- Boot init: `artifacts/recruiting-os/src/main.tsx` calls `initIfConsented()`
  before rendering.
