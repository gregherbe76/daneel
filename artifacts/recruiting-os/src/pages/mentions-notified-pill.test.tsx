import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Regression = {
  id: number;
  candidateId: number;
  candidateName: string;
  candidateEmail: string | null;
  previousStatus: string;
  newStatus: string;
  previousReason: string | null;
  newReason: string | null;
  changedAt: string;
  notifiedAt: string | null;
  notificationSentAt: string | null;
};

const state = vi.hoisted(() => ({
  regressions: [] as Regression[],
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
    useListTeamMembers: () =>
      idleQuery([{ id: "alex", name: "Alex Recruiter", role: "Recruiter" }]),
    useListMentionsForMember: () => idleQuery([]),
    useListEmailStatusChanges: () => idleQuery(state.regressions),
    useMarkEmailStatusChangeRead: () => idleMutation(),
    useMarkAllEmailStatusChangesRead: () => idleMutation(),
    getListEmailStatusChangesQueryKey: () => ["email-status-changes"],
  };
});

afterEach(() => {
  state.regressions = [];
  vi.clearAllMocks();
});

function makeRegression(overrides: Partial<Regression> = {}): Regression {
  return {
    id: 1,
    candidateId: 42,
    candidateName: "Alice Example",
    candidateEmail: "alice@example.com",
    previousStatus: "valid",
    newStatus: "invalid",
    previousReason: "smtp ok",
    newReason: "mailbox bounced",
    changedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    notifiedAt: null,
    notificationSentAt: null,
    ...overrides,
  };
}

async function renderMentionsPage() {
  const loc = memoryLocation({ path: "/mentions", record: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { default: MentionsPage } = await import("./mentions");
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={loc.hook}>
        <MentionsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("MentionsPage — 'Notified <time>' pill on email regressions", () => {
  it("renders the pill on a regression row when notificationSentAt is set", async () => {
    state.regressions = [
      makeRegression({
        id: 7,
        notificationSentAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      }),
    ];

    await renderMentionsPage();

    const pill = await screen.findByTestId("regression-notified-7");
    expect(pill).toBeDefined();
    expect(pill.textContent ?? "").toMatch(/Notified/i);
  });

  it("does not render the pill when notificationSentAt is null", async () => {
    state.regressions = [
      makeRegression({ id: 8, notificationSentAt: null }),
    ];

    await renderMentionsPage();

    // The regressions list itself must still render so we know the row was shown
    // (and the pill's absence isn't just because the whole section was hidden).
    expect(await screen.findByTestId("email-regressions-list")).toBeDefined();
    expect(screen.queryByTestId("regression-notified-8")).toBeNull();
  });

  it(
    "renders the pill only on rows whose notificationSentAt is set when multiple regressions are listed",
    async () => {
      state.regressions = [
        makeRegression({
          id: 100,
          candidateId: 1,
          candidateName: "Notified One",
          notificationSentAt: new Date(
            Date.now() - 10 * 60 * 1000,
          ).toISOString(),
        }),
        makeRegression({
          id: 101,
          candidateId: 2,
          candidateName: "Silent Two",
          notificationSentAt: null,
        }),
      ];

      await renderMentionsPage();

      expect(await screen.findByTestId("regression-notified-100")).toBeDefined();
      expect(screen.queryByTestId("regression-notified-101")).toBeNull();
    },
  );
});
