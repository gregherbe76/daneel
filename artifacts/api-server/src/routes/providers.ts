import { Router } from "express";
import { db, agentProvidersTable, workflowProviderSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateProviderBody,
  ToggleProviderBody,
  UpsertProviderStepSettingBody,
} from "@workspace/api-zod";
import { providerFromRow } from "./workflows/providers";
import { logger } from "../lib/logger";

const router = Router();

// GET /providers
router.get("/providers", async (_req, res) => {
  const providers = await db
    .select()
    .from(agentProvidersTable)
    .orderBy(agentProvidersTable.createdAt);
  res.json(providers);
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
      apiKeyEncryptedPlaceholder: body.apiKeyPlaceholder ?? null,
      config: body.config ?? null,
      enabled: body.enabled ?? true,
    })
    .returning();
  res.status(201).json(provider);
});

// GET /providers/steps  ← must be BEFORE /providers/:id
router.get("/providers/steps", async (_req, res) => {
  const settings = await db.select().from(workflowProviderSettingsTable);
  const providers = await db.select().from(agentProvidersTable);
  const providerMap = new Map(providers.map((p) => [p.id, p]));

  const result = settings.map((s) => ({
    ...s,
    provider: providerMap.get(s.providerId),
  }));
  res.json(result);
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

  res.json({ ...setting, provider });
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
  res.json(provider);
});

// PUT /providers/:id
router.put("/providers/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = CreateProviderBody.parse(req.body);
  const [provider] = await db
    .update(agentProvidersTable)
    .set({
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl ?? null,
      webhookUrl: body.webhookUrl ?? null,
      apiKeyEncryptedPlaceholder: body.apiKeyPlaceholder ?? null,
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
  res.json(provider);
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
  res.json(provider);
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
    const provider = providerFromRow(row);
    const result = await provider.validateConnection();
    const latencyMs = Date.now() - start;
    res.json({ ...result, latencyMs });
  } catch (err) {
    logger.error({ providerId: id, err }, "Provider test failed");
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - start });
  }
});

export default router;
