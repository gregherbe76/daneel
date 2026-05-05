import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mock the generated API hooks the job detail page uses ────────────────
// The pipeline filter under test only depends on the applications list, so
// we feed a small fixture there and stub everything else with idle defaults
// so the page renders without crashing.
const mockApplications = vi.hoisted(() => [
  {
    id: 11,
    stage: "Sourced",
    candidate: {
      id: 1,
      name: "Alice",
      email: "alice@example.com",
      emailSource: "profile",
      emailValidationStatus: "valid",
      emailValidationReason: null,
      headline: null,
      location: null,
      currentCompany: null,
      githubUrl: null,
      linkedIn: null,
      summary: null,
      skills: [],
      source: null,
    },
    aiEvaluation: null,
  },
  {
    id: 12,
    stage: "Sourced",
    candidate: {
      id: 2,
      name: "Bob",
      email: "bob@example.com",
      emailSource: "manual",
      emailValidationStatus: "valid",
      emailValidationReason: null,
      headline: null,
      location: null,
      currentCompany: null,
      githubUrl: null,
      linkedIn: null,
      summary: null,
      skills: [],
      source: null,
    },
    aiEvaluation: null,
  },
]);

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
    useGetJob: () =>
      idleQuery({
        id: 1,
        title: "Senior Engineer",
        description: "",
        location: null,
        seniority: null,
        mustHaveSkills: [],
        hasRealSourcingProvider: false,
      }),
    useGetJobApplications: () => idleQuery(mockApplications),
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

// Stub heavy children that have their own hook chains and aren't relevant
// to this test.
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

const STORAGE_KEY = "recruiting-os:email-source-filter";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderJobAt(initialPath: string) {
  const loc = memoryLocation({ path: initialPath, record: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { default: JobDetailPage } = await import("./detail");
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={loc.hook}>
        <JobDetailPage />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, loc };
}

function currentSearch(loc: ReturnType<typeof memoryLocation>): string {
  const path = loc.history[loc.history.length - 1] ?? "";
  const idx = path.indexOf("?");
  return idx === -1 ? "" : path.slice(idx + 1);
}

describe("JobDetailPage pipeline — remembered email source filter", () => {
  it("restores the saved selection on a fresh visit to a job's pipeline", async () => {
    window.localStorage.setItem(STORAGE_KEY, "profile,manual");
    const { loc } = await renderJobAt("/jobs/1");

    await waitFor(() => {
      expect(currentSearch(loc)).toContain("emailSource=");
    });
    const params = new URLSearchParams(currentSearch(loc));
    const restored = (params.get("emailSource") ?? "").split(",").sort();
    expect(restored).toEqual(["manual", "profile"]);
  });

  it("an explicit ?emailSource= URL beats the saved value (no overwrite)", async () => {
    window.localStorage.setItem(STORAGE_KEY, "profile,manual");
    const { loc } = await renderJobAt("/jobs/1?emailSource=commit");

    // Wait until the source filter trigger is on screen — proof the page
    // mounted and useEffect mount-restoration had a chance to run.
    await screen.findByRole("button", { name: /email source/i });
    await waitFor(() => {
      const params = new URLSearchParams(currentSearch(loc));
      expect(params.get("emailSource")).toBe("commit");
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("profile,manual");
  });

  it(
    "clearing all source chips on the pipeline removes the saved preference " +
      "(no resurrection on next visit)",
    async () => {
      window.localStorage.setItem(STORAGE_KEY, "profile");
      const first = await renderJobAt("/jobs/1");

      await waitFor(() => {
        const params = new URLSearchParams(currentSearch(first.loc));
        expect(params.get("emailSource")).toBe("profile");
      });

      // Open the source filter dropdown and click "Clear filter".
      await userEvent.click(
        screen.getByRole("button", { name: /email source/i }),
      );
      const clearItem = await screen.findByRole("button", {
        name: /clear filter/i,
      });
      await userEvent.click(clearItem);

      await waitFor(() => {
        const params = new URLSearchParams(currentSearch(first.loc));
        expect(params.get("emailSource")).toBeNull();
      });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

      first.unmount();
      const second = await renderJobAt("/jobs/1");
      await screen.findByRole("button", { name: /email source/i });
      await waitFor(() => {
        const params = new URLSearchParams(currentSearch(second.loc));
        expect(params.get("emailSource")).toBeNull();
      });
    },
  );
});
