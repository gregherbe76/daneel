import { useMemo, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
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

const NONE_VALUE = "__none__";

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

function RunPicker({
  label,
  helper,
  value,
  onChange,
  runs,
  disabledIds,
  allowNone,
  testId,
  selectedRun,
}: {
  label: string;
  helper: string;
  value: number | null;
  onChange: (next: number | null) => void;
  runs: JobRunSummary[];
  disabledIds: Set<number>;
  allowNone: boolean;
  testId: string;
  selectedRun: JobRunSummary | null;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p className="text-[10px] text-muted-foreground">{helper}</p>
      <Select
        value={value != null ? String(value) : allowNone ? NONE_VALUE : undefined}
        onValueChange={(v) => onChange(v === NONE_VALUE ? null : parseInt(v, 10))}
      >
        <SelectTrigger className="h-8 text-xs" data-testid={testId}>
          <SelectValue placeholder="Pick a run" />
        </SelectTrigger>
        <SelectContent>
          {allowNone && (
            <SelectItem value={NONE_VALUE} className="text-xs text-muted-foreground">
              None — hide this column
            </SelectItem>
          )}
          {runs.map((r) => (
            <SelectItem
              key={r.id}
              value={String(r.id)}
              disabled={disabledIds.has(r.id)}
              className="text-xs"
            >
              {formatRunOption(r)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedRun && <ConfigBadges run={selectedRun} />}
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

  const search = useSearch();
  const [location, navigate] = useLocation();

  const parseRunId = (raw: string | null): number | null => {
    if (raw == null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  };

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const urlAId = parseRunId(params.get("compareA"));
  const urlBId = parseRunId(params.get("compareB"));
  // Run C is optional — null means "hide that column".
  const urlCId = parseRunId(params.get("compareC"));

  const updateCompareParams = (
    nextA: number | null,
    nextB: number | null,
    nextC: number | null,
  ) => {
    const parsed = new URLSearchParams(search);
    if (nextA != null) parsed.set("compareA", String(nextA));
    else parsed.delete("compareA");
    if (nextB != null) parsed.set("compareB", String(nextB));
    else parsed.delete("compareB");
    if (nextC != null) parsed.set("compareC", String(nextC));
    else parsed.delete("compareC");
    const qs = parsed.toString();
    navigate(`${location}${qs ? `?${qs}` : ""}`, { replace: true });
  };

  // Default to the three most recent sourcing runs (or two if only two
  // exist) when the URL doesn't already pin a valid A/B selection. Also
  // normalises stale/invalid IDs in the URL (e.g. shared link points at a
  // deleted run) so the panel never gets stuck blank. Run C stays null
  // unless the URL explicitly opts in or there are 3+ runs available.
  useEffect(() => {
    if (sourcingRuns.length < 2) return;
    const validIds = new Set(sourcingRuns.map((r) => r.id));
    const validA = urlAId != null && validIds.has(urlAId) ? urlAId : null;
    const validB = urlBId != null && validIds.has(urlBId) ? urlBId : null;
    const validC = urlCId != null && validIds.has(urlCId) ? urlCId : null;
    // If A and B are already a valid pair, leave C untouched (whether the
    // URL set it or the user deselected it).
    if (validA != null && validB != null && validA !== validB) {
      if (validC !== urlCId || validA !== urlAId || validB !== urlBId) {
        updateCompareParams(validA, validB, validC);
      }
      return;
    }
    const fallbackA = validA ?? sourcingRuns[0].id;
    const fallbackB =
      validB ?? (sourcingRuns[1].id !== fallbackA ? sourcingRuns[1].id : sourcingRuns[0].id);
    // Only auto-fill C when the URL hasn't been touched at all (no
    // compareA / compareB / compareC present) and there are 3+ runs.
    const urlUntouched = urlAId == null && urlBId == null && urlCId == null;
    const fallbackC =
      validC ??
      (urlUntouched && sourcingRuns.length >= 3
        ? sourcingRuns[2].id
        : null);
    if (
      fallbackA !== urlAId ||
      fallbackB !== urlBId ||
      fallbackC !== urlCId
    ) {
      updateCompareParams(fallbackA, fallbackB, fallbackC);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcingRuns]);

  if (sourcingRuns.length < 2) return null;

  const aId = urlAId;
  const bId = urlBId;
  const cId = urlCId;
  const setAId = (next: number | null) => updateCompareParams(next, bId, cId);
  const setBId = (next: number | null) => updateCompareParams(aId, next, cId);
  const setCId = (next: number | null) => updateCompareParams(aId, bId, next);

  const runA = sourcingRuns.find((r) => r.id === aId) ?? null;
  const runB = sourcingRuns.find((r) => r.id === bId) ?? null;
  const runC = sourcingRuns.find((r) => r.id === cId) ?? null;

  const statsA: SourcingStats | null = runA?.sourcingStats ?? null;
  const statsB: SourcingStats | null = runB?.sourcingStats ?? null;
  const statsC: SourcingStats | null = runC?.sourcingStats ?? null;

  const savedA = runA?.sourcingSaved ?? null;
  const savedB = runB?.sourcingSaved ?? null;
  const savedC = runC?.sourcingSaved ?? null;
  const savedDeltaB =
    savedA != null && savedB != null ? savedB - savedA : null;
  const savedDeltaC =
    savedA != null && savedC != null ? savedC - savedA : null;

  const rowsA = variantCriteriaRows(runA?.variantCriteria ?? null);
  const rowsB = variantCriteriaRows(runB?.variantCriteria ?? null);
  const rowsC = variantCriteriaRows(runC?.variantCriteria ?? null);

  const showC = runC != null;
  const duplicates =
    runA &&
    runB &&
    (runA.id === runB.id ||
      (runC != null && (runA.id === runC.id || runB.id === runC.id)));

  return (
    <div className="rounded-md border border-border bg-muted/10 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Compare Runs</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick up to three past sourcing runs to see deltas in the filter
            breakdown and what changed in the run config. Run A is the baseline
            — Runs B and C are compared against it.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <RunPicker
          label="Run A (baseline)"
          helper="Everything else is compared to this run."
          value={aId}
          onChange={setAId}
          runs={sourcingRuns}
          disabledIds={new Set([bId, cId].filter((x): x is number => x != null))}
          allowNone={false}
          testId="select-compare-run-a"
          selectedRun={runA}
        />

        <RunPicker
          label="Run B (vs A)"
          helper="First variant to compare against the baseline."
          value={bId}
          onChange={setBId}
          runs={sourcingRuns}
          disabledIds={new Set([aId, cId].filter((x): x is number => x != null))}
          allowNone={false}
          testId="select-compare-run-b"
          selectedRun={runB}
        />

        <RunPicker
          label="Run C (vs A, optional)"
          helper="Second variant — leave as None for a 2-way compare."
          value={cId}
          onChange={setCId}
          runs={sourcingRuns}
          disabledIds={new Set([aId, bId].filter((x): x is number => x != null))}
          allowNone={true}
          testId="select-compare-run-c"
          selectedRun={runC}
        />
      </div>

      {duplicates && (
        <p className="text-xs text-amber-700">
          {showC
            ? "Pick three different runs to see deltas."
            : "Pick two different runs to see deltas."}
        </p>
      )}

      {runA && runB && !duplicates && (
        <>
          <div className="rounded-md border border-border bg-background overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-1.5">Metric</th>
                  <th className="text-right font-medium px-3 py-1.5">Run A</th>
                  <th className="text-right font-medium px-3 py-1.5">Run B</th>
                  <th className="text-right font-medium px-3 py-1.5">Δ B</th>
                  {showC && (
                    <>
                      <th className="text-right font-medium px-3 py-1.5">Run C</th>
                      <th className="text-right font-medium px-3 py-1.5">Δ C</th>
                    </>
                  )}
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
                    {savedDeltaB != null ? (
                      <DeltaArrow delta={savedDeltaB} betterWhen="higher" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {showC && (
                    <>
                      <td className="px-3 py-1.5 text-right">
                        <StatCell value={savedC ?? undefined} />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {savedDeltaC != null ? (
                          <DeltaArrow delta={savedDeltaC} betterWhen="higher" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
                {STAT_SPECS.map((spec) => {
                  const a = statsA?.[spec.key];
                  const b = statsB?.[spec.key];
                  const c = statsC?.[spec.key];
                  // Only hide a row if EVERY visible side has nothing AND it's
                  // a drop metric — keeps the table compact while still
                  // showing every headline metric (search hits / inspected /
                  // returned).
                  const isHeadline =
                    spec.key === "searchTotalCount" ||
                    spec.key === "consideredCount" ||
                    spec.key === "returnedCount";
                  const allEmpty =
                    (a ?? 0) === 0 &&
                    (b ?? 0) === 0 &&
                    (!showC || (c ?? 0) === 0);
                  if (!isHeadline && allEmpty) return null;
                  const deltaB = a != null && b != null ? b - a : null;
                  const deltaC = a != null && c != null ? c - a : null;
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
                        {deltaB != null ? (
                          <DeltaArrow delta={deltaB} betterWhen={spec.betterWhen} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {showC && (
                        <>
                          <td className="px-3 py-1.5 text-right">
                            <StatCell value={c} />
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {deltaC != null ? (
                              <DeltaArrow delta={deltaC} betterWhen={spec.betterWhen} />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </>
                      )}
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
                    {showC && (
                      <th className="text-left font-medium px-3 py-1.5">Run C</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "Label",
                      a: runA.variantLabel ?? (runA.variantOf ? "Variant run" : "Baseline"),
                      b: runB.variantLabel ?? (runB.variantOf ? "Variant run" : "Baseline"),
                      c: runC
                        ? runC.variantLabel ?? (runC.variantOf ? "Variant run" : "Baseline")
                        : "—",
                    },
                    {
                      label: "Data mode",
                      a: runA.dataMode,
                      b: runB.dataMode,
                      c: runC ? runC.dataMode : "—",
                    },
                    {
                      label: "Sourcing enabled",
                      a: runA.runSourcing ? "yes" : "no",
                      b: runB.runSourcing ? "yes" : "no",
                      c: runC ? (runC.runSourcing ? "yes" : "no") : "—",
                    },
                    {
                      label: "Variant of",
                      a: runA.variantOf != null ? `#${runA.variantOf}` : "—",
                      b: runB.variantOf != null ? `#${runB.variantOf}` : "—",
                      c: runC
                        ? runC.variantOf != null
                          ? `#${runC.variantOf}`
                          : "—"
                        : "—",
                    },
                    ...rowsA.map((rowA, i) => ({
                      label: rowA.label,
                      a: rowA.value,
                      b: rowsB[i]?.value ?? "—",
                      c: runC ? rowsC[i]?.value ?? "—" : "—",
                    })),
                  ].map((row) => {
                    // A cell is "changed" relative to the baseline (Run A).
                    const changedB = row.a !== row.b;
                    const changedC = showC && row.a !== row.c;
                    const rowChanged = changedB || changedC;
                    return (
                      <tr
                        key={row.label}
                        className={`border-t border-border ${rowChanged ? "bg-amber-500/5" : ""}`}
                      >
                        <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                        <td className="px-3 py-1.5">{row.a}</td>
                        <td
                          className={`px-3 py-1.5 ${changedB ? "font-medium text-amber-900" : ""}`}
                        >
                          {row.b}
                        </td>
                        {showC && (
                          <td
                            className={`px-3 py-1.5 ${changedC ? "font-medium text-amber-900" : ""}`}
                          >
                            {row.c}
                          </td>
                        )}
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
