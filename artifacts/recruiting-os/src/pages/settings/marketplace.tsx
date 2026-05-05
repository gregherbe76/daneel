import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProviders,
  useListProviderStepSettings,
  useCreateProvider,
  useUpdateProvider,
  getListProvidersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type CatalogEntry,
  type ConnectProvider,
  type ProviderCategory,
  type StubProvider,
} from "./marketplace/catalog";
import { CheckCircle2, Loader2, Sparkles, AlertTriangle, KeyRound } from "lucide-react";

type ProviderRecord = {
  id: number;
  name: string;
  type: string;
  webhookUrl?: string | null;
  enabled: boolean;
};

const APIFY_LS_KEY = "hiringai.apifyKey";

function getApifyKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(APIFY_LS_KEY) ?? "";
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
  if (entry.connectType === "apify") {
    return getApifyKey() ? "connected" : "disconnected";
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

  // Seed inputs whenever the dialog opens for a different entry.
  const existing = useMemo(() => {
    if (!entry) return null;
    if (entry.connectType === "custom_webhook")
      return providers.find((p) => p.type === "custom_webhook") ?? null;
    if (entry.connectType === "serpapi")
      return providers.find((p) => p.type === "web_search") ?? null;
    return null;
  }, [entry, providers]);

  // Sync inputs when dialog opens
  useMemo(() => {
    if (!open || !entry) return;
    if (entry.connectType === "custom_webhook") {
      setWebhookUrl(existing?.webhookUrl ?? "");
    } else if (entry.connectType === "apify") {
      setApiKey(getApifyKey());
    } else {
      setApiKey("");
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
        const payload = {
          name: "SerpAPI Web Search",
          type: "web_search" as const,
          webhookUrl: null,
          baseUrl: null,
          apiKeyPlaceholder: apiKey || null,
          config: null,
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
      } else if (entry.connectType === "apify") {
        if (apiKey) {
          window.localStorage.setItem(APIFY_LS_KEY, apiKey);
        } else {
          window.localStorage.removeItem(APIFY_LS_KEY);
        }
        toast({
          title: "Apify key saved locally",
          description: "Engine integration ships in a follow-up.",
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
      <DialogContent className="max-w-md" data-testid={`connect-dialog-${entry.connectType}`}>
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
              Leave blank to register the provider without a target — you can wire it up later from
              Workflow Step Assignments.
            </p>
          </div>
        )}

        {entry.connectType === "serpapi" && (
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
        )}

        {entry.connectType === "apify" && (
          <>
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
            </div>
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-800">
              Engine integration is not live yet — the key is captured and stored on this device so
              the card flips to Connected. Sourcing runs still need the workflow handler that ships
              in a follow-up task.
            </div>
          </>
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

      <div className="mt-auto flex items-center justify-between gap-2">
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
