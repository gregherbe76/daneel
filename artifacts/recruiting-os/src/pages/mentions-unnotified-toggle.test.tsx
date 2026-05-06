import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  allRegressions: [] as Regression[],
  listSpy: vi.fn(),
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
    useListEmailStatusChanges: (params: {
      unread?: boolean;
      unnotified?: boolean;
      limit?: number;
    }) => {
      state.listSpy(params);
      const filtered = params?.unnotified
        ? state.allRegressions.filter((r) => r.notificationSentAt === null)
        : state.allRegressions;
      return idleQuery(filtered);
    },
    useMarkEmailStatusChangeRead: () => idleMutation(),
    useMarkAllEmailStatusChangesRead: () => idleMutation(),
    getListEmailStatusChangesQueryKey: (params: unknown) => [
      "/api/email-status-changes",
      params,
    ],
  };
});

afterEach(() => {
  state.allRegressions = [];
  state.listSpy.mockClear();
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

describe("MentionsPage — 'Show un-notified only' toggle", () => {
  it("starts off: requests without unnotified param and shows both rows", async () => {
    state.allRegressions = [
      makeRegression({
        id: 200,
        candidateName: "Silent Sue",
        notificationSentAt: null,
      }),
      makeRegression({
        id: 201,
        candidateName: "Notified Ned",
        notificationSentAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      }),
    ];

    await renderMentionsPage();

    expect(await screen.findByTestId("toggle-unnotified-only")).toBeDefined();
    // Both rows visible initially.
    expect(screen.getByText("Silent Sue")).toBeDefined();
    expect(screen.getByText("Notified Ned")).toBeDefined();

    // Hook was called at least once and never with unnotified=true so far.
    expect(state.listSpy).toHaveBeenCalled();
    for (const call of state.listSpy.mock.calls) {
      expect(call[0]?.unnotified).toBeUndefined();
    }
  });

  it("toggling sends unnotified=true to the hook and hides already-notified rows", async () => {
    state.allRegressions = [
      makeRegression({
        id: 300,
        candidateName: "Silent Sue",
        notificationSentAt: null,
      }),
      makeRegression({
        id: 301,
        candidateName: "Notified Ned",
        notificationSentAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      }),
    ];

    await renderMentionsPage();

    const toggle = await screen.findByTestId("toggle-unnotified-only");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);

    // Hook gets re-called with unnotified=true after the toggle flips.
    await waitFor(() => {
      const sawUnnotified = state.listSpy.mock.calls.some(
        (call) => call[0]?.unnotified === true,
      );
      expect(sawUnnotified).toBe(true);
    });

    // List re-renders with the notified row filtered away.
    await waitFor(() => {
      expect(screen.queryByText("Notified Ned")).toBeNull();
    });
    expect(screen.getByText("Silent Sue")).toBeDefined();

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.textContent ?? "").toMatch(/Showing un-notified only/i);
  });

  it("toggling off removes the param and brings back the empty-state copy when nothing matches", async () => {
    // Only notified rows exist — filtering hides everything, toggling off
    // brings them back.
    state.allRegressions = [
      makeRegression({
        id: 400,
        candidateName: "Notified Ned",
        notificationSentAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      }),
    ];

    await renderMentionsPage();
    const toggle = await screen.findByTestId("toggle-unnotified-only");

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.queryByText("Notified Ned")).toBeNull();
    });
    // Filtered empty-state copy appears.
    expect(
      screen.getByText(
        /No un-notified email regressions\. Everything has already been pinged externally\./i,
      ),
    ).toBeDefined();

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByText("Notified Ned")).toBeDefined();
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    // The most recent call must drop the unnotified param.
    const lastCall = state.listSpy.mock.calls.at(-1);
    expect(lastCall?.[0]?.unnotified).toBeUndefined();
  });
});
