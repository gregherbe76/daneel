import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { issueStateSpy, toastSpy, testConnSpy } = vi.hoisted(() => ({
  issueStateSpy: vi.fn(),
  toastSpy: vi.fn(),
  testConnSpy: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@workspace/api-client-react")
  >();
  return {
    ...actual,
    useIssueScoutConnectState: () => ({
      mutateAsync: issueStateSpy,
      isPending: false,
    }),
    useDisconnectScout: () => ({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    }),
    useTestProviderConnection: () => ({
      mutateAsync: testConnSpy,
      isPending: false,
    }),
    getListProvidersQueryKey: () => ["providers"],
    getListProviderStepSettingsQueryKey: () => ["provider-step-settings"],
  };
});

import { ScoutMarketplaceCard } from "./marketplace/connect-cards";

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ScoutMarketplaceCard providers={[]} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  issueStateSpy.mockReset();
  toastSpy.mockReset();
  testConnSpy.mockReset().mockResolvedValue({ ok: true });
  // Prevent the popup branch from navigating jsdom away.
  vi.spyOn(window, "open").mockImplementation(
    () => ({ closed: false }) as unknown as Window,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ScoutMarketplaceCard – auto-assign toggle", () => {
  it(
    "passes autoAssignSteps:false to the issueScoutConnectState mutation " +
      "when the recruiter flips the opt-out toggle before clicking Connect",
    async () => {
      issueStateSpy.mockResolvedValue({
        connectUrl: "https://scout.example/connect?state=abc",
        state: "abc",
      });

      renderCard();

      // Toggle starts opted-in (true). Flipping it should send false.
      const toggle = screen.getByRole("switch", {
        name: /auto-assign workflow steps/i,
      });
      await userEvent.click(toggle);

      await userEvent.click(
        screen.getByRole("button", { name: /connect scout/i }),
      );

      await waitFor(() => expect(issueStateSpy).toHaveBeenCalledTimes(1));
      expect(issueStateSpy).toHaveBeenCalledWith({
        data: { autoAssignSteps: false },
      });
    },
  );

  it(
    "renders a toast naming the assigned Sourcing step when the callback " +
      "broadcasts a successful connect with assignedSteps:['sourcing']",
    async () => {
      issueStateSpy.mockResolvedValue({
        connectUrl: "https://scout.example/connect?state=xyz",
        state: "xyz",
      });

      renderCard();

      // Kick off the connect flow so the component starts listening for the
      // success ping. The toggle is left at its default (true) — the toast
      // contents come from the callback payload, not from the toggle state.
      await userEvent.click(
        screen.getByRole("button", { name: /connect scout/i }),
      );
      await waitFor(() => expect(issueStateSpy).toHaveBeenCalled());

      // Simulate the callback page's postMessage success ping. The component
      // listens on BroadcastChannel + storage + window message; postMessage
      // is the simplest channel to drive from a test.
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              source: "daneel-scout-connect",
              ok: true,
              assignedSteps: ["sourcing"],
            },
          }),
        );
      });

      await waitFor(() => expect(toastSpy).toHaveBeenCalled());
      const successCall = toastSpy.mock.calls.find(
        ([arg]) => (arg as { title?: string }).title === "Connected to A-Player Scout",
      );
      expect(successCall, "expected a success toast").toBeTruthy();
      const payload = successCall![0] as { description: string };
      expect(payload.description).toMatch(/Wired up:/);
      expect(payload.description).toMatch(/Sourcing/);
    },
  );
});

describe("ScoutMarketplaceCard – connect failure toast", () => {
  async function startConnectFlow() {
    issueStateSpy.mockResolvedValue({
      connectUrl: "https://scout.example/connect?state=err",
      state: "err",
    });
    renderCard();
    await userEvent.click(
      screen.getByRole("button", { name: /connect scout/i }),
    );
    await waitFor(() => expect(issueStateSpy).toHaveBeenCalled());
  }

  function findFailureToast() {
    return toastSpy.mock.calls.find(
      ([arg]) =>
        (arg as { title?: string }).title === "Scout connection failed",
    );
  }

  it(
    "renders a destructive toast carrying the error string when the callback " +
      "broadcasts ok:false via postMessage",
    async () => {
      await startConnectFlow();

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              source: "daneel-scout-connect",
              ok: false,
              error: "boom",
            },
          }),
        );
      });

      await waitFor(() => expect(findFailureToast()).toBeTruthy());
      const payload = findFailureToast()![0] as {
        description: string;
        variant: string;
      };
      expect(payload.description).toBe("boom");
      expect(payload.variant).toBe("destructive");
    },
  );

  it(
    "renders the same destructive toast when the failure arrives over the " +
      "BroadcastChannel transport",
    async () => {
      await startConnectFlow();

      await act(async () => {
        const bc = new BroadcastChannel("daneel:scout-connect");
        bc.postMessage({ ok: false, error: "boom" });
        bc.close();
        // Let the BroadcastChannel microtask flush.
        await new Promise((r) => setTimeout(r, 0));
      });

      await waitFor(() => expect(findFailureToast()).toBeTruthy());
      const payload = findFailureToast()![0] as {
        description: string;
        variant: string;
      };
      expect(payload.description).toBe("boom");
      expect(payload.variant).toBe("destructive");
    },
  );

  it(
    "renders the same destructive toast when the failure arrives over the " +
      "localStorage `storage` event transport",
    async () => {
      await startConnectFlow();

      await act(async () => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "daneel.scoutConnect",
            newValue: JSON.stringify({ ok: false, error: "boom" }),
          }),
        );
      });

      await waitFor(() => expect(findFailureToast()).toBeTruthy());
      const payload = findFailureToast()![0] as {
        description: string;
        variant: string;
      };
      expect(payload.description).toBe("boom");
      expect(payload.variant).toBe("destructive");
    },
  );

  it(
    "falls back to 'Unknown error' in the destructive toast description " +
      "when the callback omits an error string",
    async () => {
      await startConnectFlow();

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "daneel-scout-connect", ok: false },
          }),
        );
      });

      await waitFor(() => expect(findFailureToast()).toBeTruthy());
      const payload = findFailureToast()![0] as {
        description: string;
        variant: string;
      };
      expect(payload.description).toBe("Unknown error");
      expect(payload.variant).toBe("destructive");
    },
  );
});
