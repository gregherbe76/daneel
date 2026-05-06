import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactElement } from "react";
import type {
  JobRunSummary,
  SourcingStats,
  VariantCriteria,
} from "@workspace/api-client-react";

// ── Saved-comparison hook mocks ─────────────────────────────────────────────
// These let the new save/load/delete tests drive the saved-comparison list and
// observe what the component asks the API to do, without touching real fetch.
type SavedComparison = {
  id: number;
  jobId: number;
  name: string;
  runAId: number;
  runBId: number;
  runCId: number | null;
  createdAt: string;
};

const savedState: { list: SavedComparison[] } = { list: [] };
const createMutate = vi.fn(
  (
    _vars: {
      jobId: number;
      data: {
        name: string;
        runAId: number;
        runBId: number;
        runCId: number | null;
      };
    },
    opts?: { onSuccess?: () => void },
  ) => {
    opts?.onSuccess?.();
  },
);
const deleteMutate = vi.fn(
  (
    _vars: { jobId: number; comparisonId: number },
    opts?: { onSuccess?: () => void },
  ) => {
    opts?.onSuccess?.();
  },
);

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  // Preserve every other export from the real module so unrelated tests
  // that import e.g. `usePreviewNotificationDigest` from this same package
  // are not broken by our partial override.
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useListSavedRunComparisons: (_jobId: number) => ({
      data: savedState.list,
      isLoading: false,
      error: null,
    }),
    useCreateSavedRunComparison: () => ({
      mutate: createMutate,
      isPending: false,
    }),
    useDeleteSavedRunComparison: () => ({
      mutate: deleteMutate,
      isPending: false,
    }),
    getListSavedRunComparisonsQueryKey: (jobId: number) => [
      "saved-run-comparisons",
      jobId,
    ],
  };
});

// Import AFTER the mock so the component picks up the mocked module.
const { CompareRuns } = await import("./compare-runs");

beforeEach(() => {
  savedState.list = [];
  createMutate.mockClear();
  deleteMutate.mockClear();
});

function render(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function renderWithRouter(ui: ReactElement, initialPath = "/") {
  const loc = memoryLocation({ path: initialPath, record: true });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = rtlRender(
    <QueryClientProvider client={qc}>
      <Router hook={loc.hook}>{ui}</Router>
    </QueryClientProvider>,
  );
  return { ...utils, loc };
}

// Mirror of STAT_SPECS inside compare-runs.tsx. Kept inline (not exported from
// the component) so this test fails loudly if the component's spec list
// changes shape — that's the whole point of the test.
const STAT_SPECS = [
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
] as const;

function fullStats(value: number): SourcingStats {
  const out: Record<string, number> = {};
  for (const s of STAT_SPECS) out[s.key] = value;
  return out as SourcingStats;
}

function makeRun(opts: {
  id: number;
  stats?: SourcingStats | null;
  saved?: number | null;
  variantCriteria?: VariantCriteria | null;
  variantOf?: number | null;
  variantLabel?: string | null;
}): JobRunSummary {
  return {
    id: opts.id,
    jobId: 1,
    status: "completed",
    dataMode: "real",
    runSourcing: true,
    variantOf: opts.variantOf ?? null,
    variantLabel: opts.variantLabel ?? null,
    variantCriteria: opts.variantCriteria ?? null,
    createdAt: new Date(2026, 0, opts.id).toISOString(),
    sourcingStats: opts.stats ?? null,
    sourcingStatus: "completed",
    sourcingSaved: opts.saved ?? null,
    sourcingError: null,
  };
}

function rowFor(label: string): HTMLTableRowElement {
  const cell = screen.getByText(label, { selector: "td" });
  const tr = cell.closest("tr");
  if (!tr) throw new Error(`No <tr> ancestor for label "${label}"`);
  return tr as HTMLTableRowElement;
}

function deltaSpan(row: HTMLTableRowElement): HTMLElement {
  const cells = row.querySelectorAll("td");
  const last = cells[cells.length - 1];
  const span = last.querySelector("span");
  if (!span) throw new Error("No delta span in row");
  return span as HTMLElement;
}

describe("CompareRuns - rendering preconditions", () => {
  it("renders nothing when there are fewer than 2 sourcing runs", () => {
    const { container } = render(
      <CompareRuns runs={[makeRun({ id: 1, stats: fullStats(5), saved: 1 })]} jobId={1} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores runs that did not include sourcing", () => {
    const sourcing = makeRun({ id: 1, stats: fullStats(5), saved: 1 });
    const noSourcing: JobRunSummary = {
      ...makeRun({ id: 2 }),
      runSourcing: false,
    };
    const { container } = render(
      <CompareRuns runs={[sourcing, noSourcing]} jobId={1} />,
    );
    // Only one sourcing-bearing run remains, so the comparator collapses.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CompareRuns - delta-direction logic", () => {
  it(
    "colors B>A as improvement (green) for higher-is-better metrics " +
      "and as regression (red) for lower-is-better (drop) metrics",
    () => {
      const runA = makeRun({ id: 1, stats: fullStats(10), saved: 5 });
      const runB = makeRun({ id: 2, stats: fullStats(20), saved: 10 });
      render(<CompareRuns runs={[runA, runB]} jobId={1} />);

      // Saved candidates is treated as higher-is-better. B>A → green.
      expect(deltaSpan(rowFor("Saved candidates")).className).toMatch(
        /text-green-700/,
      );

      for (const spec of STAT_SPECS) {
        const span = deltaSpan(rowFor(spec.label));
        if (spec.betterWhen === "higher") {
          expect(
            span.className,
            `${spec.label}: B>A should be improvement (green)`,
          ).toMatch(/text-green-700/);
        } else {
          expect(
            span.className,
            `${spec.label}: B>A should be regression (red)`,
          ).toMatch(/text-red-700/);
        }
      }
    },
  );

  it(
    "colors B<A as regression (red) for higher-is-better metrics " +
      "and as improvement (green) for lower-is-better (drop) metrics",
    () => {
      const runA = makeRun({ id: 1, stats: fullStats(20), saved: 10 });
      const runB = makeRun({ id: 2, stats: fullStats(10), saved: 5 });
      render(<CompareRuns runs={[runA, runB]} jobId={1} />);

      expect(deltaSpan(rowFor("Saved candidates")).className).toMatch(
        /text-red-700/,
      );

      for (const spec of STAT_SPECS) {
        const span = deltaSpan(rowFor(spec.label));
        if (spec.betterWhen === "higher") {
          expect(
            span.className,
            `${spec.label}: B<A should be regression (red)`,
          ).toMatch(/text-red-700/);
        } else {
          expect(
            span.className,
            `${spec.label}: B<A should be improvement (green)`,
          ).toMatch(/text-green-700/);
        }
      }
    },
  );

  it("renders a neutral zero (no green/red) when A and B match exactly", () => {
    const runA = makeRun({ id: 1, stats: fullStats(7), saved: 3 });
    const runB = makeRun({ id: 2, stats: fullStats(7), saved: 3 });
    render(<CompareRuns runs={[runA, runB]} jobId={1} />);

    const labels = ["Saved candidates", ...STAT_SPECS.map((s) => s.label)];
    for (const label of labels) {
      const span = deltaSpan(rowFor(label));
      expect(
        span.className,
        `${label}: equal values should be neutral (muted)`,
      ).not.toMatch(/text-green-700|text-red-700/);
      expect(span).toHaveTextContent("0");
    }
  });

  it("formats the delta value with sign and locale separators", () => {
    const runA = makeRun({ id: 1, stats: fullStats(1000), saved: 0 });
    const runB = makeRun({ id: 2, stats: fullStats(2500), saved: 0 });
    render(<CompareRuns runs={[runA, runB]} jobId={1} />);

    // Search hits is higher-is-better and the values are non-trivial → "+1,500".
    expect(deltaSpan(rowFor("Search hits"))).toHaveTextContent("+1,500");
    // Drop metric: same direction (B>A), regression, but text is still "+1,500".
    expect(deltaSpan(rowFor("Dropped: empty bio"))).toHaveTextContent("+1,500");
  });
});

describe("CompareRuns - variant criteria diffing", () => {
  it("flags only the variant-criteria rows that differ between runs", () => {
    const runA = makeRun({
      id: 1,
      stats: fullStats(10),
      saved: 1,
      variantCriteria: {
        seniority: "senior",
        mustHaveSkills: ["go"],
        focusNote: "core platform",
      },
    });
    const runB = makeRun({
      id: 2,
      stats: fullStats(10),
      saved: 1,
      variantCriteria: {
        seniority: "senior", // unchanged
        mustHaveSkills: ["go", "rust"], // changed
        focusNote: "core platform", // unchanged
      },
    });
    render(<CompareRuns runs={[runA, runB]} jobId={1} />);

    expect(rowFor("Seniority").className).not.toMatch(/bg-amber/);
    expect(rowFor("Must-have skills").className).toMatch(/bg-amber/);
    expect(rowFor("Focus note").className).not.toMatch(/bg-amber/);
  });

  it(
    "flags every variant-criteria row when the criteria object is missing " +
      "on one side (each row falls back to —)",
    () => {
      const runA = makeRun({
        id: 1,
        stats: fullStats(10),
        saved: 1,
        variantCriteria: {
          seniority: "senior",
          mustHaveSkills: ["go", "rust"],
          focusNote: "core platform",
        },
      });
      const runB = makeRun({
        id: 2,
        stats: fullStats(10),
        saved: 1,
        variantCriteria: null,
      });
      render(<CompareRuns runs={[runA, runB]} jobId={1} />);

      expect(rowFor("Seniority").className).toMatch(/bg-amber/);
      expect(rowFor("Must-have skills").className).toMatch(/bg-amber/);
      expect(rowFor("Focus note").className).toMatch(/bg-amber/);
    },
  );

  it(
    "treats blank/whitespace seniority and focus-note as the empty placeholder, " +
      "so all-blank vs all-blank does not flag those rows",
    () => {
      const runA = makeRun({
        id: 1,
        stats: fullStats(10),
        saved: 1,
        variantCriteria: {
          seniority: "   ",
          mustHaveSkills: [],
          focusNote: "",
        },
      });
      const runB = makeRun({
        id: 2,
        stats: fullStats(10),
        saved: 1,
        variantCriteria: {
          seniority: "",
          mustHaveSkills: [],
          focusNote: "   ",
        },
      });
      render(<CompareRuns runs={[runA, runB]} jobId={1} />);

      expect(rowFor("Seniority").className).not.toMatch(/bg-amber/);
      expect(rowFor("Must-have skills").className).not.toMatch(/bg-amber/);
      expect(rowFor("Focus note").className).not.toMatch(/bg-amber/);
    },
  );

  it(
    "does not flag identical standard config rows (label, data mode, " +
      "sourcing enabled, variant of) when both runs share that config",
    () => {
      const runA = makeRun({
        id: 1,
        stats: fullStats(10),
        saved: 1,
        variantCriteria: {
          seniority: "senior",
          mustHaveSkills: ["go"],
          focusNote: "x",
        },
      });
      const runB = makeRun({
        id: 2,
        stats: fullStats(10),
        saved: 1,
        variantCriteria: {
          seniority: "senior",
          mustHaveSkills: ["go"],
          focusNote: "x",
        },
      });
      render(<CompareRuns runs={[runA, runB]} jobId={1} />);

      for (const label of [
        "Label",
        "Data mode",
        "Sourcing enabled",
        "Variant of",
        "Seniority",
        "Must-have skills",
        "Focus note",
      ]) {
        expect(
          rowFor(label).className,
          `${label}: identical config should not be flagged`,
        ).not.toMatch(/bg-amber/);
      }
    },
  );

  it(
    "flags the standard config rows that differ (label, variantOf) " +
      "when one run is a baseline and the other is a labelled variant",
    () => {
      const baseline = makeRun({
        id: 1,
        stats: fullStats(10),
        saved: 1,
        variantOf: null,
        variantLabel: null,
        variantCriteria: {
          seniority: "senior",
          mustHaveSkills: ["go"],
          focusNote: "x",
        },
      });
      const variant = makeRun({
        id: 2,
        stats: fullStats(10),
        saved: 1,
        variantOf: 1,
        variantLabel: "Skill-tightened",
        variantCriteria: {
          seniority: "senior",
          mustHaveSkills: ["go"],
          focusNote: "x",
        },
      });
      render(<CompareRuns runs={[baseline, variant]} jobId={1} />);

      // "Baseline" vs "Skill-tightened" → flagged.
      expect(rowFor("Label").className).toMatch(/bg-amber/);
      // null vs #1 → flagged.
      expect(rowFor("Variant of").className).toMatch(/bg-amber/);
      // unchanged config rows stay un-flagged.
      expect(rowFor("Data mode").className).not.toMatch(/bg-amber/);
      expect(rowFor("Sourcing enabled").className).not.toMatch(/bg-amber/);
      // unchanged variant criteria stay un-flagged.
      expect(rowFor("Seniority").className).not.toMatch(/bg-amber/);
      expect(rowFor("Must-have skills").className).not.toMatch(/bg-amber/);
      expect(rowFor("Focus note").className).not.toMatch(/bg-amber/);
    },
  );
});

describe("CompareRuns - Save / load / delete saved comparisons", () => {
  it(
    "calls the create endpoint with the current A/B/C IDs when the user " +
      "names and confirms a new saved comparison",
    async () => {
      const user = userEvent.setup();
      const runs = [
        makeRun({ id: 1, stats: fullStats(10), saved: 1 }),
        makeRun({ id: 2, stats: fullStats(10), saved: 1 }),
        makeRun({ id: 3, stats: fullStats(10), saved: 1 }),
      ];
      renderWithRouter(
        <CompareRuns runs={runs} jobId={42} />,
        "/?compareA=1&compareB=2&compareC=3",
      );

      await user.click(screen.getByTestId("button-save-comparison"));
      const input = await screen.findByTestId("input-comparison-name");
      await user.type(input, "Q3 baseline vs loosened filters");
      await user.click(screen.getByTestId("button-confirm-save-comparison"));

      expect(createMutate).toHaveBeenCalledTimes(1);
      const [vars] = createMutate.mock.calls[0];
      expect(vars).toEqual({
        jobId: 42,
        data: {
          name: "Q3 baseline vs loosened filters",
          runAId: 1,
          runBId: 2,
          runCId: 3,
        },
      });
    },
  );

  it(
    "loads a saved comparison by rewriting compareA / compareB / compareC " +
      "URL params when the user clicks its chip",
    async () => {
      const user = userEvent.setup();
      const runs = [
        makeRun({ id: 1, stats: fullStats(10), saved: 1 }),
        makeRun({ id: 2, stats: fullStats(10), saved: 1 }),
        makeRun({ id: 3, stats: fullStats(10), saved: 1 }),
      ];
      savedState.list = [
        {
          id: 99,
          jobId: 42,
          name: "Loaded setup",
          runAId: 2,
          runBId: 3,
          runCId: null,
          createdAt: new Date().toISOString(),
        },
      ];
      const { loc } = renderWithRouter(
        <CompareRuns runs={runs} jobId={42} />,
        "/?compareA=1&compareB=2&compareC=3",
      );

      await user.click(screen.getByTestId("button-load-comparison-99"));

      // memoryLocation records every navigate; the most recent entry is the
      // one triggered by clicking the saved chip. wouter writes "?a=b" on
      // top of "/" so the recorded path looks like "/?compareA=...".
      const last = loc.history?.[loc.history.length - 1] ?? "";
      const search = last.includes("?") ? last.split("?")[1] : "";
      const params = new URLSearchParams(search);
      expect(params.get("compareA")).toBe("2");
      expect(params.get("compareB")).toBe("3");
      // runCId was null, so compareC must NOT be present.
      expect(params.has("compareC")).toBe(false);
    },
  );

  it(
    "removes a saved comparison from the list when the user clicks its " +
      "trash icon (delete endpoint called with jobId + comparisonId)",
    async () => {
      const user = userEvent.setup();
      const runs = [
        makeRun({ id: 1, stats: fullStats(10), saved: 1 }),
        makeRun({ id: 2, stats: fullStats(10), saved: 1 }),
      ];
      savedState.list = [
        {
          id: 7,
          jobId: 42,
          name: "Will be deleted",
          runAId: 1,
          runBId: 2,
          runCId: null,
          createdAt: new Date().toISOString(),
        },
      ];
      const { rerender } = renderWithRouter(
        <CompareRuns runs={runs} jobId={42} />,
        "/?compareA=1&compareB=2",
      );

      expect(screen.getByTestId("saved-comparison-7")).toBeInTheDocument();

      await user.click(screen.getByTestId("button-delete-comparison-7"));

      expect(deleteMutate).toHaveBeenCalledTimes(1);
      expect(deleteMutate.mock.calls[0][0]).toEqual({
        jobId: 42,
        comparisonId: 7,
      });

      // Simulate the cache invalidation refetch returning an empty list — the
      // chip should disappear from the rendered list.
      savedState.list = [];
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <Router hook={memoryLocation({ path: "/?compareA=1&compareB=2" }).hook}>
            <CompareRuns runs={runs} jobId={42} />
          </Router>
        </QueryClientProvider>,
      );

      expect(screen.queryByTestId("saved-comparison-7")).not.toBeInTheDocument();
    },
  );

  it(
    "renders a saved comparison referencing a missing run as disabled / " +
      "strikethrough and refuses to load it",
    async () => {
      const user = userEvent.setup();
      const runs = [
        makeRun({ id: 1, stats: fullStats(10), saved: 1 }),
        makeRun({ id: 2, stats: fullStats(10), saved: 1 }),
      ];
      savedState.list = [
        {
          id: 55,
          jobId: 42,
          name: "Stale setup",
          runAId: 1,
          runBId: 999, // does not exist in `runs`
          runCId: null,
          createdAt: new Date().toISOString(),
        },
      ];
      const { loc } = renderWithRouter(
        <CompareRuns runs={runs} jobId={42} />,
        "/?compareA=1&compareB=2",
      );

      const loadBtn = screen.getByTestId(
        "button-load-comparison-55",
      ) as HTMLButtonElement;

      // Disabled visually (strikethrough) AND functionally.
      expect(loadBtn.disabled).toBe(true);
      expect(loadBtn.className).toMatch(/line-through/);
      expect(loadBtn.title).toMatch(/no longer exist/i);

      const beforeLen = loc.history?.length ?? 0;
      await user.click(loadBtn);
      // Disabled buttons should not navigate — history must not grow.
      expect(loc.history?.length ?? 0).toBe(beforeLen);
    },
  );
});
