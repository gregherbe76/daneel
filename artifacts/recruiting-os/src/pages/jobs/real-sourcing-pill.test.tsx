import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mock the generated API hooks both the jobs list and job detail page use.
// `mockJobs` is mutated per-test before mounting so we can flip the
// `hasRealSourcingProvider` flag and assert the resulting pill.
const state = vi.hoisted(() => ({
  jobs: [] as Array<{
    id: number;
    title: string;
    location: string | null;
    seniority: string | null;
    description: string;
    mustHaveSkills: string[];
    hasRealSourcingProvider: boolean;
  }>,
}));

vi.mock("@workspace/api-client-react", () => {
  const idleQuery = (data: unknown = undefined) => ({
    data,
    isLoading: false,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
  });
  const idleMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isLoading: false,
    reset: vi.fn(),
  });
  return {
    ApplicationStage: {
      Sourced: "Sourced",
      Screened: "Screened",
      Interviewing: "Interviewing",
      Offer: "Offer",
      Hired: "Hired",
      Rejected: "Rejected",
    },
    useListJobs: () => idleQuery(state.jobs),
    useGetJob: () => idleQuery(state.jobs[0]),
    useGetJobApplications: () => idleQuery([]),
    useGetLatestJobWorkflow: () => idleQuery(null),
    useListJobRuns: () => idleQuery([]),
    useListProviderStepSettings: () => idleQuery([]),
    usePreviewGithubQuery: () => idleMutation(),
    useUpdateApplication: () => idleMutation(),
    useRunWorkflow: () => idleMutation(),
    useRunVariantWorkflow: () => idleMutation(),
    useImproveAndRerun: () => idleMutation(),
    getGetJobApplicationsQueryKey: () => ["apps"],
    getGetLatestJobWorkflowQueryKey: () => ["wf"],
    getListJobRunsQueryKey: () => ["runs"],
  };
});

// Stub heavy children — the pill lives in the page header / list card and
// has no dependency on these.
vi.mock("@/lib/pending-runs", () => ({
  useUnseenRunsByJob: () => new Map(),
  usePendingImproveRuns: () => [],
  addPendingImproveRun: vi.fn(),
  removePendingImproveRun: vi.fn(),
  addUnseenJobRun: vi.fn(),
  markJobRunsSeen: vi.fn(),
  PendingRunsWatcher: () => null,
}));
vi.mock("@/components/import-candidates-modal", () => ({
  ImportCandidatesModal: () => null,
}));
vi.mock("@/components/find-candidates-modal", () => ({
  FindCandidatesModal: () => null,
}));
vi.mock("@/components/improve-rerun-modal", () => ({
  ImproveRerunModal: () => null,
}));
vi.mock("@/components/run-variant-modal", () => ({
  RunVariantModal: () => null,
}));
vi.mock("@/components/compare-runs", () => ({
  CompareRuns: () => null,
}));
vi.mock("@/components/onboarding-wizard", () => ({
  OnboardingWizard: () => null,
}));
vi.mock("@/components/bulk-action-bar", () => ({
  BulkActionBar: () => null,
}));
vi.mock("@/components/candidate-notes-indicator", () => ({
  CandidateNotesIndicator: () => null,
}));

afterEach(() => {
  state.jobs = [];
  vi.clearAllMocks();
});

function makeJob(overrides: Partial<(typeof state.jobs)[number]> = {}) {
  return {
    id: 1,
    title: "Senior Engineer",
    description: "",
    location: "Remote",
    seniority: "Senior",
    mustHaveSkills: [],
    hasRealSourcingProvider: false,
    ...overrides,
  };
}

async function renderJobsListAt(initialPath: string) {
  const loc = memoryLocation({ path: initialPath, record: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { default: JobsPage } = await import("./index");
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={loc.hook}>
        <Switch>
          <Route path="/jobs" component={JobsPage} />
          <Route path="/jobs/:id">
            {(params) => (
              <div data-testid="job-detail-stub">job-detail:{params.id}</div>
            )}
          </Route>
          <Route path="/settings/marketplace">
            <div data-testid="marketplace-stub">marketplace</div>
          </Route>
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, location: loc };
}

async function renderJobDetailAt(initialPath: string) {
  const loc = memoryLocation({ path: initialPath, record: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { default: JobDetailPage } = await import("./detail");
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={loc.hook}>
        <JobDetailPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("JobsPage — Real sourcing ready / Demo mode pill", () => {
  it("renders the green 'Real sourcing ready' pill when hasRealSourcingProvider is true", async () => {
    state.jobs = [makeJob({ hasRealSourcingProvider: true })];
    await renderJobsListAt("/jobs");

    const pill = await screen.findByText("Real sourcing ready");
    expect(pill).toBeDefined();
    expect(screen.queryByText("Demo mode")).toBeNull();

    // Visual affordance: the green ready pill should carry the green-tinted
    // background class so a future refactor can't silently drop the styling.
    const badge = pill.closest("div, span");
    expect(badge?.className ?? "").toContain("green");
  });

  it("renders the muted 'Demo mode' pill when hasRealSourcingProvider is false", async () => {
    state.jobs = [makeJob({ hasRealSourcingProvider: false })];
    await renderJobsListAt("/jobs");

    expect(await screen.findByText("Demo mode")).toBeDefined();
    expect(screen.queryByText("Real sourcing ready")).toBeNull();
  });

  it("opens an explanatory popover with a Marketplace CTA when the Demo mode pill is clicked, without navigating to the job", async () => {
    state.jobs = [makeJob({ id: 7, hasRealSourcingProvider: false })];
    const { location } = await renderJobsListAt("/jobs");

    const trigger = await screen.findByTestId("real-sourcing-pill-demo");
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(trigger);

    // Critical: clicking the pill must NOT bubble up to the parent <Link>
    // wrapping the job card, otherwise the popover is unreachable.
    expect(location.history[location.history.length - 1]).toBe("/jobs");
    expect(screen.queryByTestId("job-detail-stub")).toBeNull();

    const popover = await screen.findByTestId(
      "real-sourcing-pill-demo-popover",
    );
    expect(popover.textContent ?? "").toContain("Demo mode");
    expect(popover.textContent ?? "").toContain("No real sourcing provider");

    const cta = await screen.findByTestId("real-sourcing-pill-demo-cta");
    expect(cta.getAttribute("href")).toBe("/settings/marketplace");
    expect(cta.textContent ?? "").toContain("Configure real sourcing");
  });
});

describe("JobDetailPage header — Real sourcing ready / Demo mode pill", () => {
  it("renders the green 'Real sourcing ready' pill in the header when hasRealSourcingProvider is true", async () => {
    state.jobs = [makeJob({ id: 1, hasRealSourcingProvider: true })];
    await renderJobDetailAt("/jobs/1");

    const pill = await screen.findByText("Real sourcing ready");
    expect(pill).toBeDefined();
    expect(screen.queryByText("Demo mode")).toBeNull();
    const badge = pill.closest("div, span");
    expect(badge?.className ?? "").toContain("green");
  });

  it("renders the muted 'Demo mode' pill in the header when hasRealSourcingProvider is false", async () => {
    state.jobs = [makeJob({ id: 1, hasRealSourcingProvider: false })];
    await renderJobDetailAt("/jobs/1");

    expect(await screen.findByText("Demo mode")).toBeDefined();
    expect(screen.queryByText("Real sourcing ready")).toBeNull();
  });
});
