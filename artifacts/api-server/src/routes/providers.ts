import { Router } from "express";
import { db, agentProvidersTable, workflowProviderSettingsTable, jobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateProviderBody,
  ToggleProviderBody,
  UpsertProviderStepSettingBody,
  PreviewGithubQueryBody,
} from "@workspace/api-zod";
import { providerFromRow, decisionProviderFromRow } from "./workflows/providers";
import { GithubSourcingProvider } from "./workflows/providers/github";
import { logger } from "../lib/logger";
import {
  encryptProviderSecret,
  lastFourOfProviderSecret,
  maybeEncryptProviderSecret,
} from "../lib/provider-secrets";

/**
 * Strip the encrypted credential out of a provider row before sending it to
 * API clients, replacing it with a `apiKeyLast4` hint so the Settings UI can
 * render a masked placeholder like "•••• abcd" without ever exposing the
 * live key over the wire. The column itself stays encrypted at rest.
 */
function serializeRowForApi<
  T extends { apiKeyEncryptedPlaceholder?: string | null },
>(row: T): Omit<T, "apiKeyEncryptedPlaceholder"> & {
  apiKeyLast4: string | null;
} {
  // Deliberately drop the encrypted column so even the ciphertext never
  // leaves the server — clients only see the last-4 hint.
  const { apiKeyEncryptedPlaceholder: _omit, ...rest } = row;
  void _omit;
  return {
    ...rest,
    apiKeyLast4: lastFourOfProviderSecret(row.apiKeyEncryptedPlaceholder),
  };
}

const router = Router();

// GET /providers
router.get("/providers", async (_req, res) => {
  const providers = await db
    .select()
    .from(agentProvidersTable)
    .orderBy(agentProvidersTable.createdAt);
  res.json(providers.map(serializeRowForApi));
});

// POST /providers
router.post("/providers", async (req, res) => {
  const body = CreateProviderBody.parse(req.body);
  const [provider] = await db
    .insert(agentProvidersTable)
    .values({
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl ?? null,
      webhookUrl: body.webhookUrl ?? null,
      apiKeyEncryptedPlaceholder: maybeEncryptProviderSecret(body.apiKeyPlaceholder),
      config: body.config ?? null,
      enabled: body.enabled ?? true,
    })
    .returning();
  res.status(201).json(serializeRowForApi(provider!));
});

// GET /providers/steps  ← must be BEFORE /providers/:id
router.get("/providers/steps", async (_req, res) => {
  const settings = await db.select().from(workflowProviderSettingsTable);
  const providers = await db.select().from(agentProvidersTable);
  const providerMap = new Map(providers.map((p) => [p.id, p]));

  const result = settings.map((s) => {
    const provider = providerMap.get(s.providerId);
    return {
      ...s,
      provider: provider ? serializeRowForApi(provider) : provider,
    };
  });
  res.json(result);
});

// POST /providers/preview-github-query  ← must be BEFORE /providers/:id
//
// Surfaces the exact `q=` string the GitHub Agent will send for a given job —
// so recruiters can iterate on extra-keywords / exclude-orgs / min-followers
// from the provider edit dialog without burning a real sourcing run.
//
// `config` (when supplied) is used verbatim, letting recruiters preview
// unsaved tuning. Otherwise we look up the saved provider config by id.
router.post("/providers/preview-github-query", async (req, res) => {
  const body = PreviewGithubQueryBody.parse(req.body);

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, body.jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  let config = body.config ?? null;
  if (!config && body.providerId != null) {
    const [row] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, body.providerId));
    if (row && row.type === "github") {
      config = row.config?.github ?? null;
    }
  }

  // Use a sentinel id; this provider instance is never persisted or registered.
  const provider = new GithubSourcingProvider(-1, "preview", config);
  const payload = GithubSourcingProvider.buildPayloadFromJob(job);
  const query = provider.buildQuery(payload);

  let totalCount: number | null = null;
  let totalCountError: string | null = null;
  if (body.runMatches) {
    try {
      totalCount = await provider.previewMatchCount(query);
    } catch (err) {
      totalCountError = err instanceof Error ? err.message : String(err);
      logger.warn(
        { jobId: body.jobId, err: totalCountError },
        "GitHub query preview: total_count lookup failed",
      );
    }
  }

  res.json({ query, totalCount, totalCountError });
});

// POST /providers/steps  ← must be BEFORE /providers/:id
router.post("/providers/steps", async (req, res) => {
  const body = UpsertProviderStepSettingBody.parse(req.body);

  const [provider] = await db
    .select()
    .from(agentProvidersTable)
    .where(eq(agentProvidersTable.id, body.providerId));
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  const existing = await db
    .select()
    .from(workflowProviderSettingsTable)
    .where(eq(workflowProviderSettingsTable.workflowStep, body.workflowStep));

  let setting;
  if (existing.length > 0) {
    [setting] = await db
      .update(workflowProviderSettingsTable)
      .set({ providerId: body.providerId, enabled: body.enabled })
      .where(eq(workflowProviderSettingsTable.workflowStep, body.workflowStep))
      .returning();
  } else {
    [setting] = await db
      .insert(workflowProviderSettingsTable)
      .values({
        workflowStep: body.workflowStep,
        providerId: body.providerId,
        enabled: body.enabled,
      })
      .returning();
  }

  res.json({ ...setting, provider: serializeRowForApi(provider) });
});

// GET /providers/:id
router.get("/providers/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [provider] = await db
    .select()
    .from(agentProvidersTable)
    .where(eq(agentProvidersTable.id, id));
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  res.json(serializeRowForApi(provider));
});

// PUT /providers/:id
router.put("/providers/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = CreateProviderBody.parse(req.body);

  // The Settings UI never pre-populates the live API key field — it only
  // shows a "•••• last4" hint and a Replace key affordance. So an empty /
  // null `apiKeyPlaceholder` from the client means "leave the saved key
  // alone", not "clear the key". Only persist a new value when the body
  // actually carries one.
  const incomingKey = body.apiKeyPlaceholder;
  const updateApiKey = incomingKey != null && incomingKey !== "";

  const [provider] = await db
    .update(agentProvidersTable)
    .set({
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl ?? null,
      webhookUrl: body.webhookUrl ?? null,
      ...(updateApiKey
        ? { apiKeyEncryptedPlaceholder: encryptProviderSecret(incomingKey) }
        : {}),
      config: body.config ?? null,
      enabled: body.enabled ?? true,
      updatedAt: new Date(),
    })
    .where(eq(agentProvidersTable.id, id))
    .returning();
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  res.json(serializeRowForApi(provider));
});

// DELETE /providers/:id
router.delete("/providers/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.delete(agentProvidersTable).where(eq(agentProvidersTable.id, id));
  res.status(204).send();
});

// POST /providers/:id/toggle
router.post("/providers/:id/toggle", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { enabled } = ToggleProviderBody.parse(req.body);
  const [provider] = await db
    .update(agentProvidersTable)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(agentProvidersTable.id, id))
    .returning();
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  res.json(serializeRowForApi(provider));
});

// POST /providers/:id/test
router.post("/providers/:id/test", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .select()
    .from(agentProvidersTable)
    .where(eq(agentProvidersTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  const start = Date.now();
  try {
    const provider = row.type === "council" ? decisionProviderFromRow(row) : providerFromRow(row);
    const result = await provider.validateConnection();
    const latencyMs = Date.now() - start;
    res.json({ ...result, latencyMs });
  } catch (err) {
    logger.error({ providerId: id, err }, "Provider test failed");
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - start });
  }
});

export default router;
