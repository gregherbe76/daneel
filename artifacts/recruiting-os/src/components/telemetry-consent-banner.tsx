import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getConsent, setConsent, subscribeConsent } from "@/lib/telemetry";

export function TelemetryConsentBanner() {
  const [consent, setLocalConsent] = useState(() => getConsent());

  useEffect(() => {
    const update = () => setLocalConsent(getConsent());
    update();
    return subscribeConsent(update);
  }, []);

  if (consent !== null) return null;

  // Hide entirely when telemetry is disabled by config (no key) or in dev,
  // so the banner doesn't show for something that can never fire anyway.
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (import.meta.env.DEV || !key || key.trim() === "") return null;

  const accept = () => {
    setConsent(true);
    setLocalConsent("granted");
  };
  const decline = () => {
    setConsent(false);
    setLocalConsent("denied");
  };

  return (
    <div
      data-testid="telemetry-consent-banner"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-xl w-[calc(100%-2rem)] rounded-lg border border-border bg-card shadow-lg p-4 flex items-center gap-4"
    >
      <div className="flex-1 text-sm text-foreground">
        <p>
          Help improve Daneel with anonymous usage data?{" "}
          <a
            href="/docs/TELEMETRY.md"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-muted-foreground hover:text-foreground"
          >
            Learn more
          </a>
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={decline} data-testid="telemetry-consent-no">
          No
        </Button>
        <Button size="sm" onClick={accept} data-testid="telemetry-consent-yes">
          Yes
        </Button>
      </div>
    </div>
  );
}
