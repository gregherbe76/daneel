/**
 * Branding loader.
 *
 * Resolves which template the app is running as, by reading either:
 *   - `process.env.APP_TEMPLATE`           (Node — api-server)
 *   - `import.meta.env.VITE_APP_TEMPLATE`  (Vite — recruiting-os, build-time inlined)
 *
 * Default template is `daneel` — the engine's own open-source surface.
 * `hiringai` remains shipped as a startup-tuned alternative template.
 * Unknown values fall back to `daneel` with a warning.
 *
 * The full template object is exported as `template` for new consumers.
 * For back-compat with existing consumers (`reports.ts`, `report.tsx`), we also
 * export a flattened `branding` shape with `productName`, `companyName`,
 * `logoUrl`, and a 4-key color palette.
 */

import { branding as daneel } from "./templates/daneel/branding";
import { prompts as daneelPrompts } from "./templates/daneel/prompts";
import { branding as hiringai } from "./templates/hiringai/branding";
import { prompts as hiringaiPrompts } from "./templates/hiringai/prompts";

export type TemplateName = "daneel" | "hiringai";

const TEMPLATES = {
  daneel: { ...daneel, prompts: daneelPrompts },
  hiringai: { ...hiringai, prompts: hiringaiPrompts },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

function resolveTemplateName(): TemplateName {
  // Vite (browser/build-time replaced). The bare `import.meta.env.VITE_APP_TEMPLATE`
  // form is REQUIRED — Vite's static replacement regex won't match if you put
  // optional chaining (`?.`) between `import.meta` and `env` or between `env` and
  // the var name. Wrapped in try/catch so Node ESM (no env) doesn't crash.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viteVal = (import.meta as any).env.VITE_APP_TEMPLATE as string | undefined;
    if (viteVal && viteVal in TEMPLATES) return viteVal as TemplateName;
  } catch {
    // import.meta.env unavailable in plain Node — fall through to process.env.
  }
  // Node (api-server) — accessed via globalThis to avoid needing @types/node here.
  const proc = g.process;
  const envVal = proc?.env?.APP_TEMPLATE as string | undefined;
  if (envVal) {
    const v = envVal.toLowerCase();
    if (v in TEMPLATES) return v as TemplateName;
    g.console?.warn?.(`[branding] Unknown APP_TEMPLATE="${v}", falling back to "daneel"`);
  }
  return "daneel";
}

export const TEMPLATE_NAME: TemplateName = resolveTemplateName();

/** The full template object (rich schema: terms, fonts, stageLabels, featureFlags, prompts, …). */
export const template = TEMPLATES[TEMPLATE_NAME];

/** Prompt builders for the active template — used by the workflow engine. */
export const prompts = template.prompts;
export type { Prompts } from "./templates/daneel/prompts";

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
