/**
 * ShortlistPro — Recruiting OS template for recruitment agencies.
 *
 * Audience: external recruiters / staffing agencies who source for multiple
 * client companies and need to deliver polished candidate shortlists fast.
 *
 * Apply this branding by importing it into your app's runtime config and
 * spreading it over the default theme/copy.
 */

export const branding = {
  // ── Identity ───────────────────────────────────────────────────────────────
  productName: "ShortlistPro",
  productTagline: "AI-powered shortlists your clients will actually open.",
  productDescription:
    "ShortlistPro helps recruitment agencies turn raw candidate pools into client-ready shortlists in minutes — with explainable AI scoring, branded reports, and 1-click pipeline actions.",
  domain: "shortlistpro.com",
  supportEmail: "support@shortlistpro.com",

  // ── Audience ───────────────────────────────────────────────────────────────
  primaryUser: "agency recruiter",
  primaryUserPlural: "agency recruiters",
  reportAudience: "client hiring manager",

  // ── Terminology overrides ──────────────────────────────────────────────────
  // The default app uses "candidate" / "job" / "hiring manager report".
  // Agencies usually frame the same concepts around their clients.
  terms: {
    candidate: "candidate",
    candidates: "candidates",
    job: "role",
    jobs: "roles",
    hiringManager: "client",
    report: "client shortlist",
    pipeline: "search",
    application: "submission",
    workflow: "search run",
  },

  // ── Visual identity ────────────────────────────────────────────────────────
  // Confident, premium, agency-grade. Deep navy + warm gold accent.
  colors: {
    primary: "#0F2A4A",        // deep navy — headers, primary CTAs
    primaryFg: "#FFFFFF",
    accent: "#D4A24C",         // warm gold — highlights, badges
    accentFg: "#1A1207",
    success: "#1F8A5B",
    warning: "#C7821A",
    danger: "#B23A3A",
    surface: "#F7F5F0",        // off-white parchment background
    surfaceMuted: "#EFEBE2",
    border: "#E2DCCB",
    text: "#1A1F2C",
    textMuted: "#5B6478",
  },

  // ── Typography ─────────────────────────────────────────────────────────────
  fonts: {
    sans: '"Inter", "Helvetica Neue", system-ui, sans-serif',
    serif: '"Source Serif 4", Georgia, serif', // for client-facing report headers
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },

  // ── Default report framing ─────────────────────────────────────────────────
  // These strings appear at the top of every exported PDF/Markdown shortlist.
  reportDefaults: {
    coverTitle: "Candidate Shortlist",
    coverSubtitle: "Prepared by your recruitment partner",
    decisionSummaryTitle: "Recommended for Your Pipeline",
    nextActionsTitle: "Recommended Next Steps for Your Team",
    footerNote:
      "Confidential — prepared exclusively for the named client. Do not redistribute.",
  },

  // ── Pipeline stage labels ──────────────────────────────────────────────────
  // Maps the underlying stage enum to agency-friendly copy.
  stageLabels: {
    Sourced: "Sourced",
    Contacted: "Engaged",
    Screened: "Pre-screened",
    Interview: "Submitted to client",
    Offer: "Offer extended",
    Hired: "Placed",
    Rejected: "Withdrawn",
  },

  // ── Feature emphasis ───────────────────────────────────────────────────────
  // Hints to the UI about which features to surface most prominently.
  featureFlags: {
    showClientBranding: true,        // let user upload client logo for reports
    multiClientWorkspace: true,      // organize searches by client
    showPlacementFeeTracker: true,   // commercial dashboard
    enableRedactedExports: true,     // hide candidate PII until client signs MSA
    aiOutreachComposer: true,
  },
} as const;

export type Branding = typeof branding;
export default branding;
