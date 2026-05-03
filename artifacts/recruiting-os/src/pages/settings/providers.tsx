import { useState } from "react";
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
} from "lucide-react";

// ── types ────────────────────────────────────────────────────────────────────

type ProviderType = "native_openai" | "custom_webhook" | "twin_webhook" | "github";
type WorkflowStep =
  | "job_understanding"
  | "candidate_matching"
  | "shortlist_generation"
  | "sourcing_later"
  | "sourcing"
  | "enrichment";

interface Provider {
  id: number;
  name: string;
  type: ProviderType;
  baseUrl?: string | null;
  webhookUrl?: string | null;
  apiKeyEncryptedPlaceholder?: string | null;
  config?: { github?: GithubProviderConfig | null } | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const WORKFLOW_STEPS: { key: WorkflowStep; label: string; description: string; comingSoon?: boolean }[] = [
  { key: "job_understanding", label: "Job Understanding", description: "Reads the job posting and pulls out what really matters" },
  { key: "candidate_matching", label: "Candidate Matching", description: "Scores every candidate against the role across the HiringAI 3-dimension rubric (autonomy, product mindset, impact)" },
  { key: "shortlist_generation", label: "Shortlist", description: "Ranks the strongest candidates and writes a hiring summary you can share" },
  { key: "sourcing", label: "Sourcing", description: "Brings new candidates into the pipeline before screening. Twin uses POST /workflow/sourcing" },
  { key: "enrichment", label: "Enrichment", description: "Fills in missing details on each candidate (skills, headline, summary) before scoring. Twin uses POST /workflow/enrichment" },
  { key: "sourcing_later", label: "Sourcing (future)", description: "Proactive outreach and external sourcing (coming soon)", comingSoon: true },
];

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  native_openai: "Native OpenAI",
  custom_webhook: "Custom Webhook",
  twin_webhook: "Twin Webhook",
  github: "GitHub Agent",
};

const PROVIDER_TYPE_ICONS: Record<ProviderType, React.ComponentType<{ className?: string }>> = {
  native_openai: Cpu,
  custom_webhook: Webhook,
  twin_webhook: Zap,
  github: Github,
};

// ── form schema ──────────────────────────────────────────────────────────────

const providerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["native_openai", "custom_webhook", "twin_webhook", "github"]),
  baseUrl: z.string().optional(),
  webhookUrl: z.string().optional(),
  apiKeyPlaceholder: z.string().optional(),
  enabled: z.boolean().default(true),
  githubExtraKeywords: z.string().optional(),
  githubExcludeOrgs: z.string().optional(),
  githubMinFollowers: z.string().optional(),
  githubMinRepos: z.string().optional(),
});
type ProviderFormValues = z.infer<typeof providerSchema>;

interface GithubProviderConfig {
  extraKeywords?: string | null;
  excludeOrgs?: string | null;
  minFollowers?: number | null;
  minRepos?: number | null;
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

  async function handleToggle(enabled: boolean) {
    await toggle.mutateAsync({ id: provider.id, data: { enabled } });
    qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConn.mutateAsync({ id: provider.id });
      setTestResult(result as { ok: boolean; error?: string | null; latencyMs?: number | null });
      if ((result as { ok: boolean }).ok) {
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
  const enabledProviders = providers.filter((p) => p.enabled);

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
          <p className="text-xs text-muted-foreground italic">No enabled providers</p>
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
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          apiKeyPlaceholder: editProvider.apiKeyEncryptedPlaceholder ?? "",
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
        }
      : { name: "", type: "native_openai", enabled: true },
  });

  const providerType = watch("type");

  async function onSubmit(values: ProviderFormValues) {
    let config: { github?: GithubProviderConfig } | null = null;
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
      };
      const hasAny = gh.extraKeywords || gh.excludeOrgs || gh.minFollowers != null || gh.minRepos != null;
      if (hasAny) config = { github: gh };
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
              </SelectContent>
            </Select>
          </div>

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
                placeholder="sk-..."
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">Sent as <code className="text-xs">Authorization: Bearer …</code> — stored as a placeholder, never exposed to the frontend</p>
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

// ── main page ─────────────────────────────────────────────────────────────────

export default function AgentProvidersPage() {
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
    <div className="p-8 max-w-4xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Agent Providers</h1>
        <p className="text-muted-foreground mt-1">
          Configure which AI provider runs each step of the workflow. The native OpenAI provider is always the default fallback.
        </p>
      </div>

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
