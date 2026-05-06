import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Per-test mutable state for the mocked API hooks. We flip the latest workflow
// + run list to exercise the Apify sourcing-stats render path on the Workflow
// tab of the job detail page.
const state = vi.hoisted(() => ({
  job: null as unknown,
  workflow: null as unknown,
  runs: [] as unknown[],
}));

vi.mock("@workspace/api-client-react", () => {
  const idleQuery = (data: unknown) => ({
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
    useListJobs: () => idleQuery([state.job]),
    useGetJob: () => idleQuery(state.job),
    useGetJobApplications: () => idleQuery([]),
    useGetLatestJobWorkflow: () => idleQuery(state.workflow),
    useListJobRuns: () => idleQuery(state.runs),
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
  state.job = null;
  state.workflow = null;
  state.runs = [];
  vi.clearAllMocks();
});

async function renderJobDetailWorkflowTab() {
  const loc = memoryLocation({ path: "/jobs/1?tab=workflow", record: true });
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

describe("Job detail — Workflow tab sourcing stats", () => {
  it("renders the four Apify counts (search hits, extracted, returned, dropped) and labels the provider", async () => {
    state.job = {
      id: 1,
      title: "Senior Engineer",
      description: "",
      location: "Remote",
      seniority: "Senior",
      mustHaveSkills: [],
      hasRealSourcingProvider: true,
    };
    state.workflow = {
      run: {
        id: 42,
        jobId: 1,
        status: "completed",
        dataMode: "real",
        runSourcing: true,
        createdAt: new Date().toISOString(),
      },
      logs: [
        {
          step: "sourcing",
          status: "completed",
          output: {
            generated: 3,
            saved: 3,
            providerName: "Apify",
            providerType: "apify",
            stats: {
              searchTotalCount: 20,
              consideredCount: 18,
              extractedCount: 7,
              returnedCount: 3,
              droppedNoProfile: 2,
              droppedFabricated: 1,
            },
          },
        },
      ],
      shortlist: null,
      insight: null,
      evaluations: [],
      candidates: [],
    };
    state.runs = [state.workflow.run];

    await renderJobDetailWorkflowTab();

    // Provider label
    expect(
      (await screen.findByTestId("sourcing-provider-name")).textContent ?? "",
    ).toContain("Apify");

    // The four Apify-relevant counts must all be visible.
    expect(screen.getByText(/20 search hits/i)).toBeDefined();
    expect(screen.getByText(/7 extracted/i)).toBeDefined();
    expect(screen.getByText(/3 returned/i)).toBeDefined();
    expect(screen.getByText(/2 dropped: no profile URL/i)).toBeDefined();
    expect(screen.getByText(/1 dropped: fabricated/i)).toBeDefined();
  });

  it("labels past sourcing runs with the provider name from the persisted log", async () => {
    state.job = {
      id: 1,
      title: "Senior Engineer",
      description: "",
      location: "Remote",
      seniority: "Senior",
      mustHaveSkills: [],
      hasRealSourcingProvider: true,
    };
    const latest = {
      id: 99,
      jobId: 1,
      status: "completed",
      dataMode: "real",
      runSourcing: true,
      createdAt: new Date().toISOString(),
    };
    const past = {
      id: 50,
      jobId: 1,
      status: "completed",
      dataMode: "real",
      runSourcing: true,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      sourcingStatus: "completed",
      sourcingSaved: 2,
      sourcingProviderName: "Apify",
      sourcingProviderType: "apify",
      sourcingStats: {
        searchTotalCount: 12,
        consideredCount: 12,
        extractedCount: 4,
        returnedCount: 2,
        droppedNoProfile: 1,
        droppedFabricated: 1,
      },
    };
    state.workflow = { run: latest, logs: [], shortlist: null, insight: null, evaluations: [], candidates: [] };
    state.runs = [latest, past];

    await renderJobDetailWorkflowTab();

    const label = await screen.findByTestId("past-sourcing-provider-50");
    expect(label.textContent ?? "").toContain("Apify");
  });
});
