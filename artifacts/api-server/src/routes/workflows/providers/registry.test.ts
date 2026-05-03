import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  agentProvidersTable,
  workflowProviderSettingsTable,
} from "@workspace/db";
import { hasRealSourcingProvider } from "./registry";

const TEST_MARKER = "registry.test:";

const seededProviderIds: number[] = [];

afterEach(async () => {
  // Clean up sourcing setting in case a test left one behind, then any
  // providers we seeded. Order matters: settings reference providers via
  // a restrict FK.
  await db
    .delete(workflowProviderSettingsTable)
    .where(eq(workflowProviderSettingsTable.workflowStep, "sourcing"));
  if (seededProviderIds.length > 0) {
    await db
      .delete(agentProvidersTable)
      .where(inArray(agentProvidersTable.id, seededProviderIds));
    seededProviderIds.length = 0;
  }
});

async function seedProvider(opts: {
  type: "github" | "web_search" | "twin_webhook" | "custom_webhook" | "native_openai";
  enabled?: boolean;
  baseUrl?: string;
  webhookUrl?: string;
}) {
  const [row] = await db
    .insert(agentProvidersTable)
    .values({
      name: `${TEST_MARKER}${opts.type}`,
      type: opts.type,
      enabled: opts.enabled ?? true,
      baseUrl: opts.baseUrl ?? null,
      webhookUrl: opts.webhookUrl ?? null,
    })
    .returning();
  if (!row) throw new Error("failed to seed provider");
  seededProviderIds.push(row.id);
  return row;
}

async function assignToSourcing(providerId: number, enabled = true) {
  await db
    .insert(workflowProviderSettingsTable)
    .values({ workflowStep: "sourcing", providerId, enabled })
    .onConflictDoUpdate({
      target: workflowProviderSettingsTable.workflowStep,
      set: { providerId, enabled },
    });
}

describe("hasRealSourcingProvider", () => {
  it("returns false when no sourcing setting is configured", async () => {
    expect(await hasRealSourcingProvider()).toBe(false);
  });

  it("returns true when an enabled GitHub provider is assigned to sourcing", async () => {
    const p = await seedProvider({ type: "github" });
    await assignToSourcing(p.id);
    expect(await hasRealSourcingProvider()).toBe(true);
  });

  it("returns true when an enabled Web Search provider is assigned to sourcing", async () => {
    const p = await seedProvider({ type: "web_search" });
    await assignToSourcing(p.id);
    expect(await hasRealSourcingProvider()).toBe(true);
  });

  it("returns false when only a Twin webhook is assigned (real for engine, but not auto-defaulted in UI)", async () => {
    // Twin/custom webhooks are real providers for the engine's runtime
    // dispatch (isTwin=true), but the kickoff modal deliberately does NOT
    // auto-promote them to default-on, because their webhook config may
    // not be correctly wired in every environment. Recruiters can still
    // flip the toggle manually.
    const p = await seedProvider({ type: "twin_webhook", baseUrl: "https://twin.example.com" });
    await assignToSourcing(p.id);
    expect(await hasRealSourcingProvider()).toBe(false);
  });

  it("returns false when a custom webhook is assigned (engine-real, UI-conservative)", async () => {
    const p = await seedProvider({ type: "custom_webhook", webhookUrl: "https://hook.example.com" });
    await assignToSourcing(p.id);
    expect(await hasRealSourcingProvider()).toBe(false);
  });

  it("returns false when only a native_openai provider is assigned (mock generator)", async () => {
    const p = await seedProvider({ type: "native_openai" });
    await assignToSourcing(p.id);
    expect(await hasRealSourcingProvider()).toBe(false);
  });

  it("returns false when the assigned real provider exists but is disabled", async () => {
    const p = await seedProvider({ type: "github", enabled: false });
    await assignToSourcing(p.id);
    expect(await hasRealSourcingProvider()).toBe(false);
  });

  it("returns false when the sourcing setting itself is disabled", async () => {
    const p = await seedProvider({ type: "github" });
    await assignToSourcing(p.id, /* enabled */ false);
    expect(await hasRealSourcingProvider()).toBe(false);
  });
});
