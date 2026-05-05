import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SettingsTabs } from "@/components/settings-tabs";
import {
  getConsent,
  setConsent,
  subscribeConsent,
} from "@/lib/telemetry";

export default function TelemetrySettingsPage() {
  const [consent, setLocalConsent] = useState(() => getConsent());

  useEffect(() => {
    const update = () => setLocalConsent(getConsent());
    update();
    return subscribeConsent(update);
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
      </div>
    </div>
  );
}
