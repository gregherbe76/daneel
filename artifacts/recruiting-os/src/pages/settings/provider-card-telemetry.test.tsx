import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// providers.tsx imports a lot of generated React Query hooks and a toast
// helper. We only care about the ProviderCard wiring around
// `track("provider_card_viewed", ...)`, so stub each hook with the smallest
// shape it consumes.

const { trackSpy } = vi.hoisted(() => ({ trackSpy: vi.fn() }));
vi.mock("@/lib/telemetry", () => ({
  track: trackSpy,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mutable provider list driven per-test.
let mockProviders: Array<Record<string, unknown>> = [];

vi.mock("@workspace/api-client-react", () => {
  const noopMutation = () => ({
    mutateAsync: vi.fn().mockResolvedValue({ ok: true, latencyMs: 12 }),
    isPending: false,
  });
  return {
    useListProviders: () => ({ data: mockProviders, isLoading: false }),
    useCreateProvider: noopMutation,
    useUpdateProvider: noopMutation,
    useDeleteProvider: noopMutation,
    useToggleProvider: noopMutation,
    useTestProviderConnection: noopMutation,
    useListProviderStepSettings: () => ({ data: [], isLoading: false }),
    useUpsertProviderStepSetting: noopMutation,
    usePreviewGithubQuery: noopMutation,
    useListJobs: () => ({ data: [], isLoading: false }),
    useIssueScoutConnectState: noopMutation,
    useDisconnectScout: noopMutation,
    useIssueEnrichConnectState: noopMutation,
    useDisconnectEnrich: noopMutation,
    getListProvidersQueryKey: () => ["providers"],
    getListProviderStepSettingsQueryKey: () => ["provider-step-settings"],
  };
});

// SettingsTabs uses wouter's useLocation; render in a router-friendly way by
// stubbing the component out so we don't pull in routing for this unit test.
vi.mock("@/components/settings-tabs", () => ({
  SettingsTabs: () => null,
}));

// Import the section under test AFTER mocks so they apply.
import { AdvancedProvidersSection as AgentProvidersPage } from "./marketplace-admin";

function makeProvider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: "Custom Webhook A",
    type: "custom_webhook",
    baseUrl: null,
    webhookUrl: "https://example.com/hook",
    apiKeyLast4: null,
    config: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgentProvidersPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  trackSpy.mockClear();
  mockProviders = [];
});

afterEach(() => {
  cleanup();
});

function viewCalls() {
  return trackSpy.mock.calls.filter(
    ([event]) => event === "provider_card_viewed",
  );
}

describe("ProviderCard telemetry wiring", () => {
  it("fires `provider_card_viewed` exactly once per card per page view", () => {
    mockProviders = [
      makeProvider({ id: 1, name: "Provider A" }),
      makeProvider({ id: 2, name: "Provider B" }),
    ];

    renderPage();

    const calls = viewCalls();
    expect(calls).toHaveLength(2);
    expect(
      calls.map(([, p]) => (p as { provider: string }).provider).sort(),
    ).toEqual(["Provider A", "Provider B"]);
  });

  it(
    "does not re-fire `provider_card_viewed` when an unrelated parent state " +
      "changes between renders",
    async () => {
      mockProviders = [makeProvider({ id: 1, name: "Provider A" })];

      function Wrapper() {
        const [tick, setTick] = useState(0);
        return (
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          >
            <button
              type="button"
              data-testid="bump"
              onClick={() => setTick((t) => t + 1)}
            >
              bump {tick}
            </button>
            <AgentProvidersPage />
          </QueryClientProvider>
        );
      }

      render(<Wrapper />);

      // Initial mount: exactly one view event for the only card.
      expect(viewCalls()).toHaveLength(1);
      expect(
        (viewCalls()[0][1] as { provider: string }).provider,
      ).toBe("Provider A");

      // Three unrelated parent re-renders — the same card stays mounted with
      // an unchanged `provider.name`, so the useEffect deps are stable and
      // no additional view events should fire.
      await userEvent.click(screen.getByTestId("bump"));
      await userEvent.click(screen.getByTestId("bump"));
      await userEvent.click(screen.getByTestId("bump"));

      expect(viewCalls()).toHaveLength(1);
    },
  );
});
