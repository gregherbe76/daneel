import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mutable in-memory backing store driving the mocked hooks ─────────────
type Settings = { retentionDays: number; updatedAt: string };

const STATE = vi.hoisted(() => ({
  current: { retentionDays: 7, updatedAt: new Date().toISOString() } as Settings,
  isLoading: false as boolean,
  loadError: null as Error | null,
  updateCalls: [] as Array<{ retentionDays: number }>,
  nextUpdateError: null as Error | null,
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetBulkJobsSettings: () => ({
    data: STATE.isLoading ? undefined : STATE.current,
    isLoading: STATE.isLoading,
    error: STATE.loadError,
  }),
  useUpdateBulkJobsSettings: () => ({
    mutateAsync: async ({
      data,
    }: {
      data: { retentionDays: number };
    }) => {
      if (STATE.nextUpdateError) throw STATE.nextUpdateError;
      STATE.updateCalls.push(data);
      STATE.current = {
        retentionDays: data.retentionDays,
        updatedAt: new Date().toISOString(),
      };
      return STATE.current;
    },
    isPending: false,
  }),
  getGetBulkJobsSettingsQueryKey: () => ["bulk-jobs-settings"],
}));

const BulkJobsSettingsPage = (await import("./bulk-jobs")).default;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memoryLocation({ path: "/settings/bulk-jobs" }).hook}>
        <BulkJobsSettingsPage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  toastMock.mockReset();
  STATE.current = { retentionDays: 7, updatedAt: new Date().toISOString() };
  STATE.isLoading = false;
  STATE.loadError = null;
  STATE.updateCalls = [];
  STATE.nextUpdateError = null;
});

describe("BulkJobsSettingsPage", () => {
  it("renders the input pre-filled with the current retentionDays from the API", () => {
    STATE.current = { retentionDays: 21, updatedAt: new Date().toISOString() };
    renderPage();

    const input = screen.getByTestId(
      "input-bulk-jobs-retention-days",
    ) as HTMLInputElement;
    expect(input.value).toBe("21");
    // Save is disabled until the form is dirty — guards against double-saves.
    expect(screen.getByTestId("button-bulk-jobs-save")).toBeDisabled();
  });

  it("rejects values below the 1-day floor with a destructive toast", async () => {
    renderPage();

    const input = screen.getByTestId("input-bulk-jobs-retention-days");
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await userEvent.click(screen.getByTestId("button-bulk-jobs-save"));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: expect.stringMatching(/Invalid retention/i),
      variant: "destructive",
    });
    // The mutation is short-circuited before any network call.
    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("rejects values above the 365-day ceiling with a destructive toast", async () => {
    renderPage();

    const input = screen.getByTestId("input-bulk-jobs-retention-days");
    await userEvent.clear(input);
    await userEvent.type(input, "999");
    await userEvent.click(screen.getByTestId("button-bulk-jobs-save"));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: expect.stringMatching(/Invalid retention/i),
      variant: "destructive",
    });
    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("rejects non-numeric input with a destructive toast", async () => {
    renderPage();

    const input = screen.getByTestId("input-bulk-jobs-retention-days");
    await userEvent.clear(input);
    // The <input type="number"> filters most non-numeric chars, but an empty
    // string still parses to NaN — which the page must reject explicitly.
    await userEvent.click(screen.getByTestId("button-bulk-jobs-save"));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: expect.stringMatching(/Invalid retention/i),
    });
    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("saves a valid in-bounds value, calls the mutation, and shows a success toast", async () => {
    renderPage();

    const input = screen.getByTestId("input-bulk-jobs-retention-days");
    await userEvent.clear(input);
    await userEvent.type(input, "30");

    const saveBtn = screen.getByTestId("button-bulk-jobs-save");
    expect(saveBtn).not.toBeDisabled();
    await userEvent.click(saveBtn);

    await waitFor(() =>
      expect(STATE.updateCalls).toEqual([{ retentionDays: 30 }]),
    );
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/Settings saved/i),
      }),
    );
    // After a successful save the form is no longer dirty, so Save disables.
    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-jobs-save")).toBeDisabled(),
    );
  });

  it("accepts the boundary values 1 and 365", async () => {
    renderPage();

    const input = screen.getByTestId("input-bulk-jobs-retention-days");
    await userEvent.clear(input);
    await userEvent.type(input, "1");
    await userEvent.click(screen.getByTestId("button-bulk-jobs-save"));
    await waitFor(() =>
      expect(STATE.updateCalls.at(-1)).toEqual({ retentionDays: 1 }),
    );

    await userEvent.clear(input);
    await userEvent.type(input, "365");
    await userEvent.click(screen.getByTestId("button-bulk-jobs-save"));
    await waitFor(() =>
      expect(STATE.updateCalls.at(-1)).toEqual({ retentionDays: 365 }),
    );
  });

  it("Reset reverts unsaved edits back to the persisted value", async () => {
    STATE.current = { retentionDays: 12, updatedAt: new Date().toISOString() };
    renderPage();

    const input = screen.getByTestId(
      "input-bulk-jobs-retention-days",
    ) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "99");
    expect(input.value).toBe("99");

    await userEvent.click(screen.getByTestId("button-bulk-jobs-reset"));
    expect(input.value).toBe("12");
    expect(screen.getByTestId("button-bulk-jobs-save")).toBeDisabled();
    // Reset is purely local — it must NOT issue an update call.
    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("shows a loading indicator while the settings query is in flight", () => {
    STATE.isLoading = true;
    renderPage();
    expect(screen.getByText(/Loading settings/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("input-bulk-jobs-retention-days"),
    ).not.toBeInTheDocument();
  });
});
