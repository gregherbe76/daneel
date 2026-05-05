import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// We intercept `track` from the telemetry wrapper so we can assert call
// counts and payload shape coming OUT of MarketplacePage. The dev/consent
// gating of the wrapper itself is verified separately in
// `marketplace-telemetry-gating.test.tsx` against the real telemetry module.

const { trackSpy } = vi.hoisted(() => ({ trackSpy: vi.fn() }));
vi.mock("@/lib/telemetry", () => ({
  track: trackSpy,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

type ProviderRecord = {
  id: number;
  name: string;
  type: string;
  webhookUrl?: string | null;
  enabled: boolean;
};

let providers: ProviderRecord[] = [];
const listeners = new Set<() => void>();
function notify() {
  for (const l of Array.from(listeners)) l();
}
function useProvidersStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return providers;
}

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  const noopMutation = () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  });
  return {
    ...actual,
    useListProviders: () => {
      const data = useProvidersStore();
      return { data, isLoading: false, error: null };
    },
    useListProviderStepSettings: () => ({ data: [], isLoading: false }),
    useCreateProvider: noopMutation,
    useUpdateProvider: noopMutation,
    getListProvidersQueryKey: () => ["providers"],
  };
});

import MarketplacePage from "./marketplace";
import { CATEGORIES } from "./marketplace/catalog";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memoryLocation({ path: "/settings/marketplace" }).hook}>
        <MarketplacePage />
      </Router>
    </QueryClientProvider>,
  );
}

function marketplaceOpenedCalls() {
  return trackSpy.mock.calls.filter(
    ([event]) => event === "providers_marketplace_opened",
  );
}

beforeEach(() => {
  providers = [];
  listeners.clear();
  trackSpy.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("MarketplacePage – providers_marketplace_opened telemetry", () => {
  it("fires `providers_marketplace_opened` exactly once on mount", () => {
    renderPage();
    expect(marketplaceOpenedCalls()).toHaveLength(1);
  });

  it(
    "does not refire `providers_marketplace_opened` when the user switches " +
      "between category tabs (state changes, same mount)",
    async () => {
      renderPage();
      expect(marketplaceOpenedCalls()).toHaveLength(1);

      // Click through every category tab plus back to All — none of these
      // unmount the page, so the event must remain at one fire.
      for (const cat of CATEGORIES) {
        await userEvent.click(screen.getByTestId(`category-tab-${cat.key}`));
      }
      await userEvent.click(screen.getByTestId("category-tab-all"));

      expect(marketplaceOpenedCalls()).toHaveLength(1);
    },
  );

  it(
    "does not refire `providers_marketplace_opened` when an unrelated parent " +
      "state change forces a re-render",
    async () => {
      function Wrapper() {
        const [tick, setTick] = useState(0);
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        return (
          <QueryClientProvider client={queryClient}>
            <button
              type="button"
              data-testid="bump"
              onClick={() => setTick((t) => t + 1)}
            >
              bump {tick}
            </button>
            <Router hook={memoryLocation({ path: "/settings/marketplace" }).hook}>
              <MarketplacePage />
            </Router>
          </QueryClientProvider>
        );
      }

      render(<Wrapper />);
      expect(marketplaceOpenedCalls()).toHaveLength(1);

      await userEvent.click(screen.getByTestId("bump"));
      await userEvent.click(screen.getByTestId("bump"));
      await userEvent.click(screen.getByTestId("bump"));

      expect(marketplaceOpenedCalls()).toHaveLength(1);
    },
  );

  it(
    "fires `providers_marketplace_opened` again on a fresh mount after " +
      "unmount/remount (one event per visit, not one per app session)",
    () => {
      const first = renderPage();
      expect(marketplaceOpenedCalls()).toHaveLength(1);
      first.unmount();

      renderPage();
      expect(marketplaceOpenedCalls()).toHaveLength(2);
    },
  );

  it(
    "does NOT pass any provider/job/candidate payload to track — the call " +
      "site sends only the event name (timestamp + distinct_id are added " +
      "by the telemetry wrapper, not by the page)",
    () => {
      providers = [
        {
          id: 1,
          name: "Custom Webhook A",
          type: "custom_webhook",
          webhookUrl: "https://example.com/hook",
          enabled: true,
        },
      ];
      renderPage();

      const calls = marketplaceOpenedCalls();
      expect(calls).toHaveLength(1);

      const [, payload] = calls[0];
      // The call site either omits the second arg entirely or passes an
      // empty object — both are acceptable, but absolutely no fields
      // identifying providers/jobs/candidates are allowed.
      const keys = payload === undefined ? [] : Object.keys(payload);
      expect(keys).toEqual([]);
    },
  );
});
