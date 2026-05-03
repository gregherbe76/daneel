import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Singleton row (id = 1) storing the runtime-editable branding overrides.
 * Any field that is NULL falls back to the static template defaults exposed
 * by `@workspace/branding`. This lets a product owner re-skin the app —
 * including hiring reports — without a code edit and redeploy.
 */
export const brandingSettingsTable = pgTable("branding_settings", {
  id: integer("id").primaryKey().default(1),
  productName: text("product_name"),
  companyName: text("company_name"),
  logoUrl: text("logo_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BrandingSettings = typeof brandingSettingsTable.$inferSelect;
