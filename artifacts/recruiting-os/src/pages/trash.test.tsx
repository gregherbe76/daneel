import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mutable in-memory trash store driving the mocked hooks ───────────────
type TrashRow = {
  id: number;
  name: string;
  email: string | null;
  headline: string | null;
  location: string | null;
  currentCompany: string | null;
  source: string | null;
  deletedAt: string;
  deletionBatchId: string | null;
  batchSize: number;
  daysRemaining: number;
};

const STATE = vi.hoisted(() => ({
  rows: [] as Array<{
    id: number;
    name: string;
    email: string | null;
    headline: string | null;
    location: string | null;
    currentCompany: string | null;
    source: string | null;
    deletedAt: string;
    deletionBatchId: string | null;
    daysRemaining: number;
  }>,
  retentionDays: 7,
  listeners: new Set<() => void>(),
  notify(): void {
    for (const l of Array.from(this.listeners)) l();
  },
}));

function snapshot(): { items: TrashRow[]; retentionDays: number } {
  // Re-derive batchSize on every read so additions / removals stay in sync.
  const counts = new Map<string, number>();
  for (const r of STATE.rows) {
    if (r.deletionBatchId) {
      counts.set(r.deletionBatchId, (counts.get(r.deletionBatchId) ?? 0) + 1);
    }
  }
  return {
    retentionDays: STATE.retentionDays,
    items: STATE.rows.map((r) => ({
      ...r,
      batchSize: r.deletionBatchId ? (counts.get(r.deletionBatchId) ?? 1) : 1,
    })),
  };
}

vi.mock("@workspace/api-client-react", () => {
  function useTrashStore() {
    const [, force] = useState(0);
    useEffect(() => {
      const l = () => force((n) => n + 1);
      STATE.listeners.add(l);
      return () => {
        STATE.listeners.delete(l);
      };
    }, []);
    return snapshot();
  }
  return {
    useListTrashedCandidates: () => {
      const data = useTrashStore();
      return { data, isLoading: false, error: null, refetch: vi.fn() };
    },
    useRestoreCandidatesByIds: () => ({
      mutateAsync: vi.fn(async ({ data }: { data: { ids: number[] } }) => {
        const ids = new Set(data.ids);
        const before = STATE.rows.length;
        STATE.rows = STATE.rows.filter((r) => !ids.has(r.id));
        const restored = before - STATE.rows.length;
        STATE.notify();
        return { ok: true, restored };
      }),
      isPending: false,
    }),
    useEmptyCandidateTrash: () => ({
      mutateAsync: vi.fn(async () => {
        const purged = STATE.rows.length;
        STATE.rows = [];
        STATE.notify();
        return { ok: true, purged };
      }),
      isPending: false,
    }),
    getListTrashedCandidatesQueryKey: () => ["/api/candidates/trash"],
    getListCandidatesQueryKey: () => ["/api/candidates"],
  };
});

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import TrashPage from "./trash";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memoryLocation({ path: "/trash" }).hook}>
        <TrashPage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  STATE.rows = [
    {
      id: 1,
      name: "Alice Anderson",
      email: "alice@example.com",
      headline: "Engineer",
      location: null,
      currentCompany: null,
      source: null,
      deletedAt: new Date().toISOString(),
      deletionBatchId: "batch-bulk",
      daysRemaining: 6,
    },
    {
      id: 2,
      name: "Bob Brown",
      email: "bob@example.com",
      headline: null,
      location: null,
      currentCompany: null,
      source: null,
      deletedAt: new Date().toISOString(),
      deletionBatchId: "batch-bulk",
      daysRemaining: 6,
    },
    {
      id: 3,
      name: "Solo Sam",
      email: "sam@example.com",
      headline: null,
      location: null,
      currentCompany: null,
      source: null,
      deletedAt: new Date().toISOString(),
      deletionBatchId: "batch-solo",
      daysRemaining: 6,
    },
  ];
  toastSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TrashPage", () => {
  it("renders one batch group per deletionBatchId with the row count", () => {
    renderPage();

    // The two-row bulk batch is grouped together…
    const bulk = screen.getByTestId("trash-batch-batch-bulk");
    expect(within(bulk).getByText(/2 candidates/i)).toBeInTheDocument();
    expect(within(bulk).getByTestId("trash-row-1")).toBeInTheDocument();
    expect(within(bulk).getByTestId("trash-row-2")).toBeInTheDocument();

    // …and the single-row delete renders as its own group with no batch CTA.
    const solo = screen.getByTestId("trash-batch-batch-solo");
    expect(within(solo).getByTestId("trash-row-3")).toBeInTheDocument();
    expect(
      within(solo).queryByTestId("restore-batch-batch-solo"),
    ).not.toBeInTheDocument();
  });

  it("per-row Restore removes the candidate from the visible trash list", async () => {
    renderPage();

    expect(screen.getByTestId("trash-row-1")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("restore-1"));

    await waitFor(() =>
      expect(screen.queryByTestId("trash-row-1")).not.toBeInTheDocument(),
    );
    // The other rows in the same batch are untouched.
    expect(screen.getByTestId("trash-row-2")).toBeInTheDocument();
    expect(screen.getByTestId("trash-row-3")).toBeInTheDocument();
    // The user got a confirmation toast naming the candidate they restored.
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/Alice Anderson/) }),
    );
  });

  it("Restore batch removes every row in that batch in one click", async () => {
    renderPage();

    await userEvent.click(screen.getByTestId("restore-batch-batch-bulk"));

    await waitFor(() => {
      expect(screen.queryByTestId("trash-row-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("trash-row-2")).not.toBeInTheDocument();
    });
    // The unrelated solo batch stays in the trash.
    expect(screen.getByTestId("trash-row-3")).toBeInTheDocument();
  });

  it("Empty trash requires typing EMPTY before the destructive action enables", async () => {
    renderPage();

    await userEvent.click(screen.getByTestId("empty-trash"));

    const confirmBtn = await screen.findByTestId("empty-trash-confirm");
    // Confirm button is disabled until the magic word is typed.
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByTestId("empty-trash-confirm-input");
    await userEvent.type(input, "nope");
    expect(confirmBtn).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, "EMPTY");
    expect(confirmBtn).toBeEnabled();

    await userEvent.click(confirmBtn);

    // Every row vanishes; the dialog closes; the empty-state copy renders.
    await waitFor(() => {
      expect(screen.queryByTestId("trash-row-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("trash-row-2")).not.toBeInTheDocument();
      expect(screen.queryByTestId("trash-row-3")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/trash is empty/i)).toBeInTheDocument();
    // And the user got a confirmation toast counting the purged rows.
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/Permanently deleted 3 candidates/),
      }),
    );
  });
});
