export type ProviderCategory =
  | "sourcing"
  | "evaluation"
  | "enrichment"
  | "outreach"
  | "reports";

export interface CategoryMeta {
  key: ProviderCategory;
  label: string;
  accent: string;
  description: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    key: "sourcing",
    label: "Sourcing",
    accent: "#3B82F6",
    description: "Bring net-new candidates into the funnel from real talent pools.",
  },
  {
    key: "evaluation",
    label: "Evaluation",
    accent: "#B794F6",
    description: "Score candidates against the role with task-grade rubrics.",
  },
  {
    key: "enrichment",
    label: "Enrichment",
    accent: "#FBA174",
    description: "Fill in missing profile data before matching runs.",
  },
  {
    key: "outreach",
    label: "Outreach",
    accent: "#FDE047",
    description: "Draft and send the first message for every shortlisted person.",
  },
  {
    key: "reports",
    label: "Reports",
    accent: "#A3E635",
    description: "Turn shortlists into shareable, founder-ready reports.",
  },
];

export type Badge = "a-player" | "free" | "byo-key";

export type StubProvider = {
  kind: "stub";
  id: string;
  name: string;
  category: ProviderCategory;
  oneLiner: string;
  pricing: string;
  badges: Badge[];
  phase: 2 | 3 | 4 | 5;
  logoMark: string;
};

export type ConnectProviderType = "custom_webhook" | "serpapi" | "apify" | "github";

export type ConnectProvider = {
  kind: "connect";
  id: string;
  name: string;
  category: ProviderCategory;
  oneLiner: string;
  pricing: string;
  badges: Badge[];
  connectType: ConnectProviderType;
  helper?: string;
  logoMark: string;
};

export type CatalogEntry = StubProvider | ConnectProvider;

export const CATALOG: CatalogEntry[] = [
  {
    kind: "stub",
    id: "linkedin-recruiter",
    name: "LinkedIn Recruiter Agent",
    category: "sourcing",
    oneLiner:
      "Auto-source on LinkedIn using saved searches, project pipelines, and InMail-ready profiles.",
    pricing: "Premium — pricing TBD at launch",
    badges: ["a-player"],
    phase: 2,
    logoMark: "in",
  },
  {
    kind: "stub",
    id: "twin-evaluator",
    name: "Twin Evaluator",
    category: "evaluation",
    oneLiner:
      "Founder-grade rubric scoring powered by a dedicated Twin agent — explains every score.",
    pricing: "Premium — pricing TBD at launch",
    badges: ["a-player"],
    phase: 3,
    logoMark: "Tw",
  },
  {
    kind: "stub",
    id: "clearbit-enrich",
    name: "Clearbit Enrichment",
    category: "enrichment",
    oneLiner:
      "Hydrate candidates with company, title, location, and seniority data from Clearbit.",
    pricing: "Premium — pricing TBD at launch",
    badges: ["a-player"],
    phase: 4,
    logoMark: "Cb",
  },
  {
    kind: "stub",
    id: "outreach-agent",
    name: "Outreach Agent",
    category: "outreach",
    oneLiner:
      "Drafts and sends a personalized first message to every shortlisted candidate, then routes replies to your inbox.",
    pricing: "Premium — pricing TBD at launch",
    badges: ["a-player"],
    phase: 5,
    logoMark: "Or",
  },
  {
    kind: "connect",
    id: "custom-webhook",
    name: "Custom Webhook",
    category: "evaluation",
    oneLiner:
      "Point any workflow step at your own HTTP endpoint — bring your own model, your own logic.",
    pricing: "Free — works out of the box",
    badges: ["free"],
    connectType: "custom_webhook",
    logoMark: "{}",
  },
  {
    kind: "connect",
    id: "serpapi",
    name: "SerpAPI Web Search",
    category: "sourcing",
    oneLiner:
      "Source real LinkedIn, GitHub, and personal-site profiles via Google search — no fabricated data.",
    pricing: "Free tier on SerpAPI — bring your own key",
    badges: ["free", "byo-key"],
    connectType: "serpapi",
    logoMark: "Sp",
  },
  {
    kind: "connect",
    id: "github-agent",
    name: "GitHub Agent",
    category: "sourcing",
    oneLiner:
      "Source real public GitHub users via the GitHub REST API — no fabricated profiles.",
    pricing: "Free — set GITHUB_TOKEN secret for higher rate limits",
    badges: ["free"],
    connectType: "github",
    logoMark: "Gh",
  },
  {
    kind: "connect",
    id: "apify",
    name: "Apify Scrapers",
    category: "sourcing",
    oneLiner:
      "Run Apify actors to scrape LinkedIn search, GitHub, and Twitter into the candidate pipeline.",
    pricing: "Free tier on Apify — bring your own key",
    badges: ["free", "byo-key"],
    connectType: "apify",
    logoMark: "Ap",
  },
];

export const PHASE_COPY: Record<2 | 3 | 4 | 5, string> = {
  2: "Coming in Phase 2 — sourcing expansion",
  3: "Coming in Phase 3 — evaluation upgrades",
  4: "Coming in Phase 4 — enrichment partners",
  5: "Coming in Phase 5 — outreach & inbox",
};
