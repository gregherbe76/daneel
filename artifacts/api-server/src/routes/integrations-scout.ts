import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  agentProvidersTable,
  workflowProviderSettingsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { encryptProviderSecret } from "../lib/provider-secrets";
import { consumeScoutState, issueScoutState } from "./scout-state-store";

/**
 * Canonical name used for the auto-provisioned A-Player Scout provider row.
 * Re-using the name on reconnect lets us upsert in place instead of creating
 * a duplicate row each time the recruiter goes through the Connect flow.
 */
export const SCOUT_PROVIDER_NAME = "A-Player Scout";

/**
 * Where the Connect page lives. Configurable so the same code works against
 * a Scout staging instance during development.
 */
export function scoutBaseUrl(): string {
  return process.env["SCOUT_CONNECT_BASE_URL"] ?? "https://scout.aplayer.ai";
}

const ExchangeResponseSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
});
export type ScoutExchangeResponse = z.infer<typeof ExchangeResponseSchema>;

/**
 * Indirection so tests can override the fetch used by the exchange call
 * without globally stubbing `fetch` (which would also intercept the
 * test client used to hit our own routes via supertest-style requests).
 */
let scoutFetchImpl: typeof fetch = (...args) => fetch(...args);
export function _setScoutFetchForTest(impl: typeof fetch | null): void {
  scoutFetchImpl = impl ?? ((...args) => fetch(...args));
}

/**
 * Server-side token → credentials swap. Hits Scout's exchange endpoint with
 * the one-time token from the callback redirect and returns the resulting
 * `{apiKey, baseUrl}` for storage. Throws on any non-2xx or malformed body so
 * the caller can render a clear error to the recruiter.
 */
export async function exchangeScoutToken(
  token: string,
  fetchImpl: typeof fetch = scoutFetchImpl,
): Promise<ScoutExchangeResponse> {
  const url = `${scoutBaseUrl().replace(/\/$/, "")}/api/connect/exchange`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Scout exchange returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }
  const json = await response.json().catch(() => null);
  const parsed = ExchangeResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Scout exchange returned a malformed response");
  }
  return parsed.data;
}

/**
 * Workflow steps the Scout integration is currently capable of powering.
 * Surfaced to the marketplace card on the frontend (so recruiters can see
 * what will be wired up before they click Connect) and to the auto-assign
 * logic below. Keep in sync with the marketplace card metadata in
 * `artifacts/recruiting-os/src/pages/settings/providers.tsx`.
 */
export const SCOUT_POWERED_STEPS = ["sourcing"] as const;
export type ScoutPoweredStep = (typeof SCOUT_POWERED_STEPS)[number];

/**
 * Create or update the "A-Player Scout" provider row with the freshly-exchanged
 * credentials, then (when `autoAssign` is true and no provider is yet wired
 * for a step Scout can power) assign Scout to that step. Pre-existing
 * assignments are left untouched so a recruiter who already wired up another
 * provider isn't silently overridden.
 *
 * Returns the list of workflow steps Scout was actually wired to during this
 * call so the callback page can surface "Wired up: Sourcing" in the post-
 * connect toast.
 */
export async function persistScoutProvider(
  baseUrl: string,
  apiKey: string,
  opts: { autoAssign?: boolean } = {},
): Promise<{
  providerId: number;
  assignedSteps: ScoutPoweredStep[];
  /** @deprecated Use `assignedSteps.includes("sourcing")` instead. */
  assignedSourcing: boolean;
}> {
  const autoAssign = opts.autoAssign ?? true;
  const existing = await db
    .select()
    .from(agentProvidersTable)
    .where(eq(agentProvidersTable.name, SCOUT_PROVIDER_NAME))
    .limit(1);

  const encryptedApiKey = encryptProviderSecret(apiKey);
  let providerId: number;
  if (existing.length > 0) {
    const [updated] = await db
      .update(agentProvidersTable)
      .set({
        type: "twin_webhook",
        baseUrl,
        webhookUrl: null,
        apiKeyEncryptedPlaceholder: encryptedApiKey,
        enabled: true,
        updatedAt: new Date(),
      })
      .where(eq(agentProvidersTable.id, existing[0]!.id))
      .returning();
    providerId = updated!.id;
  } else {
    const [created] = await db
      .insert(agentProvidersTable)
      .values({
        name: SCOUT_PROVIDER_NAME,
        type: "twin_webhook",
        baseUrl,
        apiKeyEncryptedPlaceholder: encryptedApiKey,
        enabled: true,
      })
      .returning();
    providerId = created!.id;
  }

  const assignedSteps: ScoutPoweredStep[] = [];
  if (autoAssign) {
    for (const step of SCOUT_POWERED_STEPS) {
      const existingForStep = await db
        .select()
        .from(workflowProviderSettingsTable)
        .where(eq(workflowProviderSettingsTable.workflowStep, step))
        .limit(1);
      if (existingForStep.length === 0) {
        await db.insert(workflowProviderSettingsTable).values({
          workflowStep: step,
          providerId,
          enabled: true,
        });
        assignedSteps.push(step);
      }
    }
  }

  return {
    providerId,
    assignedSteps,
    assignedSourcing: assignedSteps.includes("sourcing"),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * The callback always returns HTML (this tab is a popup the user opened). On
 * success, we ping the originating tab via BroadcastChannel + a localStorage
 * key + window.opener.postMessage (three channels for cross-browser safety),
 * then auto-close. On failure, we keep the tab open with the error so the
 * recruiter can see what went wrong.
 */
function renderCallbackHtml(payload: {
  ok: boolean;
  error?: string | null;
  assignedSteps?: ScoutPoweredStep[];
}): string {
  const message = payload.ok
    ? "You're connected to A-Player Scout. You can close this tab."
    : `Connection failed: ${payload.error ?? "unknown error"}`;
  const safeMessage = escapeHtml(message);
  const inline = JSON.stringify({
    ok: payload.ok,
    error: payload.error ?? null,
    assignedSteps: payload.assignedSteps ?? [],
  });
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>${payload.ok ? "Connected" : "Connection failed"} — A-Player Scout</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;padding:48px 24px;color:#0f172a;background:#f8fafc;margin:0}
    .card{max-width:420px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 24px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
    h1{font-size:18px;margin:0 0 8px;color:${payload.ok ? "#15803d" : "#b91c1c"}}
    p{font-size:14px;line-height:1.5;color:#475569;margin:0}
  </style>
</head><body>
  <div class="card">
    <h1>${payload.ok ? "Connected" : "Connection failed"}</h1>
    <p>${safeMessage}</p>
  </div>
  <script>
    (function(){
      var payload = ${inline};
      try {
        var bc = new BroadcastChannel("daneel:scout-connect");
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
      try {
        localStorage.setItem("daneel.scoutConnect", JSON.stringify(Object.assign({ t: Date.now() }, payload)));
      } catch (_) {}
      try {
        if (window.opener) {
          window.opener.postMessage(Object.assign({ source: "daneel-scout-connect" }, payload), "*");
        }
      } catch (_) {}
      if (payload.ok) {
        setTimeout(function(){ try { window.close(); } catch (_) {} }, 800);
      }
    })();
  </script>
</body></html>`;
}

const router = Router();

/**
 * Mint a single-use CSRF state and return the absolute Scout connect URL the
 * frontend should `window.open()`. The frontend never assembles this URL
 * itself so we can keep base-URL configuration entirely server-side.
 */
const StateRequestBodySchema = z
  .object({
    autoAssignSteps: z.boolean().optional(),
  })
  .partial()
  .optional();

router.post("/integrations/scout/state", async (req, res) => {
  const proto = (req.get("x-forwarded-proto") ?? req.protocol) as string;
  const host = req.get("host");
  if (!host) {
    res.status(500).json({ error: "Cannot resolve callback host" });
    return;
  }
  const parsedBody = StateRequestBodySchema.safeParse(req.body);
  // Default to auto-assigning when the recruiter didn't say otherwise so the
  // existing zero-config flow keeps working.
  const autoAssignSteps =
    parsedBody.success && parsedBody.data?.autoAssignSteps === false
      ? false
      : true;
  const callbackUrl = `${proto}://${host}/api/integrations/scout/callback`;
  const state = await issueScoutState({ autoAssignSteps });
  const connectBase = scoutBaseUrl().replace(/\/$/, "");
  const connectUrl =
    `${connectBase}/connect?return_to=${encodeURIComponent(callbackUrl)}` +
    `&state=${encodeURIComponent(state)}`;
  res.json({ state, connectUrl, callbackUrl });
});

const CallbackQuerySchema = z.object({
  token: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

router.get("/integrations/scout/callback", async (req, res) => {
  res.type("html");
  const parsed = CallbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).send(renderCallbackHtml({ ok: false, error: "Invalid callback query" }));
    return;
  }
  const { token, state, error } = parsed.data;
  // Retire the state on error paths too — once Scout has redirected back
  // for a given attempt, that state has served its purpose and should not
  // be reusable, even if the attempt failed.
  if (error) {
    if (state) await consumeScoutState(state);
    res.status(400).send(renderCallbackHtml({ ok: false, error }));
    return;
  }
  if (!token || !state) {
    if (state) await consumeScoutState(state);
    res
      .status(400)
      .send(renderCallbackHtml({ ok: false, error: "Missing token or state" }));
    return;
  }
  const stateCheck = await consumeScoutState(state);
  if (!stateCheck.ok) {
    logger.warn(
      { reason: stateCheck.reason },
      "Scout callback rejected: invalid state",
    );
    res
      .status(400)
      .send(
        renderCallbackHtml({ ok: false, error: `Invalid state (${stateCheck.reason})` }),
      );
    return;
  }
  try {
    const creds = await exchangeScoutToken(token);
    const autoAssign = stateCheck.options.autoAssignSteps !== false;
    const { assignedSteps } = await persistScoutProvider(
      creds.baseUrl,
      creds.apiKey,
      { autoAssign },
    );
    res.status(200).send(renderCallbackHtml({ ok: true, assignedSteps }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Scout callback exchange/persist failed");
    res.status(502).send(renderCallbackHtml({ ok: false, error: message }));
  }
});

/**
 * Atomically unlink and delete the Scout provider. The Configured Providers
 * `DELETE /providers/:id` route can't safely remove a row that's referenced
 * by `workflow_provider_settings` (FK is `onDelete: restrict`) — and Scout
 * is auto-assigned to the sourcing step on first connect, so a naive delete
 * from the marketplace card would fail with a 500 in the most common case.
 * This endpoint clears any step assignments pointing at Scout first, then
 * deletes the provider row.
 */
router.delete("/integrations/scout/connection", async (_req, res) => {
  const existing = await db
    .select()
    .from(agentProvidersTable)
    .where(eq(agentProvidersTable.name, SCOUT_PROVIDER_NAME))
    .limit(1);
  if (existing.length === 0) {
    res.json({ removed: false });
    return;
  }
  const providerId = existing[0]!.id;
  await db
    .delete(workflowProviderSettingsTable)
    .where(eq(workflowProviderSettingsTable.providerId, providerId));
  await db.delete(agentProvidersTable).where(eq(agentProvidersTable.id, providerId));
  res.json({ removed: true });
});

export default router;
