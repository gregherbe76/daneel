import { useMemo, useState, useEffect } from "react";
import type { JobRunSummary, SourcingStats, VariantCriteria } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDown, ArrowUp, GitBranch, Minus, Zap } from "lucide-react";

type StatKey =
  | "searchTotalCount"
  | "consideredCount"
  | "extractedCount"
  | "returnedCount"
  | "droppedNoBio"
  | "droppedStale"
  | "droppedNoProfile"
  | "droppedFabricated"
  | "droppedInvalid"
  | "droppedFetchError";

type StatSpec = {
  key: StatKey;
  label: string;
  // For "good" metrics (returned, search hits, considered) higher is better.
  // For "drop" metrics, lower is better.
  betterWhen: "higher" | "lower";
};

const STAT_SPECS: StatSpec[] = [
  { key: "searchTotalCount", label: "Search hits", betterWhen: "higher" },
  { key: "consideredCount", label: "Inspected", betterWhen: "higher" },
  { key: "extractedCount", label: "Extracted", betterWhen: "higher" },
  { key: "returnedCount", label: "Returned", betterWhen: "higher" },
  { key: "droppedNoBio", label: "Dropped: empty bio", betterWhen: "lower" },
  { key: "droppedStale", label: "Dropped: stale activity", betterWhen: "lower" },
  { key: "droppedNoProfile", label: "Dropped: no profile URL", betterWhen: "lower" },
  { key: "droppedFabricated", label: "Dropped: fabricated", betterWhen: "lower" },
  { key: "droppedInvalid", label: "Dropped: invalid row", betterWhen: "lower" },
  { key: "droppedFetchError", label: "Dropped: fetch error", betterWhen: "lower" },
];

function formatRunOption(r: JobRunSummary): string {
  const date = new Date(r.createdAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const label = r.variantLabel ?? (r.variantOf ? "Variant run" : "Baseline");
  const saved =
    r.sourcingSaved != null ? ` · ${r.sourcingSaved} saved` : "";
  return `#${r.id} · ${label} · ${date}${saved}`;
}

function DeltaArrow({
  delta,
  betterWhen,
}: {
  delta: number;
  betterWhen: "higher" | "lower";
}) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground text-[11px]">
        <Minus className="h-3 w-3" /> 0
      </span>
    );
  }
  const isImprovement =
    (betterWhen === "higher" && delta > 0) ||
    (betterWhen === "lower" && delta < 0);
  const Icon = delta > 0 ? ArrowUp : ArrowDown;
  const color = isImprovement ? "text-green-700" : "text-red-700";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {sign}
      {delta.toLocaleString()}
    </span>
  );
}

function StatCell({ value }: { value: number | undefined }) {
  if (value == null) {
    return <span className="text-muted-foreground text-[11px]">—</span>;
  }
  return <span className="text-[12px] tabular-nums">{value.toLocaleString()}</span>;
}

function variantCriteriaRows(c?: VariantCriteria | null): Array<{ label: string; value: string }> {
  return [
    { label: "Seniority", value: c?.seniority?.trim() || "—" },
    {
      label: "Must-have skills",
      value:
        c?.mustHaveSkills && c.mustHaveSkills.length > 0
          ? c.mustHaveSkills.join(", ")
          : "—",
    },
    { label: "Focus note", value: c?.focusNote?.trim() || "—" },
  ];
}

function ConfigBadges({ run }: { run: JobRunSummary }) {
  const isVariant = !!run.variantOf;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isVariant ? (
        <Badge variant="outline" className="text-[10px] bg-indigo-500/10 text-indigo-700 border-indigo-200">
          <GitBranch className="h-2.5 w-2.5 mr-1" /> Variant of #{run.variantOf}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-700 border-purple-200">
          <Zap className="h-2.5 w-2.5 mr-1" /> Baseline
        </Badge>
      )}
      <Badge variant="outline" className="text-[10px] capitalize">
        {run.dataMode} data
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        {run.runSourcing ? "Sourcing on" : "Sourcing off"}
      </Badge>
    </div>
  );
}

export function CompareRuns({ runs }: { runs: JobRunSummary[] }) {
  // Only runs that included sourcing make sense to compare here, since the
  // whole point is comparing the filter breakdown.
  const sourcingRuns = useMemo(
    () => runs.filter((r) => r.runSourcing),
    [runs],
  );

  const [aId, setAId] = useState<number | null>(null);
  const [bId, setBId] = useState<number | null>(null);

  // Default to the two most recent sourcing runs, but only after the data
  // arrives. Don't lock the user out of deselecting later.
  useEffect(() => {
    if (sourcingRuns.length < 2) return;
    setAId((prev) => prev ?? sourcingRuns[0].id);
    setBId((prev) => prev ?? sourcingRuns[1].id);
  }, [sourcingRuns]);

  if (sourcingRuns.length < 2) return null;

  const runA = sourcingRuns.find((r) => r.id === aId) ?? null;
  const runB = sourcingRuns.find((r) => r.id === bId) ?? null;

  const statsA: SourcingStats | null = runA?.sourcingStats ?? null;
  const statsB: SourcingStats | null = runB?.sourcingStats ?? null;

  const savedA = runA?.sourcingSaved ?? null;
  const savedB = runB?.sourcingSaved ?? null;
  const savedDelta =
    savedA != null && savedB != null ? savedB - savedA : null;

  const rowsA = variantCriteriaRows(runA?.variantCriteria ?? null);
  const rowsB = variantCriteriaRows(runB?.variantCriteria ?? null);

  return (
    <div className="rounded-md border border-border bg-muted/10 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Compare Runs</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick two past sourcing runs to see deltas in the filter breakdown
            and what changed in the run config.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Run A (baseline)
          </p>
          <Select
            value={aId != null ? String(aId) : undefined}
            onValueChange={(v) => setAId(parseInt(v, 10))}
          >
            <SelectTrigger className="h-8 text-xs" data-testid="select-compare-run-a">
              <SelectValue placeholder="Pick a run" />
            </SelectTrigger>
            <SelectContent>
              {sourcingRuns.map((r) => (
                <SelectItem
                  key={r.id}
                  value={String(r.id)}
                  disabled={r.id === bId}
                  className="text-xs"
                >
                  {formatRunOption(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {runA && <ConfigBadges run={runA} />}
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Run B (compared to A)
          </p>
          <Select
            value={bId != null ? String(bId) : undefined}
            onValueChange={(v) => setBId(parseInt(v, 10))}
          >
            <SelectTrigger className="h-8 text-xs" data-testid="select-compare-run-b">
              <SelectValue placeholder="Pick a run" />
            </SelectTrigger>
            <SelectContent>
              {sourcingRuns.map((r) => (
                <SelectItem
                  key={r.id}
                  value={String(r.id)}
                  disabled={r.id === aId}
                  className="text-xs"
                >
                  {formatRunOption(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {runB && <ConfigBadges run={runB} />}
        </div>
      </div>

      {runA && runB && runA.id === runB.id && (
        <p className="text-xs text-amber-700">
          Pick two different runs to see deltas.
        </p>
      )}

      {runA && runB && runA.id !== runB.id && (
        <>
          <div className="rounded-md border border-border bg-background overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-1.5">Metric</th>
                  <th className="text-right font-medium px-3 py-1.5">Run A</th>
                  <th className="text-right font-medium px-3 py-1.5">Run B</th>
                  <th className="text-right font-medium px-3 py-1.5">Δ</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border bg-purple-500/5">
                  <td className="px-3 py-1.5 font-medium">Saved candidates</td>
                  <td className="px-3 py-1.5 text-right">
                    <StatCell value={savedA ?? undefined} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <StatCell value={savedB ?? undefined} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {savedDelta != null ? (
                      <DeltaArrow delta={savedDelta} betterWhen="higher" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
                {STAT_SPECS.map((spec) => {
                  const a = statsA?.[spec.key];
                  const b = statsB?.[spec.key];
                  // Only hide a row if BOTH sides have nothing AND it's a drop
                  // metric — keeps the table compact while still showing every
                  // headline metric (search hits / inspected / returned).
                  const isHeadline =
                    spec.key === "searchTotalCount" ||
                    spec.key === "consideredCount" ||
                    spec.key === "returnedCount";
                  if (!isHeadline && (a ?? 0) === 0 && (b ?? 0) === 0) return null;
                  const delta =
                    a != null && b != null ? b - a : null;
                  return (
                    <tr key={spec.key} className="border-t border-border">
                      <td className="px-3 py-1.5">{spec.label}</td>
                      <td className="px-3 py-1.5 text-right">
                        <StatCell value={a} />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <StatCell value={b} />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {delta != null ? (
                          <DeltaArrow delta={delta} betterWhen={spec.betterWhen} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Run config
            </p>
            <div className="rounded-md border border-border bg-background overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-1.5">Setting</th>
                    <th className="text-left font-medium px-3 py-1.5">Run A</th>
                    <th className="text-left font-medium px-3 py-1.5">Run B</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "Label",
                      a: runA.variantLabel ?? (runA.variantOf ? "Variant run" : "Baseline"),
                      b: runB.variantLabel ?? (runB.variantOf ? "Variant run" : "Baseline"),
                    },
                    { label: "Data mode", a: runA.dataMode, b: runB.dataMode },
                    {
                      label: "Sourcing enabled",
                      a: runA.runSourcing ? "yes" : "no",
                      b: runB.runSourcing ? "yes" : "no",
                    },
                    {
                      label: "Variant of",
                      a: runA.variantOf != null ? `#${runA.variantOf}` : "—",
                      b: runB.variantOf != null ? `#${runB.variantOf}` : "—",
                    },
                    ...rowsA.map((rowA, i) => ({
                      label: rowA.label,
                      a: rowA.value,
                      b: rowsB[i]?.value ?? "—",
                    })),
                  ].map((row) => {
                    const changed = row.a !== row.b;
                    return (
                      <tr
                        key={row.label}
                        className={`border-t border-border ${changed ? "bg-amber-500/5" : ""}`}
                      >
                        <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                        <td
                          className={`px-3 py-1.5 ${changed ? "font-medium" : ""}`}
                        >
                          {row.a}
                        </td>
                        <td
                          className={`px-3 py-1.5 ${changed ? "font-medium text-amber-900" : ""}`}
                        >
                          {row.b}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
