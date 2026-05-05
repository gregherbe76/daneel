import { Router } from "express";
import { db, brandingSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { branding as defaultBranding } from "@workspace/branding";
import { UpdateBrandingSettingsBody } from "@workspace/api-zod";
import { assertSafeLogoUrlShape, UrlNotAllowedError } from "../lib/safe-fetch";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();

const router = Router();

const SINGLETON_ID = 1;

/**
 * Reads the singleton branding row and merges it with the static template
 * defaults from `@workspace/branding`. Any nullable column falls back to the
 * compiled-in template value, so consumers (reports, layout, etc.) always get
 * a fully populated object.
 */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export async function loadBrandingSettings() {
  const [row] = await db
    .select()
    .from(brandingSettingsTable)
    .where(eq(brandingSettingsTable.id, SINGLETON_ID));
  return {
    productName: row?.productName?.trim() || defaultBranding.productName,
    companyName: row?.companyName?.trim() || defaultBranding.companyName,
    logoUrl: row?.logoUrl?.trim() || defaultBranding.logoUrl,
    colorPrimary: row?.colorPrimary?.trim() || defaultBranding.colors.primary,
    colorAccent: row?.colorAccent?.trim() || defaultBranding.colors.accent,
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
    colorPrimary: norm(body.colorPrimary),
    colorAccent: norm(body.colorAccent),
  };

  // Validate hex colors. Empty/cleared values are normalized to null above
  // and skip validation (they restore the template default).
  for (const k of ["colorPrimary", "colorAccent"] as const) {
    const v = values[k];
    if (typeof v === "string" && !HEX_COLOR_RE.test(v)) {
      res.status(400).json({
        error: `${k} must be a 6-digit hex color like "#7C5CFF"`,
      });
      return;
    }
  }

  // SSRF guardrail: the server later fetches this URL to embed in PDF
  // reports, so refuse anything that doesn't shape up as a public https URL.
  // The deeper DNS-resolution check happens at fetch time.
  // Exception: object storage paths (`/objects/...`) are produced by our own
  // upload endpoint and are loaded directly from GCS, never fetched over HTTP.
  if (typeof values.logoUrl === "string" && !values.logoUrl.startsWith("/objects/")) {
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
    for (const k of [
      "productName",
      "companyName",
      "logoUrl",
      "colorPrimary",
      "colorAccent",
    ] as const) {
      if (values[k] !== undefined) update[k] = values[k];
    }
    // If the logo is being changed (replaced with a new one or cleared) and
    // the previous value pointed at an object-storage entity we own, delete
    // the old file so storage doesn't accumulate orphaned uploads.
    if (
      values.logoUrl !== undefined &&
      typeof existing.logoUrl === "string" &&
      existing.logoUrl.startsWith("/objects/") &&
      existing.logoUrl !== values.logoUrl
    ) {
      try {
        await objectStorageService.deleteObjectEntity(existing.logoUrl);
      } catch (err) {
        req.log.warn(
          { err, prevLogoUrl: existing.logoUrl },
          "Failed to delete previous logo from object storage",
        );
      }
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
      colorPrimary: values.colorPrimary ?? null,
      colorAccent: values.colorAccent ?? null,
    });
  }

  const branding = await loadBrandingSettings();
  res.json(branding);
});

export default router;
