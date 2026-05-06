import { useEffect, useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useIssueScoutConnectState,
  useDisconnectScout,
  useIssueEnrichConnectState,
  useDisconnectEnrich,
  useTestProviderConnection,
  getListProvidersQueryKey,
  getListProviderStepSettingsQueryKey,
} from "@workspace/api-client-react";
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
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Wifi,
  WifiOff,
  CheckCircle,
  Loader2,
  Sparkles,
  ExternalLink,
} from "lucide-react";

// ── shared workflow-step typing (kept local to avoid pulling on the much
// larger admin module that still owns the canonical WORKFLOW_STEPS list) ─────

export type WorkflowStep =
  | "job_understanding"
  | "candidate_matching"
  | "shortlist_generation"
  | "sourcing_later"
  | "sourcing"
  | "enrichment"
  | "decision";

const WORKFLOW_STEP_LABELS: Record<WorkflowStep, string> = {
  job_understanding: "Job Understanding",
  candidate_matching: "Candidate Matching",
  shortlist_generation: "Shortlist",
  sourcing: "Sourcing",
  enrichment: "Enrichment",
  decision: "Decision (Council)",
  sourcing_later: "Sourcing (future)",
};

function stepLabel(step: WorkflowStep): string {
  return WORKFLOW_STEP_LABELS[step] ?? step;
}

// Minimal Provider shape this card needs — matches the row returned by
// `useListProviders`. Kept structural so callers can pass the richer admin
// Provider type without an explicit cast.
export interface MarketplaceCardProvider {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
}

// ── registry ────────────────────────────────────────────────────────────────
//
// One entry per first-party "A-Player" marketplace card. Adding a new card is
// a single registry entry plus the matching server route — no new React
// component required. See server-side counterparts:
//   artifacts/api-server/src/routes/integrations-scout.ts
//   artifacts/api-server/src/routes/integrations-enrich.ts

// Structural shapes for the two mutation hooks each card relies on. We keep
// them intentionally narrow — only the fields/methods this component actually
// reads — so the registry can hold the generated hooks directly without `any`
// or `unknown` casts. Each generated hook from `@workspace/api-client-react`
// is structurally compatible because its `mutateAsync` accepts the same
// `{ data: { autoAssignSteps?: boolean } }` shape (autoAssignSteps is
// optional in the OpenAPI body, so passing a required boolean is fine).
export interface IssueConnectStateHookResult {
  mutateAsync: (variables: {
    data: { autoAssignSteps?: boolean };
  }) => Promise<unknown>;
  isPending: boolean;
}

export interface DisconnectHookResult {
  mutateAsync: () => Promise<unknown>;
  isPending: boolean;
}

export interface MarketplaceCardSpec {
  /** Stable id used for keys / debugging. */
  id: string;
  /** Provider row name written by the server when the integration connects. */
  providerName: string;
  /** Provider row type written by the server (always `twin_webhook` today). */
  providerType: string;
  /** Headline icon shown in the card's accent square. */
  icon: ComponentType<{ className?: string }>;
  /** Card title shown to recruiters (e.g. "A-Player Scout"). */
  title: string;
  /** One-paragraph card description. */
  description: string;
  /** Workflow steps the integration is currently capable of powering. */
  poweredSteps: WorkflowStep[];
  /** Label on the Connect button (e.g. "Connect Scout"). */
  connectLabel: string;
  /** Inline status message while we wait for the OAuth-style callback. */
  waitingMessage: string;
  /** Toast titles for the various lifecycle events. */
  toasts: {
    connectedTitle: string;
    failedTitle: string;
    cantStartTitle: string;
    disconnectedTitle: string;
    /** Used when the callback succeeded but no steps got auto-assigned. */
    notWiredFallback: string;
  };
  /** Wording for the "Disconnect …" confirmation dialog. */
  disconnectDialog: { title: string; description: string };
  /** BroadcastChannel / localStorage / postMessage channel names. The three
   *  channels must agree with the callback HTML page that the server route
   *  serves on success. */
  channels: {
    broadcastChannel: string;
    storageKey: string;
    postMessageSource: string;
  };
  /** Hook that issues the redirect-flavored OAuth state and returns the
   *  connect URL. */
  useIssueConnectState: () => IssueConnectStateHookResult;
  /** Hook that deletes the saved provider row + its step assignments. */
  useDisconnect: () => DisconnectHookResult;
}

export const SCOUT_MARKETPLACE_CARD: MarketplaceCardSpec = {
  id: "scout",
  providerName: "A-Player Scout",
  providerType: "twin_webhook",
  icon: Sparkles,
  title: "A-Player Scout",
  description:
    "JD-driven candidate sourcing. Connect once and Scout becomes your sourcing step — no API key paste required.",
  poweredSteps: ["sourcing"],
  connectLabel: "Connect Scout",
  waitingMessage: "Waiting for Scout… Complete the sign-in in the new tab.",
  toasts: {
    connectedTitle: "Connected to A-Player Scout",
    failedTitle: "Scout connection failed",
    cantStartTitle: "Could not start Scout connection",
    disconnectedTitle: "Disconnected from A-Player Scout",
    notWiredFallback:
      "No workflow steps were auto-assigned. Wire Scout up from Workflow Step Assignments below.",
  },
  disconnectDialog: {
    title: "Disconnect A-Player Scout?",
    description:
      "This removes the saved Scout credentials and unlinks Scout from any workflow steps it was assigned to. You can reconnect at any time.",
  },
  channels: {
    broadcastChannel: "daneel:scout-connect",
    storageKey: "daneel.scoutConnect",
    postMessageSource: "daneel-scout-connect",
  },
  useIssueConnectState: useIssueScoutConnectState,
  useDisconnect: useDisconnectScout,
};

export const ENRICH_MARKETPLACE_CARD: MarketplaceCardSpec = {
  id: "enrich",
  providerName: "A-Player Enrich",
  providerType: "twin_webhook",
  icon: Sparkles,
  title: "A-Player Enrich",
  description:
    "Profile enrichment for thin candidate records. Connect once and Enrich becomes your enrichment step — no API key paste required.",
  poweredSteps: ["enrichment"],
  connectLabel: "Connect Enrich",
  waitingMessage: "Waiting for Enrich… Complete the sign-in in the new tab.",
  toasts: {
    connectedTitle: "Connected to A-Player Enrich",
    failedTitle: "Enrich connection failed",
    cantStartTitle: "Could not start Enrich connection",
    disconnectedTitle: "Disconnected from A-Player Enrich",
    notWiredFallback:
      "No workflow steps were auto-assigned. Wire Enrich up from Workflow Step Assignments below.",
  },
  disconnectDialog: {
    title: "Disconnect A-Player Enrich?",
    description:
      "This removes the saved Enrich credentials and unlinks Enrich from any workflow steps it was assigned to. You can reconnect at any time.",
  },
  channels: {
    broadcastChannel: "daneel:enrich-connect",
    storageKey: "daneel.enrichConnect",
    postMessageSource: "daneel-enrich-connect",
  },
  useIssueConnectState: useIssueEnrichConnectState,
  useDisconnect: useDisconnectEnrich,
};

export const MARKETPLACE_CARDS: MarketplaceCardSpec[] = [
  SCOUT_MARKETPLACE_CARD,
  ENRICH_MARKETPLACE_CARD,
];

// ── parameterized component ─────────────────────────────────────────────────

export function MarketplaceConnectCard({
  spec,
  providers,
}: {
  spec: MarketplaceCardSpec;
  providers: MarketplaceCardProvider[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [autoAssign, setAutoAssign] = useState(true);
  const issueState = spec.useIssueConnectState();
  const disconnect = spec.useDisconnect();
  const testConn = useTestProviderConnection();
  const [livePing, setLivePing] = useState<{ ok: boolean | null; checking: boolean }>(
    { ok: null, checking: false },
  );

  const provider = providers.find(
    (p) => p.name === spec.providerName && p.type === spec.providerType,
  );
  const connected = !!provider && provider.enabled;
  const Icon = spec.icon;

  // Quietly ping the existing provider once on mount (and whenever the row
  // changes) so the card can show a green "Live" / red "Offline" pip without
  // the recruiter having to click anything.
  useEffect(() => {
    if (!provider) {
      setLivePing({ ok: null, checking: false });
      return;
    }
    let cancelled = false;
    setLivePing({ ok: null, checking: true });
    testConn
      .mutateAsync({ id: provider.id })
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
  }, [provider?.id]);

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
          (s): s is WorkflowStep => spec.poweredSteps.includes(s as WorkflowStep),
        );
        const description =
          steps.length > 0
            ? `Wired up: ${steps.map(stepLabel).join(", ")}.`
            : spec.toasts.notWiredFallback;
        toast({
          title: spec.toasts.connectedTitle,
          description,
        });
      } else {
        toast({
          title: spec.toasts.failedTitle,
          description: payload.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    }
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(spec.channels.broadcastChannel);
      bc.onmessage = (ev) => onSuccess(ev.data);
    } catch {
      bc = null;
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== spec.channels.storageKey || !e.newValue) return;
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
      if (!data || data.source !== spec.channels.postMessageSource) return;
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
  }, [waiting, qc, toast, spec]);

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
        title: spec.toasts.cantStartTitle,
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleDisconnect() {
    if (!provider) return;
    try {
      // Use the dedicated endpoint — it unlinks workflow step assignments
      // first so the FK-restricted provider row can be deleted cleanly.
      await disconnect.mutateAsync();
      qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      qc.invalidateQueries({ queryKey: getListProviderStepSettingsQueryKey() });
      toast({ title: spec.toasts.disconnectedTitle });
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
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{spec.title}</span>
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
          <p className="text-sm text-muted-foreground mt-1">{spec.description}</p>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {connected ? "Powers" : "Will power"}:
            </span>
            {spec.poweredSteps.map((step) => (
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
              {spec.waitingMessage}
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
                {spec.connectLabel}
              </Button>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{spec.disconnectDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {spec.disconnectDialog.description}
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

// Thin back-compat wrappers so existing call-sites (and the existing test
// targeting the Scout card) keep working without knowing about the registry.

export function ScoutMarketplaceCard({
  providers,
}: {
  providers: MarketplaceCardProvider[];
}) {
  return <MarketplaceConnectCard spec={SCOUT_MARKETPLACE_CARD} providers={providers} />;
}

export function EnrichMarketplaceCard({
  providers,
}: {
  providers: MarketplaceCardProvider[];
}) {
  return <MarketplaceConnectCard spec={ENRICH_MARKETPLACE_CARD} providers={providers} />;
}
