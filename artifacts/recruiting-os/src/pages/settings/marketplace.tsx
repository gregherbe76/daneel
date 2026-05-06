import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProviders,
  useListProviderStepSettings,
  useCreateProvider,
  useUpdateProvider,
  useUpsertProviderStepSetting,
  getListProvidersQueryKey,
  getListProviderStepSettingsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { SettingsTabs } from "@/components/settings-tabs";
import {
  CATALOG,
  CATEGORIES,
  PHASE_COPY,
  TWIN_YELLOW,
  type CatalogEntry,
  type ConnectProvider,
  type ConnectProviderType,
  type ProviderCategory,
  type StubProvider,
} from "./marketplace/catalog";
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  AlertTriangle,
  KeyRound,
  ChevronDown,
  ChevronRight,
  Settings2,
} from "lucide-react";
import { track as trackTelemetry } from "@/lib/telemetry";

type ProviderRecord = {
  id: number;
  name: string;
  type: string;
  webhookUrl?: string | null;
  baseUrl?: string | null;
  enabled: boolean;
  config?: {
    github?: GithubProviderConfig | null;
    web_search?: WebSearchProviderConfig | null;
    twin_agent?: TwinAgentProviderConfig | null;
    apify?: ApifyProviderConfig | null;
  } | null;
};

interface GithubProviderConfig {
  extraKeywords?: string | null;
  excludeOrgs?: string | null;
  minFollowers?: number | null;
  minRepos?: number | null;
  requireBio?: boolean | null;
  activeWithinMonths?: number | null;
}

interface WebSearchProviderConfig {
  extraKeywords?: string | null;
  targetSites?: string[] | null;
  excludeSites?: string[] | null;
}

interface TwinAgentProviderConfig {
  baseUrl?: string | null;
  streaming?: boolean | null;
}

interface ApifyProviderConfig {
  actorId?: string | null;
  extraKeywords?: string | null;
  targetSites?: string[] | null;
  excludeSites?: string[] | null;
  resultsPerPage?: number | null;
}

type WorkflowStep =
  | "job_understanding"
  | "candidate_matching"
  | "shortlist_generation"
  | "sourcing"
  | "enrichment";

const WORKFLOW_STEP_LABELS: Record<WorkflowStep, string> = {
  job_understanding: "Job Understanding",
  candidate_matching: "Candidate Matching",
  shortlist_generation: "Shortlist Generation",
  sourcing: "Sourcing",
  enrichment: "Enrichment",
};

/**
 * Workflow steps each marketplace provider type can power. Used to render the
 * inline step picker on connected cards so recruiters never have to leave the
 * marketplace to wire a connected provider into the pipeline.
 */
const APPLICABLE_STEPS: Record<ConnectProviderType, WorkflowStep[]> = {
  custom_webhook: [
    "job_understanding",
    "candidate_matching",
    "shortlist_generation",
    "sourcing",
    "enrichment",
  ],
  serpapi: ["sourcing"],
  github: ["sourcing"],
  twin_agent: ["sourcing"],
  apify: ["sourcing"],
};

/** Maps a marketplace connectType to the underlying provider `type` column. */
function providerTypeFor(connectType: ConnectProviderType): string | null {
  if (connectType === "custom_webhook") return "custom_webhook";
  if (connectType === "serpapi") return "web_search";
  if (connectType === "github") return "github";
  if (connectType === "apify") return "apify";
  if (connectType === "twin_agent") return "twin_agent";
  return null;
}

function findProviderForEntry(
  entry: ConnectProvider,
  providers: ProviderRecord[],
): ProviderRecord | null {
  const type = providerTypeFor(entry.connectType);
  if (!type) return null;
  return providers.find((p) => p.type === type) ?? null;
}

type ConnState = "connected" | "action_required" | "disconnected";

function deriveState(entry: ConnectProvider, providers: ProviderRecord[]): ConnState {
  if (entry.connectType === "custom_webhook") {
    const p = providers.find((x) => x.type === "custom_webhook");
    if (!p) return "disconnected";
    if (!p.webhookUrl) return "action_required";
    return p.enabled ? "connected" : "action_required";
  }
  if (entry.connectType === "serpapi") {
    const p = providers.find((x) => x.type === "web_search");
    if (!p) return "disconnected";
    return p.enabled ? "connected" : "action_required";
  }
  if (entry.connectType === "github") {
    const p = providers.find((x) => x.type === "github");
    if (!p) return "disconnected";
    return p.enabled ? "connected" : "action_required";
  }
  if (entry.connectType === "twin_agent") {
    const p = providers.find((x) => x.type === "twin_agent");
    if (!p) return "disconnected";
    return p.enabled ? "connected" : "action_required";
  }
  if (entry.connectType === "apify") {
    const p = providers.find((x) => x.type === "apify");
    if (!p) return "disconnected";
    return p.enabled ? "connected" : "action_required";
  }
  return "disconnected";
}

function StatusPill({ state }: { state: ConnState }) {
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 bg-green-500/10 border border-green-500/30 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="h-3 w-3" />
        Connected
      </span>
    );
  }
  if (state === "action_required") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
        <AlertTriangle className="h-3 w-3" />
        Action required
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted/50 border border-border px-2 py-0.5 rounded-full">
      Disconnected
    </span>
  );
}

function BadgeRow({ badges }: { badges: CatalogEntry["badges"] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => {
        if (b === "a-player") {
          return (
            <Badge
              key={b}
              className="bg-amber-500/15 text-amber-700 border border-amber-500/30 hover:bg-amber-500/15 gap-1"
            >
              <Sparkles className="h-3 w-3" />
              A-Player
            </Badge>
          );
        }
        if (b === "free") {
          return (
            <Badge
              key={b}
              className="bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 hover:bg-emerald-500/15"
            >
              Free
            </Badge>
          );
        }
        if (b === "twin") {
          return (
            <Badge
              key={b}
              className="border border-black/20 hover:opacity-90 gap-1 text-black"
              style={{ backgroundColor: TWIN_YELLOW }}
              data-testid="badge-twin"
            >
              Twin
            </Badge>
          );
        }
        return (
          <Badge
            key={b}
            className="bg-sky-500/15 text-sky-700 border border-sky-500/30 hover:bg-sky-500/15 gap-1"
          >
            <KeyRound className="h-3 w-3" />
            BYO key
          </Badge>
        );
      })}
    </div>
  );
}

function LogoMark({ accent, mark }: { accent: string; mark: string }) {
  return (
    <div
      className="h-10 w-10 rounded-md flex items-center justify-center text-sm font-bold text-white shrink-0"
      style={{ backgroundColor: accent }}
    >
      {mark}
    </div>
  );
}

function ComingSoonDialog({
  entry,
  open,
  onOpenChange,
  accent,
}: {
  entry: StubProvider | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accent: string;
}) {
  if (!entry) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="coming-soon-dialog">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <LogoMark accent={accent} mark={entry.logoMark} />
            <div>
              <DialogTitle>{entry.name}</DialogTitle>
              <DialogDescription className="mt-1">{entry.oneLiner}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-800">
          <Sparkles className="h-4 w-4 inline mr-1.5 -mt-0.5" />
          {PHASE_COPY[entry.phase]}
        </div>
        <p className="text-xs text-muted-foreground">
          We're staging A-Player providers behind a verified roll-out. You'll see this card flip to
          a real Connect flow as soon as the integration is live.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Parses a comma/space/newline-separated free-text field into a clean array. */
function splitSites(input: string): string[] | null {
  if (!input) return null;
  const parts = input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function parsePositiveInt(input: string): number | null {
  const n = parseInt(input.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ConnectDialog({
  entry,
  open,
  onOpenChange,
  providers,
  accent,
}: {
  entry: ConnectProvider | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  providers: ProviderRecord[];
  accent: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // GitHub Agent tuning
  const [ghExtraKeywords, setGhExtraKeywords] = useState("");
  const [ghExcludeOrgs, setGhExcludeOrgs] = useState("");
  const [ghMinFollowers, setGhMinFollowers] = useState("");
  const [ghMinRepos, setGhMinRepos] = useState("");
  const [ghRequireBio, setGhRequireBio] = useState(false);
  const [ghActiveWithinMonths, setGhActiveWithinMonths] = useState("");

  // Web Search tuning
  const [wsExtraKeywords, setWsExtraKeywords] = useState("");
  const [wsTargetSites, setWsTargetSites] = useState("");
  const [wsExcludeSites, setWsExcludeSites] = useState("");

  // Twin Agent Browser tuning
  const [twinBaseUrl, setTwinBaseUrl] = useState("");
  const [twinStreaming, setTwinStreaming] = useState(false);

  // Apify tuning
  const [apifyActorId, setApifyActorId] = useState("");
  const [apifyExtraKeywords, setApifyExtraKeywords] = useState("");
  const [apifyTargetSites, setApifyTargetSites] = useState("");
  const [apifyExcludeSites, setApifyExcludeSites] = useState("");
  const [apifyResultsPerPage, setApifyResultsPerPage] = useState("");

  const existing = useMemo(() => {
    if (!entry) return null;
    return findProviderForEntry(entry, providers);
  }, [entry, providers]);

  // Sync inputs when dialog opens. useEffect (not useMemo) so React schedules
  // a render after we update state — useMemo runs during render and won't
  // commit setState reliably across opens of the same dialog instance.
  useEffect(() => {
    if (!open || !entry) return;
    setAdvancedOpen(false);
    if (entry.connectType === "custom_webhook") {
      setWebhookUrl(existing?.webhookUrl ?? "");
    } else {
      setApiKey("");
    }
    if (entry.connectType === "github") {
      const cfg = existing?.config?.github ?? null;
      setGhExtraKeywords(cfg?.extraKeywords ?? "");
      setGhExcludeOrgs(cfg?.excludeOrgs ?? "");
      setGhMinFollowers(cfg?.minFollowers != null ? String(cfg.minFollowers) : "");
      setGhMinRepos(cfg?.minRepos != null ? String(cfg.minRepos) : "");
      setGhRequireBio(cfg?.requireBio === true);
      setGhActiveWithinMonths(
        cfg?.activeWithinMonths != null ? String(cfg.activeWithinMonths) : "",
      );
    }
    if (entry.connectType === "serpapi") {
      const cfg = existing?.config?.web_search ?? null;
      setWsExtraKeywords(cfg?.extraKeywords ?? "");
      setWsTargetSites(cfg?.targetSites?.join(", ") ?? "");
      setWsExcludeSites(cfg?.excludeSites?.join(", ") ?? "");
    }
    if (entry.connectType === "twin_agent") {
      const cfg = existing?.config?.twin_agent ?? null;
      setTwinBaseUrl(cfg?.baseUrl ?? "");
      setTwinStreaming(cfg?.streaming === true);
    }
    if (entry.connectType === "apify") {
      const cfg = existing?.config?.apify ?? null;
      setApifyActorId(cfg?.actorId ?? "");
      setApifyExtraKeywords(cfg?.extraKeywords ?? "");
      setApifyTargetSites(cfg?.targetSites?.join(", ") ?? "");
      setApifyExcludeSites(cfg?.excludeSites?.join(", ") ?? "");
      setApifyResultsPerPage(
        cfg?.resultsPerPage != null ? String(cfg.resultsPerPage) : "",
      );
    }
  }, [open, entry, existing]);

  if (!entry) return null;

  async function handleSave() {
    if (!entry) return;
    setSubmitting(true);
    try {
      if (entry.connectType === "custom_webhook") {
        const payload = {
          name: "Custom Webhook",
          type: "custom_webhook" as const,
          webhookUrl: webhookUrl || null,
          baseUrl: null,
          apiKeyPlaceholder: null,
          config: null,
          enabled: true,
        };
        if (existing) {
          await update.mutateAsync({ id: existing.id, data: payload });
        } else {
          await create.mutateAsync({ data: payload });
        }
        await qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
        toast({ title: "Custom Webhook connected" });
      } else if (entry.connectType === "serpapi") {
        const wsConfig: WebSearchProviderConfig = {
          extraKeywords: wsExtraKeywords.trim() || null,
          targetSites: splitSites(wsTargetSites),
          excludeSites: splitSites(wsExcludeSites),
        };
        const hasWsConfig =
          wsConfig.extraKeywords ||
          (wsConfig.targetSites && wsConfig.targetSites.length > 0) ||
          (wsConfig.excludeSites && wsConfig.excludeSites.length > 0);
        const payload = {
          name: "SerpAPI Web Search",
          type: "web_search" as const,
          webhookUrl: null,
          baseUrl: null,
          apiKeyPlaceholder: apiKey
            ? apiKey
            : existing?.apiKeyPlaceholder ?? null,
          config: hasWsConfig ? { web_search: wsConfig } : null,
          enabled: true,
        };
        if (existing) {
          await update.mutateAsync({ id: existing.id, data: payload });
        } else {
          await create.mutateAsync({ data: payload });
        }
        await qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
        toast({
          title: "SerpAPI saved",
          description: "Set the SERPAPI_KEY env secret to enable real web sourcing.",
        });
      } else if (entry.connectType === "github") {
        const ghConfig: GithubProviderConfig = {
          extraKeywords: ghExtraKeywords.trim() || null,
          excludeOrgs: ghExcludeOrgs.trim() || null,
          minFollowers: parsePositiveInt(ghMinFollowers),
          minRepos: parsePositiveInt(ghMinRepos),
          requireBio: ghRequireBio ? true : null,
          activeWithinMonths: parsePositiveInt(ghActiveWithinMonths),
        };
        const hasGhConfig =
          ghConfig.extraKeywords ||
          ghConfig.excludeOrgs ||
          ghConfig.minFollowers != null ||
          ghConfig.minRepos != null ||
          ghConfig.requireBio === true ||
          ghConfig.activeWithinMonths != null;
        const payload = {
          name: "GitHub Agent",
          type: "github" as const,
          webhookUrl: null,
          baseUrl: null,
          apiKeyPlaceholder: null,
          config: hasGhConfig ? { github: ghConfig } : null,
          enabled: true,
        };
        if (existing) {
          await update.mutateAsync({ id: existing.id, data: payload });
        } else {
          await create.mutateAsync({ data: payload });
        }
        await qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
        toast({ title: "GitHub Agent connected" });
      } else if (entry.connectType === "twin_agent") {
        const twinConfig: TwinAgentProviderConfig = {
          baseUrl: twinBaseUrl.trim() || null,
          streaming: twinStreaming || null,
        };
        const hasTwinConfig =
          (twinConfig.baseUrl && twinConfig.baseUrl.length > 0) ||
          twinConfig.streaming === true;
        const payload = {
          name: "Twin Agent Browser",
          type: "twin_agent" as const,
          webhookUrl: null,
          baseUrl: null,
          apiKeyPlaceholder: apiKey || null,
          config: hasTwinConfig ? { twin_agent: twinConfig } : null,
          enabled: true,
        };
        if (existing) {
          await update.mutateAsync({ id: existing.id, data: payload });
        } else {
          await create.mutateAsync({ data: payload });
        }
        await qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
        toast({
          title: "Twin Agent Browser connected",
          description:
            "Paste your Twin API key from twin.aplayer.ai → Settings to enable agent-browsed sourcing.",
        });
      } else if (entry.connectType === "apify") {
        const apifyConfig: ApifyProviderConfig = {
          actorId: apifyActorId.trim() || null,
          extraKeywords: apifyExtraKeywords.trim() || null,
          targetSites: splitSites(apifyTargetSites),
          excludeSites: splitSites(apifyExcludeSites),
          resultsPerPage: parsePositiveInt(apifyResultsPerPage),
        };
        const hasApifyConfig =
          !!apifyConfig.actorId ||
          !!apifyConfig.extraKeywords ||
          (apifyConfig.targetSites && apifyConfig.targetSites.length > 0) ||
          (apifyConfig.excludeSites && apifyConfig.excludeSites.length > 0) ||
          apifyConfig.resultsPerPage != null;
        const payload = {
          name: "Apify Scrapers",
          type: "apify" as const,
          webhookUrl: null,
          baseUrl: null,
          apiKeyPlaceholder: apiKey
            ? apiKey
            : existing?.apiKeyPlaceholder ?? null,
          config: hasApifyConfig ? { apify: apifyConfig } : null,
          enabled: true,
        };
        if (existing) {
          await update.mutateAsync({ id: existing.id, data: payload });
        } else {
          await create.mutateAsync({ data: payload });
        }
        await qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
        toast({
          title: "Apify Scrapers connected",
          description: apiKey
            ? "Token saved — assign Apify to the sourcing step in Workflow Step Assignments."
            : "Provider registered. Add an Apify token (or set APIFY_TOKEN as a project secret) to enable real sourcing.",
        });
      }
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[85vh] overflow-y-auto"
        data-testid={`connect-dialog-${entry.connectType}`}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <LogoMark accent={accent} mark={entry.logoMark} />
            <div>
              <DialogTitle>Connect {entry.name}</DialogTitle>
              <DialogDescription className="mt-1">{entry.oneLiner}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {entry.connectType === "custom_webhook" && (
          <div className="space-y-2">
            <Label htmlFor="cw-url">Webhook URL (optional)</Label>
            <Input
              id="cw-url"
              placeholder="https://your-api.com/workflow"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              data-testid="custom-webhook-url"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to register the provider without a target — you can wire it up to a step
              from the card below once it's connected.
            </p>
          </div>
        )}

        {entry.connectType === "serpapi" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="serp-key">SerpAPI key (optional placeholder)</Label>
              <Input
                id="serp-key"
                type="password"
                placeholder="serpapi-…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="new-password"
                data-testid="serpapi-key"
              />
              <p className="text-xs text-muted-foreground">
                For real sourcing, also set the <code className="text-xs">SERPAPI_KEY</code> env
                secret on the API server.
              </p>
            </div>

            <AdvancedToggle open={advancedOpen} onToggle={setAdvancedOpen} />

            {advancedOpen && (
              <div
                className="space-y-3 rounded-md border border-border p-3"
                data-testid="serpapi-advanced"
              >
                <div className="space-y-1.5">
                  <Label>Extra keywords</Label>
                  <Input
                    placeholder="e.g. remote fintech open-source"
                    value={wsExtraKeywords}
                    onChange={(e) => setWsExtraKeywords(e.target.value)}
                    data-testid="ws-extra-keywords"
                  />
                  <p className="text-xs text-muted-foreground">
                    Free-text terms appended verbatim to every Google query.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Target sites</Label>
                  <Input
                    placeholder="e.g. linkedin.com/in, github.com"
                    value={wsTargetSites}
                    onChange={(e) => setWsTargetSites(e.target.value)}
                    data-testid="ws-target-sites"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated. Defaults to <code className="text-xs">linkedin.com/in</code>{" "}
                    and <code className="text-xs">github.com</code> when empty.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Exclude sites</Label>
                  <Input
                    placeholder="e.g. pinterest.com, slideshare.net"
                    value={wsExcludeSites}
                    onChange={(e) => setWsExcludeSites(e.target.value)}
                    data-testid="ws-exclude-sites"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated domains dropped from results via{" "}
                    <code className="text-xs">-site:</code>.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {entry.connectType === "github" && (
          <div className="space-y-3">
            <div className="rounded-md bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
              Sources real public GitHub users via the GitHub REST API. Set the{" "}
              <code className="text-xs">GITHUB_TOKEN</code> secret on the API server to lift the
              ~60 req/hour anonymous rate limit.
            </div>

            <AdvancedToggle open={advancedOpen} onToggle={setAdvancedOpen} />

            {advancedOpen && (
              <div
                className="space-y-3 rounded-md border border-border p-3"
                data-testid="github-advanced"
              >
                <div className="space-y-1.5">
                  <Label>Extra keywords</Label>
                  <Input
                    placeholder="e.g. open source fintech"
                    value={ghExtraKeywords}
                    onChange={(e) => setGhExtraKeywords(e.target.value)}
                    data-testid="gh-extra-keywords"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Exclude orgs / users</Label>
                  <Input
                    placeholder="e.g. google, microsoft, meta"
                    value={ghExcludeOrgs}
                    onChange={(e) => setGhExcludeOrgs(e.target.value)}
                    data-testid="gh-exclude-orgs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Min followers</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      placeholder="e.g. 50"
                      value={ghMinFollowers}
                      onChange={(e) => setGhMinFollowers(e.target.value)}
                      data-testid="gh-min-followers"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Min public repos</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      placeholder="e.g. 5"
                      value={ghMinRepos}
                      onChange={(e) => setGhMinRepos(e.target.value)}
                      data-testid="gh-min-repos"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor="gh-require-bio">Require non-empty bio</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Drop candidates whose GitHub profile bio is empty.
                    </p>
                  </div>
                  <Switch
                    id="gh-require-bio"
                    checked={ghRequireBio}
                    onCheckedChange={setGhRequireBio}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Active within (months)</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    placeholder="e.g. 6"
                    value={ghActiveWithinMonths}
                    onChange={(e) => setGhActiveWithinMonths(e.target.value)}
                    data-testid="gh-active-within"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {entry.connectType === "twin_agent" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="twin-key">Twin API key</Label>
              <Input
                id="twin-key"
                type="password"
                placeholder="twin_sk_…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="new-password"
                data-testid="twin-agent-key"
              />
              <p className="text-xs text-muted-foreground">
                Get your key from <code className="text-xs">twin.aplayer.ai</code> → Settings →
                API. Sent as <code className="text-xs">Authorization: Bearer …</code> on every
                browsing run; quota and pricing are enforced by Twin.
              </p>
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="twin-streaming" className="text-xs font-medium">
                  Stream candidates as they're found
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Twin pushes partial cards over SSE while the browser agent is still working.
                  Leave off for a single sync JSON response (more reliable on flaky networks).
                </p>
              </div>
              <Switch
                id="twin-streaming"
                checked={twinStreaming}
                onCheckedChange={setTwinStreaming}
                data-testid="twin-agent-streaming"
              />
            </div>

            <AdvancedToggle open={advancedOpen} onToggle={setAdvancedOpen} />

            {advancedOpen && (
              <div
                className="space-y-3 rounded-md border border-border p-3"
                data-testid="twin-agent-advanced"
              >
                <div className="space-y-1.5">
                  <Label>Base URL override</Label>
                  <Input
                    placeholder="https://twin.aplayer.ai"
                    value={twinBaseUrl}
                    onChange={(e) => setTwinBaseUrl(e.target.value)}
                    data-testid="twin-agent-base-url"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank for production. Override only when pointing at a Twin staging or
                    self-hosted deployment.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {entry.connectType === "apify" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="apify-key">Apify API token</Label>
              <Input
                id="apify-key"
                type="password"
                placeholder="apify_api_…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="new-password"
                data-testid="apify-key"
              />
              <p className="text-xs text-muted-foreground">
                The token is sent to the Apify API as <code className="text-xs">Authorization: Bearer …</code>.
                You can override it by setting the <code className="text-xs">APIFY_TOKEN</code> env
                secret on the API server. Then assign Apify to the sourcing step in Workflow Step
                Assignments.
              </p>
            </div>

            <AdvancedToggle open={advancedOpen} onToggle={setAdvancedOpen} />

            {advancedOpen && (
              <div
                className="space-y-3 rounded-md border border-border p-3"
                data-testid="apify-advanced"
              >
                <div className="space-y-1.5">
                  <Label>Actor ID</Label>
                  <Input
                    placeholder="apify/google-search-scraper"
                    value={apifyActorId}
                    onChange={(e) => setApifyActorId(e.target.value)}
                    data-testid="apify-actor-id"
                  />
                  <p className="text-xs text-muted-foreground">
                    Defaults to <code className="text-xs">apify/google-search-scraper</code> for
                    broad Boolean queries. Other compatible actors:{" "}
                    <code className="text-xs">curious_coder/linkedin-people-search-scraper</code>{" "}
                    for dedicated LinkedIn sourcing, or{" "}
                    <code className="text-xs">apify/bing-search-scraper</code> as a Google
                    alternative. The actor must return rows shaped like Google organic results
                    (<code className="text-xs">title</code>, <code className="text-xs">url</code>,{" "}
                    <code className="text-xs">description</code>) — either flat or nested under{" "}
                    <code className="text-xs">organicResults[]</code>.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Extra keywords</Label>
                  <Input
                    placeholder="e.g. remote fintech open-source"
                    value={apifyExtraKeywords}
                    onChange={(e) => setApifyExtraKeywords(e.target.value)}
                    data-testid="apify-extra-keywords"
                  />
                  <p className="text-xs text-muted-foreground">
                    Free-text terms appended verbatim to every query.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Target sites</Label>
                  <Input
                    placeholder="e.g. linkedin.com/in, github.com"
                    value={apifyTargetSites}
                    onChange={(e) => setApifyTargetSites(e.target.value)}
                    data-testid="apify-target-sites"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated. Defaults to <code className="text-xs">linkedin.com/in</code>{" "}
                    and <code className="text-xs">github.com</code> when empty.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Exclude sites</Label>
                  <Input
                    placeholder="e.g. pinterest.com, slideshare.net"
                    value={apifyExcludeSites}
                    onChange={(e) => setApifyExcludeSites(e.target.value)}
                    data-testid="apify-exclude-sites"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated domains dropped via{" "}
                    <code className="text-xs">-site:</code>.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Max results per run</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    placeholder="20"
                    value={apifyResultsPerPage}
                    onChange={(e) => setApifyResultsPerPage(e.target.value)}
                    data-testid="apify-results-per-page"
                  />
                  <p className="text-xs text-muted-foreground">
                    Caps the dataset size the actor returns. Defaults to 20; max 100.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting} data-testid="connect-save">
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdvancedToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!open)}
      className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-primary transition-colors"
      data-testid="advanced-toggle"
    >
      {open ? (
        <ChevronDown className="h-3.5 w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5" />
      )}
      <Settings2 className="h-3.5 w-3.5" />
      Advanced settings
    </button>
  );
}

/**
 * Renders one row per applicable workflow step, letting recruiters toggle
 * whether THIS provider runs that step. Setting `enabled:false` mirrors the
 * legacy admin's behavior of falling back to the native default without
 * deleting the row (no DELETE route exists for step settings).
 */
function StepAssignmentInline({
  entry,
  provider,
}: {
  entry: ConnectProvider;
  provider: ProviderRecord;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings = [] } = useListProviderStepSettings();
  const upsert = useUpsertProviderStepSetting();
  const [pendingStep, setPendingStep] = useState<WorkflowStep | null>(null);

  const steps = APPLICABLE_STEPS[entry.connectType];
  if (steps.length === 0) return null;

  type SettingRow = {
    workflowStep: WorkflowStep;
    providerId: number;
    enabled: boolean;
    provider?: { id: number; name: string };
  };
  const settingsList = settings as SettingRow[];

  async function handleToggle(step: WorkflowStep, next: boolean) {
    setPendingStep(step);
    try {
      await upsert.mutateAsync({
        data: {
          workflowStep: step,
          providerId: provider.id,
          enabled: next,
        },
      });
      await qc.invalidateQueries({ queryKey: getListProviderStepSettingsQueryKey() });
      toast({
        title: next
          ? `${entry.name} now runs ${WORKFLOW_STEP_LABELS[step]}`
          : `${entry.name} no longer runs ${WORKFLOW_STEP_LABELS[step]}`,
      });
    } catch {
      toast({ title: "Failed to update step assignment", variant: "destructive" });
    } finally {
      setPendingStep(null);
    }
  }

  return (
    <div
      className="rounded-md border border-border bg-muted/20 p-3 space-y-2"
      data-testid={`step-assignment-${entry.id}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Workflow steps
      </p>
      {steps.map((step) => {
        const current = settingsList.find((s) => s.workflowStep === step);
        const assignedToThis = current?.providerId === provider.id && current.enabled;
        const assignedElsewhere =
          current && current.enabled && current.providerId !== provider.id;
        return (
          <label
            key={step}
            className="flex items-center justify-between gap-2 text-xs"
            data-testid={`step-row-${entry.id}-${step}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <input
                type="checkbox"
                checked={assignedToThis}
                disabled={pendingStep === step}
                onChange={(e) => handleToggle(step, e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
                data-testid={`step-checkbox-${entry.id}-${step}`}
              />
              <span className="font-medium text-foreground">
                {WORKFLOW_STEP_LABELS[step]}
              </span>
              {assignedElsewhere && (
                <span className="text-muted-foreground truncate">
                  (currently: {current?.provider?.name ?? "another provider"})
                </span>
              )}
            </div>
            {pendingStep === step && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
            )}
          </label>
        );
      })}
    </div>
  );
}

function ProviderCard({
  entry,
  providers,
  onConnect,
  onComingSoon,
}: {
  entry: CatalogEntry;
  providers: ProviderRecord[];
  onConnect: (e: ConnectProvider) => void;
  onComingSoon: (e: StubProvider) => void;
}) {
  const cat = CATEGORIES.find((c) => c.key === entry.category)!;
  const state: ConnState =
    entry.kind === "connect" ? deriveState(entry, providers) : "disconnected";
  const dbProvider =
    entry.kind === "connect" ? findProviderForEntry(entry, providers) : null;
  return (
    <Card
      className="p-5 flex flex-col gap-4 border-l-4 hover:border-primary/40 transition-colors h-full"
      style={{ borderLeftColor: cat.accent }}
      data-testid={`marketplace-card-${entry.id}`}
    >
      <div className="flex items-start gap-3">
        <LogoMark accent={cat.accent} mark={entry.logoMark} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground">{entry.name}</h3>
            <StatusPill state={state} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">{entry.oneLiner}</p>
        </div>
      </div>

      <BadgeRow badges={entry.badges} />

      <div className="text-xs text-muted-foreground border-t border-border pt-3">
        {entry.pricing}
      </div>

      {entry.kind === "connect" && entry.helper && (
        <p className="text-xs text-amber-600 -mt-2">{entry.helper}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] uppercase font-semibold tracking-wide"
          style={{ color: cat.accent }}
        >
          {cat.label}
        </span>
        {entry.kind === "stub" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onComingSoon(entry)}
            data-testid={`connect-${entry.id}`}
          >
            Connect
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => onConnect(entry)}
            data-testid={`connect-${entry.id}`}
          >
            {state === "connected" ? "Manage" : "Connect"}
          </Button>
        )}
      </div>

      {entry.kind === "connect" &&
        dbProvider &&
        APPLICABLE_STEPS[entry.connectType].length > 0 && (
          <div className="mt-auto">
            <StepAssignmentInline entry={entry} provider={dbProvider} />
          </div>
        )}
    </Card>
  );
}

export default function MarketplacePage() {
  const { data: providers = [] } = useListProviders();
  // Subscribe so connection state stays fresh; result not directly read here.
  useListProviderStepSettings();
  const [activeCategory, setActiveCategory] = useState<ProviderCategory | "all">("all");
  const [stubOpen, setStubOpen] = useState<StubProvider | null>(null);
  const [connectOpen, setConnectOpen] = useState<ConnectProvider | null>(null);

  // Fire `providers_marketplace_opened` once per visit to the marketplace
  // screen (one event per mount, not per re-render or category switch).
  useEffect(() => {
    trackTelemetry("providers_marketplace_opened");
  }, []);

  const providersTyped = providers as ProviderRecord[];
  const visible =
    activeCategory === "all"
      ? CATALOG
      : CATALOG.filter((c) => c.category === activeCategory);
  const activeMeta =
    activeCategory === "all" ? null : CATEGORIES.find((c) => c.key === activeCategory)!;

  return (
    <>
      <SettingsTabs />
      <div className="p-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Provider Marketplace</h1>
          <p className="text-muted-foreground mt-1">
            Discover and connect agents that power each step of your hiring workflow. A-Player
            providers are arriving in upcoming phases — free providers connect today.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-6 border-b border-border pb-3">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${
              activeCategory === "all"
                ? "bg-foreground/10 text-foreground border-foreground/30"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
            data-testid="category-tab-all"
          >
            All
            <span className="ml-1.5 text-[10px] opacity-70">({CATALOG.length})</span>
          </button>
          {CATEGORIES.map((cat) => {
            const active = cat.key === activeCategory;
            const count = CATALOG.filter((e) => e.category === cat.key).length;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveCategory(cat.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${
                  active
                    ? "text-foreground border-transparent"
                    : "text-muted-foreground border-transparent hover:text-foreground"
                }`}
                style={
                  active
                    ? { backgroundColor: `${cat.accent}22`, borderColor: cat.accent }
                    : undefined
                }
                data-testid={`category-tab-${cat.key}`}
              >
                {cat.label}
                <span className="ml-1.5 text-[10px] opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        {activeMeta && (
          <p className="text-sm text-muted-foreground mb-4">{activeMeta.description}</p>
        )}
        {!activeMeta && (
          <p className="text-sm text-muted-foreground mb-4">
            Every provider, across every category. Filter by category to focus.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((entry) => (
            <ProviderCard
              key={entry.id}
              entry={entry}
              providers={providersTyped}
              onConnect={setConnectOpen}
              onComingSoon={setStubOpen}
            />
          ))}
          {visible.length === 0 && (
            <div className="col-span-full rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nothing in this category yet — more providers ship in the next phase.
            </div>
          )}
        </div>

        <ComingSoonDialog
          entry={stubOpen}
          open={!!stubOpen}
          onOpenChange={(v) => !v && setStubOpen(null)}
          accent={stubOpen ? CATEGORIES.find((c) => c.key === stubOpen.category)!.accent : "#000"}
        />
        <ConnectDialog
          entry={connectOpen}
          open={!!connectOpen}
          onOpenChange={(v) => !v && setConnectOpen(null)}
          providers={providersTyped}
          accent={
            connectOpen ? CATEGORIES.find((c) => c.key === connectOpen.category)!.accent : "#000"
          }
        />
      </div>
    </>
  );
}
