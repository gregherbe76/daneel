import { useEffect, useState } from "react";
import { Link } from "wouter";
import { BarChart3, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SettingsTabs } from "@/components/settings-tabs";
import {
  getConsent,
  getRecentEvents,
  setConsent,
  subscribeConsent,
  subscribeRecentEvents,
  type RecentTelemetryEntry,
} from "@/lib/telemetry";

export default function TelemetrySettingsPage() {
  const [consent, setLocalConsent] = useState(() => getConsent());
  const [recent, setRecent] = useState<readonly RecentTelemetryEntry[]>(
    () => getRecentEvents(),
  );
  const [recentOpen, setRecentOpen] = useState(false);

  useEffect(() => {
    const update = () => setLocalConsent(getConsent());
    update();
    return subscribeConsent(update);
  }, []);

  useEffect(() => {
    const update = () => setRecent(getRecentEvents());
    update();
    return subscribeRecentEvents(update);
  }, []);

  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const isDev = Boolean(import.meta.env.DEV);
  const disabledByConfig = isDev || !key || key.trim() === "";

  const enabled = consent === "granted";

  const onToggle = (next: boolean) => {
    setConsent(next);
    setLocalConsent(next ? "granted" : "denied");
  };

  return (
    <div>
      <SettingsTabs />
      <div className="p-8 max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Telemetry</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Anonymous usage data helps us understand which parts of Daneel are
            useful. We never collect candidate data, job descriptions, emails,
            or names.{" "}
            <a
              href="/docs/TELEMETRY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Read the full policy
            </a>
            .
          </p>
        </div>

        <div className="border border-border rounded-lg p-5 bg-card flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label className="text-sm font-medium text-foreground">
              Share anonymous usage data
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Sends a small, fixed list of events (workflow started/completed,
              provider card viewed/connected) to PostHog Cloud (EU). Off by
              default.
            </p>
            {disabledByConfig && (
              <p className="text-xs text-amber-600 mt-2">
                {isDev
                  ? "Disabled in development mode — no events will be sent regardless of this setting."
                  : "Telemetry key not configured — set VITE_POSTHOG_KEY to enable."}
              </p>
            )}
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={disabledByConfig}
            data-testid="telemetry-consent-toggle"
            aria-label="Share anonymous usage data"
          />
        </div>

        {enabled && (
          <Collapsible
            open={recentOpen}
            onOpenChange={setRecentOpen}
            className="border border-border rounded-lg bg-card"
            data-testid="recent-events-section"
          >
            <CollapsibleTrigger
              className="w-full flex items-center justify-between gap-4 p-5 text-left"
              data-testid="recent-events-toggle"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Recent events ({recent.length})
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  The last {recent.length === 0 ? 20 : recent.length} events
                  this browser has sent. Only event names, timestamps, and
                  payload key names are shown — never the values.
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${
                  recentOpen ? "rotate-180" : ""
                }`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t border-border px-5 py-4">
                {recent.length === 0 ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="recent-events-empty"
                  >
                    No events sent yet in this session.
                  </p>
                ) : (
                  <ul
                    className="space-y-2"
                    data-testid="recent-events-list"
                  >
                    {recent
                      .slice()
                      .reverse()
                      .map((entry, idx) => (
                        <li
                          key={`${entry.timestamp}-${idx}`}
                          className="flex items-start justify-between gap-4 text-xs"
                          data-testid="recent-events-item"
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-foreground">
                              {entry.event}
                            </p>
                            <p className="text-muted-foreground mt-0.5">
                              keys: {entry.payloadKeys.join(", ") || "—"}
                            </p>
                          </div>
                          <time className="text-muted-foreground font-mono shrink-0">
                            {entry.timestamp}
                          </time>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <Link href="/settings/telemetry/dashboard">
          <a
            className="border border-border rounded-lg p-5 bg-card flex items-center justify-between gap-4 hover:bg-muted/40 transition cursor-pointer"
            data-testid="link-telemetry-dashboard"
          >
            <div className="flex items-start gap-3 min-w-0">
              <BarChart3 className="h-5 w-5 mt-0.5 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  View usage dashboard
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Aggregated counts and 7/30-day trend lines for the five
                  allow-listed events. Read directly from PostHog via a
                  server-side key.
                </p>
              </div>
            </div>
            <span className="text-xs text-primary font-medium shrink-0">
              Open →
            </span>
          </a>
        </Link>
      </div>
    </div>
  );
}
