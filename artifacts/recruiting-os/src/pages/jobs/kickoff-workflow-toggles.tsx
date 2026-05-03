import { Link } from "wouter";
import { AlertTriangle, Database, FlaskConical, Zap } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { DataMode } from "./use-kickoff-defaults";

export type KickoffWorkflowTogglesProps = {
  dataMode: DataMode;
  runSourcing: boolean;
  userTouchedToggles: boolean;
  realSourcingAvailable: boolean;
  workflowRunning: boolean;
  setDataMode: (v: DataMode) => void;
  setRunSourcing: (v: boolean) => void;
};

/**
 * Presentational slice of the workflow kickoff panel: the data-mode
 * (Demo Run / Real Data Run) selector, the "why is this defaulted"
 * hint paragraph, and the Run Sourcing checkbox.
 *
 * Extracted from JobDetailPage so the auto-defaulting integration
 * (useKickoffDefaults + this UI) can be exercised in isolation by
 * vitest without mounting the full ~1700-line detail page.
 */
export function KickoffWorkflowToggles({
  dataMode,
  runSourcing,
  userTouchedToggles,
  realSourcingAvailable,
  workflowRunning,
  setDataMode,
  setRunSourcing,
}: KickoffWorkflowTogglesProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="kickoff-data-mode-mock"
          disabled={workflowRunning}
          onClick={() => setDataMode("mock")}
          className={`flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-all ${
            dataMode === "mock"
              ? "border-amber-300 bg-amber-500/8 ring-1 ring-amber-300"
              : "border-border bg-muted/20 hover:bg-muted/40"
          }`}
        >
          <FlaskConical className={`h-3.5 w-3.5 shrink-0 ${dataMode === "mock" ? "text-amber-600" : "text-muted-foreground"}`} />
          <div>
            <p className={`text-xs font-medium leading-tight ${dataMode === "mock" ? "text-amber-800" : ""}`}>Demo Run</p>
            <p className="text-[10px] text-muted-foreground">Simulated candidates</p>
          </div>
        </button>
        <button
          type="button"
          data-testid="kickoff-data-mode-real"
          disabled={workflowRunning}
          onClick={() => setDataMode("real")}
          className={`flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-all ${
            dataMode === "real"
              ? "border-green-300 bg-green-500/8 ring-1 ring-green-300"
              : "border-border bg-muted/20 hover:bg-muted/40"
          }`}
        >
          <Database className={`h-3.5 w-3.5 shrink-0 ${dataMode === "real" ? "text-green-700" : "text-muted-foreground"}`} />
          <div>
            <p className={`text-xs font-medium leading-tight ${dataMode === "real" ? "text-green-800" : ""}`}>Real Data Run</p>
            <p className="text-[10px] text-muted-foreground">Imported + Twin only</p>
          </div>
        </button>
      </div>
      {dataMode === "real" && (
        <p className="text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          Only imported and Twin-sourced candidates will be scored.
        </p>
      )}
      {!userTouchedToggles && realSourcingAvailable && (
        <p
          data-testid="kickoff-default-hint-real"
          className="text-[10px] text-muted-foreground"
        >
          Defaulted to real because this job has a real sourcing provider configured.
        </p>
      )}
      {!userTouchedToggles && !realSourcingAvailable && (
        <p
          data-testid="kickoff-default-hint-mock"
          className="text-[10px] text-muted-foreground"
        >
          No real sourcing provider configured — running in mock mode.{" "}
          <Link href="/settings" className="underline">
            Add one in Settings → Providers
          </Link>{" "}
          to enable real sourcing.
        </p>
      )}
      <div className={`flex items-start gap-2 px-2.5 py-2 rounded-md border transition-colors ${
        runSourcing
          ? dataMode === "real" ? "border-green-200 bg-green-500/5" : "border-purple-200 bg-purple-500/5"
          : "border-border bg-muted/30"
      }`}>
        <Checkbox id="run-sourcing" checked={runSourcing} onCheckedChange={(v) => setRunSourcing(!!v)} disabled={workflowRunning} className="mt-0.5" />
        <div>
          <Label htmlFor="run-sourcing" className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
            <Zap className={`h-3 w-3 ${dataMode === "real" ? "text-green-700" : "text-purple-600"}`} />
            {dataMode === "real" ? "Source via Twin provider" : "Generate mock candidates before matching"}
          </Label>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {dataMode === "real" ? "Requires Twin webhook in Advanced settings" : "7 mock candidates tailored to this role"}
          </p>
        </div>
      </div>
    </>
  );
}
