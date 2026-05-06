import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// Mirrors the pattern used by `provider-card-telemetry.test.tsx`: stub every
// generated React Query hook used by `AdvancedProvidersSection` with the
// minimum shape it needs, then override the Enrich-specific hooks with spies
// so we can assert the connect flow wires up correctly.

const { issueEnrichSpy, disconnectEnrichSpy, toastSpy, testConnSpy } =
  vi.hoisted(() => ({
    issueEnrichSpy: vi.fn(),
    disconnectEnrichSpy: vi.fn(),
    toastSpy: vi.fn(),
    testConnSpy: vi.fn(),
  }));

vi.mock("@/lib/telemetry", () => ({
  track: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// Mutable provider list driven per-test so we can flip between
// "not connected" and "connected" states.
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
    useTestProviderConnection: () => ({
      mutateAsync: testConnSpy,
      isPending: false,
    }),
    useListProviderStepSettings: () => ({ data: [], isLoading: false }),
    useUpsertProviderStepSetting: noopMutation,
    usePreviewGithubQuery: noopMutation,
    useListJobs: () => ({ data: [], isLoading: false }),
    useIssueScoutConnectState: noopMutation,
    useDisconnectScout: noopMutation,
    useIssueEnrichConnectState: () => ({
      mutateAsync: issueEnrichSpy,
      isPending: false,
    }),
    useDisconnectEnrich: () => ({
      mutateAsync: disconnectEnrichSpy,
      isPending: false,
    }),
    getListProvidersQueryKey: () => ["providers"],
    getListProviderStepSettingsQueryKey: () => ["provider-step-settings"],
  };
});

vi.mock("@/components/settings-tabs", () => ({
  SettingsTabs: () => null,
}));

import { AdvancedProvidersSection as AgentProvidersPage } from "./marketplace-admin";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgentProvidersPage />
    </QueryClientProvider>,
  );
}

function getEnrichCard() {
  // Card identity comes from the visible product name. Walk up to the
  // shared card container so queries inside it can't accidentally hit the
  // sibling Scout card or the (always-mounted) Disconnect AlertDialog
  // title that also contains "A-Player Enrich".
  const heading = screen
    .getAllByText("A-Player Enrich")
    .find((el) => el.tagName === "SPAN");
  if (!heading) throw new Error("Could not find Enrich card heading");
  const card = heading.closest("div.border");
  if (!card) throw new Error("Could not find Enrich card container");
  return within(card as HTMLElement);
}

beforeEach(() => {
  issueEnrichSpy.mockReset();
  disconnectEnrichSpy.mockReset();
  toastSpy.mockReset();
  testConnSpy.mockReset().mockResolvedValue({ ok: true });
  mockProviders = [];
  // Prevent the popup branch from navigating jsdom away when Connect fires.
  vi.spyOn(window, "open").mockImplementation(
    () => ({ closed: false }) as unknown as Window,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeEnrichProvider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 99,
    name: "A-Player Enrich",
    type: "twin_webhook",
    baseUrl: null,
    webhookUrl: "https://enrich.example/hook",
    apiKeyLast4: null,
    config: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EnrichMarketplaceCard", () => {
  it(
    "renders the Enrich card alongside the Scout card on the providers page",
    () => {
      renderPage();

      // Both marketplace cards should be visible — Enrich is a peer to
      // Scout in the marketplace section, not a replacement. The Scout
      // copy also appears in the section heading, so use getAllByText.
      expect(screen.getAllByText("A-Player Scout").length).toBeGreaterThan(0);
      expect(screen.getByText("A-Player Enrich")).toBeInTheDocument();

      const card = getEnrichCard();
      expect(card.getByRole("button", { name: /connect enrich/i }))
        .toBeInTheDocument();
      expect(
        card.getByRole("switch", {
          name: /auto-assign workflow steps/i,
        }),
      ).toBeInTheDocument();
    },
  );

  it(
    "passes autoAssignSteps:false to useIssueEnrichConnectState when the " +
      "recruiter flips the opt-out toggle before clicking Connect Enrich",
    async () => {
      issueEnrichSpy.mockResolvedValue({
        connectUrl: "https://enrich.example/connect?state=abc",
        state: "abc",
      });

      renderPage();
      const card = getEnrichCard();

      const toggle = card.getByRole("switch", {
        name: /auto-assign workflow steps/i,
      });
      await userEvent.click(toggle);

      await userEvent.click(
        card.getByRole("button", { name: /connect enrich/i }),
      );

      await waitFor(() => expect(issueEnrichSpy).toHaveBeenCalledTimes(1));
      expect(issueEnrichSpy).toHaveBeenCalledWith({
        data: { autoAssignSteps: false },
      });
    },
  );

  it(
    "renders a 'Wired up: Enrichment' toast when the callback broadcasts a " +
      "successful connect with assignedSteps:['enrichment']",
    async () => {
      issueEnrichSpy.mockResolvedValue({
        connectUrl: "https://enrich.example/connect?state=xyz",
        state: "xyz",
      });

      renderPage();
      const card = getEnrichCard();

      // Kick off the connect flow so the component starts listening for the
      // success ping. The default toggle state is irrelevant here — the
      // toast contents come from the callback payload.
      await userEvent.click(
        card.getByRole("button", { name: /connect enrich/i }),
      );
      await waitFor(() => expect(issueEnrichSpy).toHaveBeenCalled());

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              source: "daneel-enrich-connect",
              ok: true,
              assignedSteps: ["enrichment"],
            },
          }),
        );
      });

      await waitFor(() => expect(toastSpy).toHaveBeenCalled());
      const successCall = toastSpy.mock.calls.find(
        ([arg]) =>
          (arg as { title?: string }).title === "Connected to A-Player Enrich",
      );
      expect(successCall, "expected a success toast").toBeTruthy();
      const payload = successCall![0] as { description: string };
      expect(payload.description).toMatch(/Wired up:/);
      expect(payload.description).toMatch(/Enrichment/);
    },
  );

  it(
    "shows the connected-state UI (Connected badge, Reconnect + Disconnect, " +
      "no auto-assign toggle) when an enabled Enrich provider is present",
    () => {
      mockProviders = [makeEnrichProvider({ enabled: true })];

      renderPage();
      const card = getEnrichCard();

      // Status flips from "Not connected" to "Connected".
      expect(card.getByText(/^Connected$/)).toBeInTheDocument();
      expect(card.queryByText(/Not connected/)).not.toBeInTheDocument();

      // Connect-flow controls are replaced by Reconnect + Disconnect.
      expect(card.getByRole("button", { name: /reconnect/i }))
        .toBeInTheDocument();
      expect(card.getByRole("button", { name: /^disconnect$/i }))
        .toBeInTheDocument();
      expect(
        card.queryByRole("button", { name: /connect enrich/i }),
      ).not.toBeInTheDocument();

      // Auto-assign toggle is only shown pre-connect.
      expect(
        card.queryByRole("switch", {
          name: /auto-assign workflow steps/i,
        }),
      ).not.toBeInTheDocument();
    },
  );
});
