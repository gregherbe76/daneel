/**
 * Branding loader — Phase 2 of the "1 product + 3 templates" plan.
 *
 * Resolves which template (`hiringai` | `hireflow` | `shortlistpro`) the app
 * is running as, by reading either:
 *   - `process.env.APP_TEMPLATE`           (Node — api-server)
 *   - `import.meta.env.VITE_APP_TEMPLATE`  (Vite — recruiting-os, build-time inlined)
 *
 * Defaults to `hiringai`. Unknown values fall back to `hiringai` with a warning.
 *
 * The full template object is exported as `template` for new consumers.
 * For back-compat with existing consumers (`reports.ts`, `report.tsx`), we also
 * export a flattened `branding` shape with `productName`, `companyName`,
 * `logoUrl`, and a 4-key color palette.
 */

import { branding as hiringai } from "./templates/hiringai/branding";
import { branding as hireflow } from "./templates/hireflow/branding";
import { branding as shortlistpro } from "./templates/shortlistpro/branding";

export type TemplateName = "hiringai" | "hireflow" | "shortlistpro";

const TEMPLATES = { hiringai, hireflow, shortlistpro } as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

function resolveTemplateName(): TemplateName {
  // Vite (browser/build-time replaced). Guarded so Node doesn't crash on `import.meta.env`.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viteVal = (import.meta as any)?.env?.VITE_APP_TEMPLATE as string | undefined;
    if (viteVal && viteVal in TEMPLATES) return viteVal as TemplateName;
  } catch {
    // import.meta unavailable in plain Node CJS — fall through.
  }
  // Node (api-server) — accessed via globalThis to avoid needing @types/node here.
  const proc = g.process;
  const envVal = proc?.env?.APP_TEMPLATE as string | undefined;
  if (envVal) {
    const v = envVal.toLowerCase();
    if (v in TEMPLATES) return v as TemplateName;
    g.console?.warn?.(`[branding] Unknown APP_TEMPLATE="${v}", falling back to "hiringai"`);
  }
  return "hiringai";
}

export const TEMPLATE_NAME: TemplateName = resolveTemplateName();

/** The full template object (rich schema: terms, fonts, stageLabels, featureFlags, …). */
export const template = TEMPLATES[TEMPLATE_NAME];

/**
 * Back-compat flattened branding used by existing report/UI consumers.
 * Maps the rich template into the legacy 4-key shape so we don't have to
 * touch every consumer in this phase.
 */
export const branding = {
  productName: template.productName,
  companyName: template.productName,
  logoUrl: "",
  colors: {
    primary: template.colors.primary,
    accent: template.colors.accent,
    muted: template.colors.textMuted,
    divider: template.colors.border,
  },
} as const;

export type Branding = typeof branding;
export type Template = typeof template;
