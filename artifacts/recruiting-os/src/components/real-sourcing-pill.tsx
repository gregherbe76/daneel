import { Zap, FlaskConical, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Single source of truth for the "Real sourcing ready" / "Demo mode" pill.
 *
 * Surfaces that show this pill (jobs list, job detail header, in-page
 * pipeline header) all import from here so the icon, color, copy, and
 * tooltip stay perfectly in sync. Driven solely by the API-provided
 * `hasRealSourcingProvider` flag (see `registry.ts:hasRealSourcingProvider`).
 *
 * The "Real sourcing ready" pill is purely informational. The "Demo mode"
 * pill is interactive: clicking it opens a popover that explains why the
 * job is in demo mode and offers a one-click CTA to the Marketplace where
 * a real sourcing provider (GitHub Agent, Web Search) can be configured.
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
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="real-sourcing-pill-demo"
          className="inline-flex focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          aria-label="Demo mode — click to learn how to enable real sourcing"
          onClick={(e) => {
            // The pill often lives inside a clickable card / <Link>. Without
            // this, clicking the trigger would also navigate the parent.
            // Note: do NOT preventDefault — Radix's PopoverTrigger needs the
            // click event to flow to its own internal handler to toggle the
            // popover open.
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            // Some link/card wrappers (and wouter's <Link>) react on
            // mousedown via event delegation; stop here so the parent never
            // sees the press.
            e.stopPropagation();
          }}
        >
          <Badge
            variant="secondary"
            className={`text-muted-foreground gap-1 cursor-pointer hover:bg-secondary/80 ${className ?? ""}`}
          >
            <FlaskConical className="h-3 w-3" />
            Demo mode
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80"
        data-testid="real-sourcing-pill-demo-popover"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">This job is in Demo mode</p>
            <p className="text-sm text-muted-foreground">
              No real sourcing provider is configured, so workflow runs will
              generate mock candidates instead of finding real people.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Connect <span className="font-medium">GitHub Agent</span> or{" "}
            <span className="font-medium">Web Search</span> from the
            Marketplace to start sourcing real candidates.
          </p>
          <Link
            href="/settings/marketplace"
            data-testid="real-sourcing-pill-demo-cta"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Configure real sourcing
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
