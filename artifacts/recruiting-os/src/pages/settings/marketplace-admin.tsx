import { useEffect, useState } from "react";
import { branding } from "@workspace/branding";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useToggleProvider,
  useTestProviderConnection,
  useListProviderStepSettings,
  useUpsertProviderStepSetting,
  useIssueScoutConnectState,
  useDisconnectScout,
  useIssueEnrichConnectState,
  useDisconnectEnrich,
  getListProvidersQueryKey,
  getListProviderStepSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Pencil,
  Trash2,
  Wifi,
  WifiOff,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  Cpu,
  Webhook,
  Zap,
  Github,
  Globe,
  Scale,
  Sparkles,
  ExternalLink,
  Bot,
} from "lucide-react";
import { track as trackTelemetry } from "@/lib/telemetry";
import { GithubQueryPreview } from "./github-query-preview";

// ── types ────────────────────────────────────────────────────────────────────

type ProviderType = "native_openai" | "custom_webhook" | "twin_webhook" | "github" | "web_search" | "apify" | "council";
type WorkflowStep =
  | "job_understanding"
  | "candidate_matching"
  | "shortlist_generation"
  | "sourcing_later"
  | "sourcing"
  | "enrichment"
  | "decision";

/** Provider types eligible for the optional `decision` workflow step. */
const DECISION_PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set(["council"]);

interface Provider {
  id: number;
  name: string;
  type: ProviderType;
  baseUrl?: string | null;
  webhookUrl?: string | null;
  /**
   * Last 4 chars of the saved API key, or null when no key is stored. The
   * full key is never returned to the browser — see `serializeRowForApi` in
   * `artifacts/api-server/src/routes/providers.ts`.
   */
  apiKeyLast4?: string | null;
  config?: {
    github?: GithubProviderConfig | null;
    web_search?: WebSearchProviderConfig | null;
    apify?: ApifyProviderConfig | null;
    council?: CouncilProviderConfig | null;
  } | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const WORKFLOW_STEPS: { key: WorkflowStep; label: string; description: string; comingSoon?: boolean }[] = [
  { key: "job_understanding", label: "Job Understanding", description: "Reads the job posting and pulls out what really matters" },
  { key: "candidate_matching", label: "Candidate Matching", description: `Scores every candidate against the role across the ${branding.productName} 3-dimension rubric (autonomy, product mindset, impact)` },
  { key: "shortlist_generation", label: "Shortlist", description: "Ranks the strongest candidates and writes a hiring summary you can share" },
  { key: "sourcing", label: "Sourcing", description: "Brings new candidates into the pipeline before screening. Twin uses POST /workflow/sourcing" },
  { key: "enrichment", label: "Enrichment", description: "Fills in missing details on each candidate (skills, headline, summary) before scoring. Twin uses POST /workflow/enrichment" },
  { key: "decision", label: "Decision (Council)", description: "Optional final-mile multi-pole deliberation on shortlisted candidates. Only Council providers can be assigned here." },
  { key: "sourcing_later", label: "Sourcing (future)", description: "Proactive outreach and external sourcing (coming soon)", comingSoon: true },
];

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  native_openai: "Native OpenAI",
  custom_webhook: "Custom Webhook",
  twin_webhook: "Twin Webhook",
  github: "GitHub Agent",
  web_search: "Web Search",
  apify: "Apify Scrapers",
  council: "Council",
};

const PROVIDER_TYPE_ICONS: Record<ProviderType, React.ComponentType<{ className?: string }>> = {
  native_openai: Cpu,
  custom_webhook: Webhook,
  twin_webhook: Zap,
  github: Github,
  web_search: Globe,
  apify: Bot,
  council: Scale,
};

/**
 * Apify ships a default actor when no override is configured. Mirrors
 * `DEFAULT_ACTOR_ID` in `artifacts/api-server/src/routes/workflows/providers/apify.ts`
 * so the Step Assignments row reflects what the engine will actually run.
 */
const APIFY_DEFAULT_ACTOR_ID = "apify/google-search-scraper";

function apifyActorLabel(provider: Provider): string {
  const id = provider.config?.apify?.actorId?.trim();
  return id && id.length > 0 ? id : `${APIFY_DEFAULT_ACTOR_ID} (default)`;
}

// ── form schema ──────────────────────────────────────────────────────────────

const providerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["native_openai", "custom_webhook", "twin_webhook", "github", "web_search", "council"]),
  baseUrl: z.string().optional(),
  webhookUrl: z.string().optional(),
  apiKeyPlaceholder: z.string().optional(),
  enabled: z.boolean().default(true),
  githubExtraKeywords: z.string().optional(),
  githubExcludeOrgs: z.string().optional(),
  githubMinFollowers: z.string().optional(),
  githubMinRepos: z.string().optional(),
  githubRequireBio: z.boolean().default(false),
  githubActiveWithinMonths: z.string().optional(),
  // Web Search (SerpAPI) tuning. Sites are entered as comma-separated strings
  // and split into arrays at submit time so the UI stays simple.
  webSearchExtraKeywords: z.string().optional(),
  webSearchTargetSites: z.string().optional(),
  webSearchExcludeSites: z.string().optional(),
});
type ProviderFormValues = z.infer<typeof providerSchema>;

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

interface CouncilProviderConfig {
  baseUrl?: string | null;
}

interface ApifyProviderConfig {
  actorId?: string | null;
  extraKeywords?: string | null;
  targetSites?: string[] | null;
  excludeSites?: string[] | null;
  resultsPerPage?: number | null;
}

/** Split a comma/space/newline-separated free-text field into a clean array. */
function splitSites(input?: string): string[] | null {
  if (!input) return null;
  const parts = input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : null;
}

// ── test connection badge ────────────────────────────────────────────────────

function TestResult({ ok, error, latencyMs }: { ok: boolean; error?: string | null; latencyMs?: number | null }) {
  if (ok) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
        <CheckCircle className="h-4 w-4" />
        Connected {latencyMs != null ? `(${latencyMs}ms)` : ""}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-sm text-destructive font-medium" title={error ?? undefined}>
      <XCircle className="h-4 w-4" />
      Failed{error ? `: ${error.slice(0, 60)}` : ""}
    </span>
  );
}

// ── provider card ────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  onEdit,
  onDelete,
}: {
  provider: Provider;
  onEdit: (p: Provider) => void;
  onDelete: (p: Provider) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string | null; latencyMs?: number | null } | null>(null);
  const [testing, setTesting] = useState(false);

  const toggle = useToggleProvider();
  const testConn = useTestProviderConnection();

  const Icon = PROVIDER_TYPE_ICONS[provider.type];

  // Fire `provider_card_viewed` once per mount per provider.
  useEffect(() => {
    trackTelemetry("provider_card_viewed", { provider: provider.name });
  }, [provider.name]);

  async function handleToggle(enabled: boolean) {
    await toggle.mutateAsync({ id: provider.id, data: { enabled } });
    qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    trackTelemetry("provider_connect_clicked", { provider: provider.name });
    try {
      const result = await testConn.mutateAsync({ id: provider.id });
      setTestResult(result as { ok: boolean; error?: string | null; latencyMs?: number | null });
      if ((result as { ok: boolean }).ok) {
        trackTelemetry("provider_connected", { provider: provider.name });
        toast({ title: "Connection successful", description: `${provider.name} responded in ${(result as { latencyMs?: number }).latencyMs}ms` });
      } else {
        toast({ title: "Connection failed", description: (result as { error?: string }).error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      setTestResult({ ok: false, error: "Request failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className={`border border-border rounded-lg p-5 bg-card transition-opacity ${provider.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-4.5 w-4.5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground truncate">{provider.name}</span>
              <Badge variant="secondary" className="text-xs shrink-0">
                {PROVIDER_TYPE_LABELS[provider.type]}
              </Badge>
              {!provider.enabled && (
                <Badge variant="outline" className="text-xs text-muted-foreground shrink-0">Disabled</Badge>
              )}
            </div>
            {provider.webhookUrl && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{provider.webhookUrl}</p>
            )}
            {provider.baseUrl && !provider.webhookUrl && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{provider.baseUrl}</p>
            )}
            {provider.type === "native_openai" && (
              <p className="text-xs text-muted-foreground mt-0.5">Powered by Replit AI Integrations</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={provider.enabled}
            onCheckedChange={handleToggle}
            disabled={toggle.isPending}
            aria-label="Toggle provider"
          />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(provider)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => onDelete(provider)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing}
          className="gap-1.5"
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : testResult?.ok ? (
            <Wifi className="h-3.5 w-3.5 text-green-600" />
          ) : testResult ? (
            <WifiOff className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <Wifi className="h-3.5 w-3.5" />
          )}
          Test Connection
        </Button>
        {testResult && <TestResult {...testResult} />}
      </div>
    </div>
  );
}

// ── step assignment row ───────────────────────────────────────────────────────

function StepAssignmentRow({
  step,
  providers,
  currentSetting,
}: {
  step: { key: WorkflowStep; label: string; description: string; comingSoon?: boolean };
  providers: Provider[];
  currentSetting?: { providerId: number; enabled: boolean; provider?: Provider };
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const upsert = useUpsertProviderStepSetting();
  const [saving, setSaving] = useState(false);

  const currentProviderId = currentSetting?.providerId;
  const currentProvider =
    currentProviderId != null
      ? providers.find((p) => p.id === currentProviderId) ?? null
      : null;
  // For the decision step, only council-typed providers are valid. For every
  // other step, council providers are excluded so they can't be misassigned.
  const enabledProviders = providers.filter((p) => {
    if (!p.enabled) return false;
    if (step.key === "decision") return DECISION_PROVIDER_TYPES.has(p.type);
    return !DECISION_PROVIDER_TYPES.has(p.type);
  });

  async function handleChange(providerId: string) {
    setSaving(true);
    try {
      await upsert.mutateAsync({
        data: {
          workflowStep: step.key,
          providerId: parseInt(providerId, 10),
          enabled: true,
        },
      });
      qc.invalidateQueries({ queryKey: getListProviderStepSettingsQueryKey() });
      toast({ title: "Step assignment updated", description: `${step.label} will now use the selected provider` });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-4 py-4 border-b border-border last:border-0">
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-foreground">{step.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
      </div>
      <div className="w-56 shrink-0">
        {step.comingSoon ? (
          <p className="text-xs text-muted-foreground italic">Coming soon</p>
        ) : enabledProviders.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            {step.key === "decision" ? "No Council providers configured" : "No enabled providers"}
          </p>
        ) : (
          <Select
            value={currentProviderId?.toString() ?? ""}
            onValueChange={handleChange}
            disabled={saving}
          >
            <SelectTrigger className="w-full text-sm">
              <SelectValue placeholder="Native OpenAI (default)" />
            </SelectTrigger>
            <SelectContent>
              {enabledProviders.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()}>
                  <span className="flex items-center gap-2">
                    {PROVIDER_TYPE_LABELS[p.type]} — {p.name}
                    {p.type === "apify" && (
                      <span className="text-xs text-muted-foreground">
                        · {apifyActorLabel(p)}
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {currentProvider?.type === "apify" && currentSetting?.enabled && (
          <p
            className="text-[11px] text-muted-foreground mt-1 truncate"
            data-testid={`step-assignment-apify-actor-${step.key}`}
            title={apifyActorLabel(currentProvider)}
          >
            Actor: <code className="text-[11px]">{apifyActorLabel(currentProvider)}</code>
          </p>
        )}
      </div>
      {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
    </div>
  );
}


// ── provider form dialog ──────────────────────────────────────────────────────

function ProviderDialog({
  open,
  onOpenChange,
  editProvider,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editProvider: Provider | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateProvider();
  const update = useUpdateProvider();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProviderFormValues>({
    resolver: zodResolver(providerSchema),
    defaultValues: editProvider
      ? {
          name: editProvider.name,
          type: editProvider.type,
          baseUrl: editProvider.baseUrl ?? "",
          webhookUrl: editProvider.webhookUrl ?? "",
          // Never prefill the live API key — it isn't returned by the API.
          // The dialog shows a "•••• last4" hint instead and only sends a
          // value when the recruiter actually types a replacement.
          apiKeyPlaceholder: "",
          enabled: editProvider.enabled,
          githubExtraKeywords: editProvider.config?.github?.extraKeywords ?? "",
          githubExcludeOrgs: editProvider.config?.github?.excludeOrgs ?? "",
          githubMinFollowers:
            editProvider.config?.github?.minFollowers != null
              ? String(editProvider.config.github.minFollowers)
              : "",
          githubMinRepos:
            editProvider.config?.github?.minRepos != null
              ? String(editProvider.config.github.minRepos)
              : "",
          githubRequireBio: editProvider.config?.github?.requireBio === true,
          githubActiveWithinMonths:
            editProvider.config?.github?.activeWithinMonths != null
              ? String(editProvider.config.github.activeWithinMonths)
              : "",
          webSearchExtraKeywords: editProvider.config?.web_search?.extraKeywords ?? "",
          webSearchTargetSites:
            editProvider.config?.web_search?.targetSites?.join(", ") ?? "",
          webSearchExcludeSites:
            editProvider.config?.web_search?.excludeSites?.join(", ") ?? "",
        }
      : { name: "", type: "native_openai", enabled: true, githubRequireBio: false },
  });

  const providerType = watch("type");

  async function onSubmit(values: ProviderFormValues) {
    let config: { github?: GithubProviderConfig; web_search?: WebSearchProviderConfig; council?: CouncilProviderConfig } | null = null;
    if (values.type === "council") {
      const baseUrl = values.baseUrl?.trim();
      if (baseUrl) config = { council: { baseUrl } };
    }
    if (values.type === "github") {
      const parseInt0 = (v?: string) => {
        const n = parseInt((v ?? "").trim(), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const gh: GithubProviderConfig = {
        extraKeywords: values.githubExtraKeywords?.trim() || null,
        excludeOrgs: values.githubExcludeOrgs?.trim() || null,
        minFollowers: parseInt0(values.githubMinFollowers),
        minRepos: parseInt0(values.githubMinRepos),
        requireBio: values.githubRequireBio ? true : null,
        activeWithinMonths: parseInt0(values.githubActiveWithinMonths),
      };
      const hasAny =
        gh.extraKeywords ||
        gh.excludeOrgs ||
        gh.minFollowers != null ||
        gh.minRepos != null ||
        gh.requireBio === true ||
        gh.activeWithinMonths != null;
      if (hasAny) config = { github: gh };
    } else if (values.type === "web_search") {
      const ws: WebSearchProviderConfig = {
        extraKeywords: values.webSearchExtraKeywords?.trim() || null,
        targetSites: splitSites(values.webSearchTargetSites),
        excludeSites: splitSites(values.webSearchExcludeSites),
      };
      const hasAny = ws.extraKeywords || (ws.targetSites && ws.targetSites.length > 0) || (ws.excludeSites && ws.excludeSites.length > 0);
      if (hasAny) config = { web_search: ws };
    }

    const payload = {
      name: values.name,
      type: values.type,
      baseUrl: values.baseUrl || null,
      webhookUrl: values.webhookUrl || null,
      apiKeyPlaceholder: values.apiKeyPlaceholder || null,
      config,
      enabled: values.enabled,
    };

    try {
      if (editProvider) {
        await update.mutateAsync({ id: editProvider.id, data: payload });
        toast({ title: "Provider updated" });
      } else {
        await create.mutateAsync({ data: payload });
        toast({ title: "Provider created" });
      }
      qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      onOpenChange(false);
      reset();
    } catch {
      toast({ title: "Failed to save provider", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editProvider ? "Edit Provider" : "Add Provider"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input {...register("name")} placeholder="e.g. My Custom AI" />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Provider Type</Label>
            <Select
              value={providerType}
              onValueChange={(v) => setValue("type", v as ProviderType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="native_openai">
                  <span className="flex flex-col">
                    <span className="font-medium">Native OpenAI</span>
                    <span className="text-xs text-muted-foreground">Uses Replit AI Integrations — no config needed</span>
                  </span>
                </SelectItem>
                <SelectItem value="custom_webhook">
                  <span className="flex flex-col">
                    <span className="font-medium">Custom Webhook</span>
                    <span className="text-xs text-muted-foreground">POST step payloads to your own endpoint</span>
                  </span>
                </SelectItem>
                <SelectItem value="twin_webhook">
                  <span className="flex flex-col">
                    <span className="font-medium">Twin Webhook</span>
                    <span className="text-xs text-muted-foreground">Connect to a Twin agent via base URL</span>
                  </span>
                </SelectItem>
                <SelectItem value="github">
                  <span className="flex flex-col">
                    <span className="font-medium">GitHub Agent</span>
                    <span className="text-xs text-muted-foreground">Source real public GitHub users via the GitHub REST API</span>
                  </span>
                </SelectItem>
                <SelectItem value="web_search">
                  <span className="flex flex-col">
                    <span className="font-medium">Web Search (SerpAPI)</span>
                    <span className="text-xs text-muted-foreground">Source real LinkedIn / GitHub / personal-site profiles via Google (SerpAPI)</span>
                  </span>
                </SelectItem>
                <SelectItem value="council">
                  <span className="flex flex-col">
                    <span className="font-medium">Council (Decision)</span>
                    <span className="text-xs text-muted-foreground">15-pole multi-agent deliberation. Only valid for the Decision step.</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            {providerType === "council" && (
              <p className="text-xs text-muted-foreground">
                Council providers can only be assigned to the <strong>Decision</strong> step.
              </p>
            )}
          </div>

          {providerType === "council" && (
            <>
              <div className="rounded-md bg-muted/50 border border-border p-3 text-sm text-muted-foreground">
                Council deliberates with 15 named poles and returns a structured verdict (convergence, divergence, orientations). Pricing is enforced by Council itself — quota-exceeded responses are surfaced as an upgrade CTA in the Council tab on the candidate page.
              </div>
              <div className="space-y-1.5">
                <Label>API Key</Label>
                <Input
                  {...register("apiKeyPlaceholder")}
                  type="password"
                  placeholder={
                    editProvider?.apiKeyLast4
                      ? `•••• ${editProvider.apiKeyLast4} — leave blank to keep`
                      : "sk-council-..."
                  }
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">
                  {editProvider?.apiKeyLast4
                    ? "A key is already saved. Leave blank to keep it, or type a new value to replace it."
                    : "Paste from Council → Settings → API Keys."}{" "}
                  Sent as <code className="text-xs">Authorization: Bearer …</code>; never exposed to the frontend.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Base URL (optional)</Label>
                <Input
                  {...register("baseUrl")}
                  placeholder="https://council.replit.app"
                />
                <p className="text-xs text-muted-foreground">
                  Override only if you self-host Council. Leave blank to use the hosted prod deployment.
                </p>
              </div>
            </>
          )}

          {providerType === "custom_webhook" && (
            <div className="space-y-1.5">
              <Label>Webhook URL</Label>
              <Input {...register("webhookUrl")} placeholder="https://your-api.com/workflow" />
              <p className="text-xs text-muted-foreground">Receives POST requests with the step payload and expected output schema</p>
            </div>
          )}

          {providerType === "twin_webhook" && (
            <div className="space-y-1.5">
              <Label>Base URL</Label>
              <Input {...register("baseUrl")} placeholder="https://your-twin-agent.com" />
              <p className="text-xs text-muted-foreground">The Twin agent base URL — steps are sent to <code className="text-xs">/workflow/step</code></p>
            </div>
          )}

          {(providerType === "custom_webhook" || providerType === "twin_webhook") && (
            <div className="space-y-1.5">
              <Label>API Key (optional)</Label>
              <Input
                {...register("apiKeyPlaceholder")}
                type="password"
                placeholder={
                  editProvider?.apiKeyLast4
                    ? `•••• ${editProvider.apiKeyLast4} — leave blank to keep`
                    : "sk-..."
                }
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                {editProvider?.apiKeyLast4
                  ? "A key is already saved. Leave blank to keep it, or type a new value to replace it. "
                  : ""}
                Sent as <code className="text-xs">Authorization: Bearer …</code> — stored encrypted, never exposed to the frontend.
              </p>
            </div>
          )}

          {providerType === "native_openai" && (
            <div className="rounded-md bg-muted/50 border border-border p-3 text-sm text-muted-foreground">
              No configuration needed. This provider uses your Replit AI Integrations OpenAI connection automatically.
            </div>
          )}

          {providerType === "github" && (
            <>
              <div className="rounded-md bg-muted/50 border border-border p-3 text-sm text-muted-foreground">
                Sources candidates from the public GitHub REST API. Set the <code className="text-xs">GITHUB_TOKEN</code> secret to raise rate limits — the agent works without it but is limited to ~60 requests/hour.
              </div>

              <div className="space-y-3 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Search tuning</p>
                  <p className="text-xs text-muted-foreground">
                    Optional knobs added to the GitHub user-search query for every run. Leave blank to use the defaults derived from the job.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Extra keywords</Label>
                  <Input
                    {...register("githubExtraKeywords")}
                    placeholder="e.g. open source fintech"
                  />
                  <p className="text-xs text-muted-foreground">
                    Appended to the free-text portion of the query (matches bios &amp; profile text).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Exclude orgs / users</Label>
                  <Input
                    {...register("githubExcludeOrgs")}
                    placeholder="e.g. google, microsoft, meta"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma- or space-separated GitHub logins. Each becomes a <code className="text-xs">-user:&lt;name&gt;</code> filter.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Min followers</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      placeholder="e.g. 50"
                      {...register("githubMinFollowers")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Min public repos</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      placeholder="e.g. 5"
                      {...register("githubMinRepos")}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-border space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Quality filters</p>
                    <p className="text-xs text-muted-foreground">
                      Applied after fetching results from GitHub — drops candidates that look abandoned or anonymous.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label htmlFor="github-require-bio">Require non-empty bio</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Drop candidates whose GitHub profile bio is empty.
                      </p>
                    </div>
                    <Switch
                      id="github-require-bio"
                      checked={watch("githubRequireBio") === true}
                      onCheckedChange={(v) => setValue("githubRequireBio", v)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Active within (months)</Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      placeholder="e.g. 6"
                      {...register("githubActiveWithinMonths")}
                    />
                    <p className="text-xs text-muted-foreground">
                      Drop candidates whose latest public GitHub event is older than this. Leave blank to skip.
                    </p>
                  </div>
                </div>
              </div>

              <GithubQueryPreview
                editProviderId={editProvider?.id ?? null}
                config={{
                  extraKeywords: watch("githubExtraKeywords")?.trim() || null,
                  excludeOrgs: watch("githubExcludeOrgs")?.trim() || null,
                  minFollowers: (() => {
                    const n = parseInt((watch("githubMinFollowers") ?? "").trim(), 10);
                    return Number.isFinite(n) && n > 0 ? n : null;
                  })(),
                  minRepos: (() => {
                    const n = parseInt((watch("githubMinRepos") ?? "").trim(), 10);
                    return Number.isFinite(n) && n > 0 ? n : null;
                  })(),
                }}
              />
            </>
          )}

          {providerType === "web_search" && (
            <>
              <div className="rounded-md bg-muted/50 border border-border p-3 text-sm text-muted-foreground">
                Sources real candidates by searching Google via SerpAPI. Requires the{" "}
                <code className="text-xs">SERPAPI_KEY</code> secret. Profile URLs and headlines come straight from
                Google&apos;s organic results — no fabricated emails, locations, or companies.
              </div>

              <div className="space-y-3 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Search tuning</p>
                  <p className="text-xs text-muted-foreground">
                    Optional knobs added to the Google query. Leave blank to use sensible defaults derived from the job.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Extra keywords</Label>
                  <Input
                    {...register("webSearchExtraKeywords")}
                    placeholder="e.g. remote fintech open-source"
                  />
                  <p className="text-xs text-muted-foreground">
                    Free-text terms appended verbatim to every query.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Target sites</Label>
                  <Input
                    {...register("webSearchTargetSites")}
                    placeholder="e.g. linkedin.com/in, github.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated. Joined as <code className="text-xs">(site:a OR site:b ...)</code>. Defaults to{" "}
                    <code className="text-xs">linkedin.com/in</code> and <code className="text-xs">github.com</code> when empty.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Exclude sites</Label>
                  <Input
                    {...register("webSearchExcludeSites")}
                    placeholder="e.g. pinterest.com, slideshare.net"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated domains to drop from results via <code className="text-xs">-site:</code>.
                  </p>
                </div>
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-1">
            <Label htmlFor="enabled-toggle">Enabled</Label>
            <Switch
              id="enabled-toggle"
              checked={watch("enabled")}
              onCheckedChange={(v) => setValue("enabled", v)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); reset(); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editProvider ? "Save Changes" : "Create Provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── marketplace: A-Player Scout card ─────────────────────────────────────────
//
// Replaces the manual "paste base URL + API key" Twin Webhook setup with an
// OAuth-flavored redirect: the recruiter clicks Connect Scout, we mint a
// single-use CSRF state server-side, open Scout's /connect page in a new tab,
// and listen for a BroadcastChannel ping from the callback page when Scout
// redirects back. The callback handler does the token-for-credentials swap
// and creates the provider row — no key ever touches the browser.
//
// Connection status is derived from the same provider list the rest of the
// page already loads, so this card stays in sync with manual edits made in
// the Configured Providers section.

const SCOUT_PROVIDER_NAME = "A-Player Scout";

/**
 * Workflow steps each first-party marketplace integration is currently capable
 * of powering. Surfaced on the marketplace card so recruiters can see what
 * will be wired up before clicking Connect, and used to drive the auto-assign
 * opt-out toggle. Server-side mirror lives at
 * `artifacts/api-server/src/routes/integrations-scout.ts:SCOUT_POWERED_STEPS`.
 */
const SCOUT_POWERED_STEPS: WorkflowStep[] = ["sourcing"];

function stepLabel(step: WorkflowStep): string {
  return WORKFLOW_STEPS.find((s) => s.key === step)?.label ?? step;
}

export function ScoutMarketplaceCard({ providers }: { providers: Provider[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [autoAssign, setAutoAssign] = useState(true);
  const issueState = useIssueScoutConnectState();
  const disconnect = useDisconnectScout();
  const testConn = useTestProviderConnection();
  const [livePing, setLivePing] = useState<{ ok: boolean | null; checking: boolean }>(
    { ok: null, checking: false },
  );

  const scoutProvider = providers.find(
    (p) => p.name === SCOUT_PROVIDER_NAME && p.type === "twin_webhook",
  );
  const connected = !!scoutProvider && scoutProvider.enabled;

  // Quietly ping the existing provider once on mount (and whenever the row
  // changes) so the card can show a green "Live" / red "Offline" pip without
  // the recruiter having to click anything.
  useEffect(() => {
    if (!scoutProvider) {
      setLivePing({ ok: null, checking: false });
      return;
    }
    let cancelled = false;
    setLivePing({ ok: null, checking: true });
    testConn
      .mutateAsync({ id: scoutProvider.id })
      .then((res) => {
        if (cancelled) return;
        setLivePing({ ok: (res as { ok: boolean }).ok, checking: false });
      })
      .catch(() => {
        if (cancelled) return;
        setLivePing({ ok: false, checking: false });
      });
    return () => {
      cancelled = true;
    };
    // testConn is a stable mutation hook; only re-run when the provider id flips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoutProvider?.id]);

  // The callback HTML page broadcasts on three channels (BroadcastChannel,
  // localStorage, postMessage) for cross-browser safety. We listen on all
  // three and dedupe by simply re-fetching the providers list on any signal.
  useEffect(() => {
    if (!waiting) return;
    function onSuccess(payload: {
      ok: boolean;
      error?: string | null;
      assignedSteps?: string[];
    }) {
      setWaiting(false);
      qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      qc.invalidateQueries({ queryKey: getListProviderStepSettingsQueryKey() });
      if (payload.ok) {
        const steps = (payload.assignedSteps ?? []).filter(
          (s): s is WorkflowStep => SCOUT_POWERED_STEPS.includes(s as WorkflowStep),
        );
        const description =
          steps.length > 0
            ? `Wired up: ${steps.map(stepLabel).join(", ")}.`
            : "No workflow steps were auto-assigned. Wire Scout up from Workflow Step Assignments below.";
        toast({
          title: "Connected to A-Player Scout",
          description,
        });
      } else {
        toast({
          title: "Scout connection failed",
          description: payload.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    }
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("daneel:scout-connect");
      bc.onmessage = (ev) => onSuccess(ev.data);
    } catch {
      bc = null;
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== "daneel.scoutConnect" || !e.newValue) return;
      try {
        onSuccess(JSON.parse(e.newValue));
      } catch {
        /* ignore */
      }
    }
    function onMessage(e: MessageEvent) {
      const data = e.data as
        | {
            source?: string;
            ok?: boolean;
            error?: string | null;
            assignedSteps?: string[];
          }
        | undefined;
      if (!data || data.source !== "daneel-scout-connect") return;
      onSuccess({
        ok: !!data.ok,
        error: data.error ?? null,
        assignedSteps: data.assignedSteps ?? [],
      });
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("message", onMessage);
    return () => {
      bc?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onMessage);
    };
  }, [waiting, qc, toast]);

  async function handleConnect() {
    try {
      const res = (await issueState.mutateAsync({
        data: { autoAssignSteps: autoAssign },
      })) as {
        connectUrl: string;
        state: string;
      };
      setWaiting(true);
      const popup = window.open(res.connectUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        // Pop-up blocked — fall back to same-tab navigation. The callback page
        // still pings via localStorage so other open tabs of the app refresh.
        window.location.href = res.connectUrl;
      }
    } catch (err) {
      setWaiting(false);
      toast({
        title: "Could not start Scout connection",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleDisconnect() {
    if (!scoutProvider) return;
    try {
      // Use the dedicated endpoint — it unlinks workflow step assignments
      // first so the FK-restricted provider row can be deleted cleanly.
      await disconnect.mutateAsync();
      qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      qc.invalidateQueries({ queryKey: getListProviderStepSettingsQueryKey() });
      toast({ title: "Disconnected from A-Player Scout" });
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    } finally {
      setDeleteOpen(false);
    }
  }

  return (
    <>
      <div className="border border-border rounded-lg p-5 bg-card flex items-start gap-4">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">A-Player Scout</span>
            {connected ? (
              <Badge variant="outline" className="text-xs gap-1 border-green-500/40 text-green-700">
                <CheckCircle className="h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Not connected
              </Badge>
            )}
            {connected && livePing.ok === true && (
              <span className="text-xs text-green-700 flex items-center gap-1">
                <Wifi className="h-3 w-3" /> Live
              </span>
            )}
            {connected && livePing.ok === false && !livePing.checking && (
              <span className="text-xs text-destructive flex items-center gap-1">
                <WifiOff className="h-3 w-3" /> Offline
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            JD-driven candidate sourcing. Connect once and Scout becomes your
            sourcing step — no API key paste required.
          </p>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {connected ? "Powers" : "Will power"}:
            </span>
            {SCOUT_POWERED_STEPS.map((step) => (
              <Badge key={step} variant="secondary" className="text-xs">
                {stepLabel(step)}
              </Badge>
            ))}
          </div>
          {!connected && (
            <label className="mt-3 flex items-start gap-2 text-xs cursor-pointer select-none">
              <Switch
                checked={autoAssign}
                onCheckedChange={setAutoAssign}
                disabled={issueState.isPending || waiting}
                aria-label="Auto-assign workflow steps when connecting"
              />
              <span className="text-muted-foreground leading-tight">
                Auto-assign these workflow steps on connect.{" "}
                <span className="text-foreground/70">
                  Steps already wired to another provider stay untouched.
                </span>
              </span>
            </label>
          )}
          {waiting && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for Scout… Complete the sign-in in the new tab.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {connected ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnect}
                  disabled={issueState.isPending || waiting}
                  className="gap-1.5"
                >
                  {(issueState.isPending || waiting) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  Reconnect
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  className="text-destructive hover:text-destructive"
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                onClick={handleConnect}
                disabled={issueState.isPending || waiting}
                size="sm"
                className="gap-1.5"
              >
                {(issueState.isPending || waiting) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                Connect Scout
              </Button>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect A-Player Scout?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved Scout credentials and unlinks Scout from
              any workflow steps it was assigned to. You can reconnect at any
              time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── marketplace: A-Player Enrich card ────────────────────────────────────────
//
// A peer to ScoutMarketplaceCard so the marketplace section now showcases the
// "list of integrations + the steps they power" pattern with more than one
// real card. Same redirect-flavored OAuth-style flow, different powered step
// (`enrichment`) and different BroadcastChannel/localStorage/postMessage
// channel names so the two cards don't react to each other's connect events.

const ENRICH_PROVIDER_NAME = "A-Player Enrich";

/**
 * Workflow steps the Enrich integration is currently capable of powering.
 * Server-side mirror lives at
 * `artifacts/api-server/src/routes/integrations-enrich.ts:ENRICH_POWERED_STEPS`.
 */
const ENRICH_POWERED_STEPS: WorkflowStep[] = ["enrichment"];

function EnrichMarketplaceCard({ providers }: { providers: Provider[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [autoAssign, setAutoAssign] = useState(true);
  const issueState = useIssueEnrichConnectState();
  const disconnect = useDisconnectEnrich();
  const testConn = useTestProviderConnection();
  const [livePing, setLivePing] = useState<{ ok: boolean | null; checking: boolean }>(
    { ok: null, checking: false },
  );

  const enrichProvider = providers.find(
    (p) => p.name === ENRICH_PROVIDER_NAME && p.type === "twin_webhook",
  );
  const connected = !!enrichProvider && enrichProvider.enabled;

  useEffect(() => {
    if (!enrichProvider) {
      setLivePing({ ok: null, checking: false });
      return;
    }
    let cancelled = false;
    setLivePing({ ok: null, checking: true });
    testConn
      .mutateAsync({ id: enrichProvider.id })
      .then((res) => {
        if (cancelled) return;
        setLivePing({ ok: (res as { ok: boolean }).ok, checking: false });
      })
      .catch(() => {
        if (cancelled) return;
        setLivePing({ ok: false, checking: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichProvider?.id]);

  useEffect(() => {
    if (!waiting) return;
    function onSuccess(payload: {
      ok: boolean;
      error?: string | null;
      assignedSteps?: string[];
    }) {
      setWaiting(false);
      qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      qc.invalidateQueries({ queryKey: getListProviderStepSettingsQueryKey() });
      if (payload.ok) {
        const steps = (payload.assignedSteps ?? []).filter(
          (s): s is WorkflowStep => ENRICH_POWERED_STEPS.includes(s as WorkflowStep),
        );
        const description =
          steps.length > 0
            ? `Wired up: ${steps.map(stepLabel).join(", ")}.`
            : "No workflow steps were auto-assigned. Wire Enrich up from Workflow Step Assignments below.";
        toast({
          title: "Connected to A-Player Enrich",
          description,
        });
      } else {
        toast({
          title: "Enrich connection failed",
          description: payload.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    }
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("daneel:enrich-connect");
      bc.onmessage = (ev) => onSuccess(ev.data);
    } catch {
      bc = null;
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== "daneel.enrichConnect" || !e.newValue) return;
      try {
        onSuccess(JSON.parse(e.newValue));
      } catch {
        /* ignore */
      }
    }
    function onMessage(e: MessageEvent) {
      const data = e.data as
        | {
            source?: string;
            ok?: boolean;
            error?: string | null;
            assignedSteps?: string[];
          }
        | undefined;
      if (!data || data.source !== "daneel-enrich-connect") return;
      onSuccess({
        ok: !!data.ok,
        error: data.error ?? null,
        assignedSteps: data.assignedSteps ?? [],
      });
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("message", onMessage);
    return () => {
      bc?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onMessage);
    };
  }, [waiting, qc, toast]);

  async function handleConnect() {
    try {
      const res = (await issueState.mutateAsync({
        data: { autoAssignSteps: autoAssign },
      })) as {
        connectUrl: string;
        state: string;
      };
      setWaiting(true);
      const popup = window.open(res.connectUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        window.location.href = res.connectUrl;
      }
    } catch (err) {
      setWaiting(false);
      toast({
        title: "Could not start Enrich connection",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleDisconnect() {
    if (!enrichProvider) return;
    try {
      await disconnect.mutateAsync();
      qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      qc.invalidateQueries({ queryKey: getListProviderStepSettingsQueryKey() });
      toast({ title: "Disconnected from A-Player Enrich" });
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    } finally {
      setDeleteOpen(false);
    }
  }

  return (
    <>
      <div className="border border-border rounded-lg p-5 bg-card flex items-start gap-4">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">A-Player Enrich</span>
            {connected ? (
              <Badge variant="outline" className="text-xs gap-1 border-green-500/40 text-green-700">
                <CheckCircle className="h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Not connected
              </Badge>
            )}
            {connected && livePing.ok === true && (
              <span className="text-xs text-green-700 flex items-center gap-1">
                <Wifi className="h-3 w-3" /> Live
              </span>
            )}
            {connected && livePing.ok === false && !livePing.checking && (
              <span className="text-xs text-destructive flex items-center gap-1">
                <WifiOff className="h-3 w-3" /> Offline
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Profile enrichment for thin candidate records. Connect once and
            Enrich becomes your enrichment step — no API key paste required.
          </p>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {connected ? "Powers" : "Will power"}:
            </span>
            {ENRICH_POWERED_STEPS.map((step) => (
              <Badge key={step} variant="secondary" className="text-xs">
                {stepLabel(step)}
              </Badge>
            ))}
          </div>
          {!connected && (
            <label className="mt-3 flex items-start gap-2 text-xs cursor-pointer select-none">
              <Switch
                checked={autoAssign}
                onCheckedChange={setAutoAssign}
                disabled={issueState.isPending || waiting}
                aria-label="Auto-assign workflow steps when connecting"
              />
              <span className="text-muted-foreground leading-tight">
                Auto-assign these workflow steps on connect.{" "}
                <span className="text-foreground/70">
                  Steps already wired to another provider stay untouched.
                </span>
              </span>
            </label>
          )}
          {waiting && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for Enrich… Complete the sign-in in the new tab.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {connected ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnect}
                  disabled={issueState.isPending || waiting}
                  className="gap-1.5"
                >
                  {(issueState.isPending || waiting) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  Reconnect
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  className="text-destructive hover:text-destructive"
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                onClick={handleConnect}
                disabled={issueState.isPending || waiting}
                size="sm"
                className="gap-1.5"
              >
                {(issueState.isPending || waiting) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                Connect Enrich
              </Button>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect A-Player Enrich?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved Enrich credentials and unlinks Enrich
              from any workflow steps it was assigned to. You can reconnect
              at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── main section ──────────────────────────────────────────────────────────────
//
// Rendered as the "Advanced (admin)" disclosure inside the Provider
// Marketplace. This section exposes the raw provider CRUD form, the Scout
// OAuth card, and the full workflow step assignments table — including the
// Council-only `decision` step — that the marketplace catalog cards alone
// don't surface.

export function AdvancedProvidersSection() {
  const { data: providers = [], isLoading: loadingProviders } = useListProviders();
  const { data: stepSettings = [], isLoading: loadingSteps } = useListProviderStepSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const deleteProvider = useDeleteProvider();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<Provider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);

  function openCreate() {
    setEditProvider(null);
    setDialogOpen(true);
  }

  function openEdit(p: Provider) {
    setEditProvider(p);
    setDialogOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteProvider.mutateAsync({ id: deleteTarget.id });
      qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      toast({ title: "Provider deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  }

  // Build step settings map for quick lookup
  const stepSettingsMap = new Map(
    (stepSettings as Array<{ workflowStep: WorkflowStep; providerId: number; enabled: boolean; provider?: Provider; id: number }>)
      .map((s) => [s.workflowStep, s]),
  );

  return (
    <div className="space-y-10">
      {/* Marketplace section */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">A-Player Scout</h2>
          <p className="text-sm text-muted-foreground">
            One-click OAuth integration with A-Player Scout. No copy-pasting API keys.
          </p>
        </div>
        <div className="space-y-3">
          <ScoutMarketplaceCard providers={providers as Provider[]} />
          <EnrichMarketplaceCard providers={providers as Provider[]} />
        </div>
      </section>

      {/* Providers section */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Configured Providers</h2>
            <p className="text-sm text-muted-foreground">Add and manage your AI provider connections</p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Provider
          </Button>
        </div>

        {loadingProviders ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading providers…
          </div>
        ) : (providers as Provider[]).length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-8 text-center">
            <Cpu className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
            <p className="font-medium text-foreground mb-1">No providers configured</p>
            <p className="text-sm text-muted-foreground mb-4">
              The native OpenAI provider is always available as the default. Add a custom provider to route specific workflow steps to your own AI endpoint.
            </p>
            <Button variant="outline" onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Add your first provider
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {(providers as Provider[]).map((p) => (
              <ProviderCard key={p.id} provider={p} onEdit={openEdit} onDelete={setDeleteTarget} />
            ))}
          </div>
        )}
      </section>

      {/* Step assignments section */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">Workflow Step Assignments</h2>
          <p className="text-sm text-muted-foreground">
            Assign a provider to each workflow step. Steps with no assignment use the native OpenAI provider by default.
          </p>
        </div>

        <div className="border border-border rounded-lg bg-card px-5">
          {loadingSteps ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading step settings…
            </div>
          ) : (
            WORKFLOW_STEPS.map((step) => (
              <StepAssignmentRow
                key={step.key}
                step={step}
                providers={providers as Provider[]}
                currentSetting={stepSettingsMap.get(step.key)}
              />
            ))
          )}
        </div>

        {(providers as Provider[]).length === 0 && (
          <p className="text-sm text-muted-foreground mt-3 text-center">
            Add a provider above to start assigning steps.
          </p>
        )}
      </section>

      {/* Native OpenAI default note */}
      <div className="mt-8 rounded-md bg-muted/40 border border-border p-4 flex gap-3">
        <Cpu className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Native OpenAI is always the fallback</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            If a custom provider is disabled, errors, or times out, the workflow engine automatically falls back to the native OpenAI provider to ensure runs always complete. Error details are recorded in the agent logs.
          </p>
        </div>
      </div>

      {/* Dialogs */}
      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editProvider={editProvider}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete provider?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong>. Any workflow steps assigned to this provider will revert to the native OpenAI default.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
