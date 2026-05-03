import { Router } from "express";
import { db, brandingSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { branding as defaultBranding } from "@workspace/branding";
import { UpdateBrandingSettingsBody } from "@workspace/api-zod";
import { assertSafeLogoUrlShape, UrlNotAllowedError } from "../lib/safe-fetch";

const router = Router();

const SINGLETON_ID = 1;

/**
 * Reads the singleton branding row and merges it with the static template
 * defaults from `@workspace/branding`. Any nullable column falls back to the
 * compiled-in template value, so consumers (reports, layout, etc.) always get
 * a fully populated object.
 */
export async function loadBrandingSettings() {
  const [row] = await db
    .select()
    .from(brandingSettingsTable)
    .where(eq(brandingSettingsTable.id, SINGLETON_ID));
  return {
    productName: row?.productName?.trim() || defaultBranding.productName,
    companyName: row?.companyName?.trim() || defaultBranding.companyName,
    logoUrl: row?.logoUrl?.trim() || defaultBranding.logoUrl,
    updatedAt: row?.updatedAt ?? null,
  };
}

router.get("/branding", async (_req, res) => {
  const branding = await loadBrandingSettings();
  res.json(branding);
});

router.put("/branding", async (req, res) => {
  const body = UpdateBrandingSettingsBody.parse(req.body);

  // Treat empty / whitespace-only strings as "clear to template default".
  const norm = (v?: string | null) => {
    if (v === undefined) return undefined;
    const t = (v ?? "").trim();
    return t.length === 0 ? null : t;
  };

  const values = {
    productName: norm(body.productName),
    companyName: norm(body.companyName),
    logoUrl: norm(body.logoUrl),
  };

  // SSRF guardrail: the server later fetches this URL to embed in PDF
  // reports, so refuse anything that doesn't shape up as a public https URL.
  // The deeper DNS-resolution check happens at fetch time.
  if (typeof values.logoUrl === "string") {
    try {
      assertSafeLogoUrlShape(values.logoUrl);
    } catch (err) {
      const msg = err instanceof UrlNotAllowedError ? err.message : "Invalid logo URL";
      res.status(400).json({ error: msg });
      return;
    }
  }

  const [existing] = await db
    .select()
    .from(brandingSettingsTable)
    .where(eq(brandingSettingsTable.id, SINGLETON_ID));

  if (existing) {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["productName", "companyName", "logoUrl"] as const) {
      if (values[k] !== undefined) update[k] = values[k];
    }
    await db
      .update(brandingSettingsTable)
      .set(update)
      .where(eq(brandingSettingsTable.id, SINGLETON_ID));
  } else {
    await db.insert(brandingSettingsTable).values({
      id: SINGLETON_ID,
      productName: values.productName ?? null,
      companyName: values.companyName ?? null,
      logoUrl: values.logoUrl ?? null,
    });
  }

  const branding = await loadBrandingSettings();
  res.json(branding);
});

export default router;
