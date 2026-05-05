import { Zap, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Single source of truth for the "Real sourcing ready" / "Demo mode" pill.
 *
 * Surfaces that show this pill (jobs list, job detail header, in-page
 * pipeline header) all import from here so the icon, color, copy, and
 * tooltip stay perfectly in sync. Driven solely by the API-provided
 * `hasRealSourcingProvider` flag (see `registry.ts:hasRealSourcingProvider`).
 */
export function RealSourcingPill({
  hasRealSourcingProvider,
  className,
}: {
  hasRealSourcingProvider: boolean | null | undefined;
  className?: string;
}) {
  if (hasRealSourcingProvider) {
    return (
      <Badge
        className={`bg-green-500/15 text-green-700 border border-green-500/30 hover:bg-green-500/15 gap-1 ${className ?? ""}`}
        title="A real sourcing provider is configured — workflow runs will use real candidates."
        data-testid="real-sourcing-pill-ready"
      >
        <Zap className="h-3 w-3" />
        Real sourcing ready
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className={`text-muted-foreground gap-1 ${className ?? ""}`}
      title="No real sourcing provider is configured — workflow runs will use mock candidates."
      data-testid="real-sourcing-pill-demo"
    >
      <FlaskConical className="h-3 w-3" />
      Demo mode
    </Badge>
  );
}
