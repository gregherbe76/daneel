import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── PostHog mock ─────────────────────────────────────────────────────────────
//
// We use the REAL telemetry module here (no mock of @/lib/telemetry) so we
// can verify end-to-end that opening the marketplace under the wrong
// conditions does not actually reach `posthog.capture`.

const posthogMocks = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthogMocks }));

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

async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
}

async function loadAndRenderMarketplace(env: {
  DEV: boolean;
  VITE_POSTHOG_KEY?: string;
}): Promise<void> {
  // Reset both telemetry singleton state and the page's binding to it so the
  // env stubs below take effect for `import.meta.env.DEV` reads inside
  // telemetry.ts (which is captured at module evaluation time only for the
  // env reference, but read on every call — still, we reset to isolate
  // posthog initialization state across tests).
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DEV", env.DEV as never);
  vi.stubEnv("VITE_POSTHOG_KEY", env.VITE_POSTHOG_KEY ?? "");
  vi.stubEnv("VITE_POSTHOG_HOST", "https://eu.i.posthog.com");

  // Pre-warm telemetry initialization if the test wants a granted session,
  // so that by the time MarketplacePage mounts and calls track(), posthog
  // has been initialized.
  const telemetry = await import("@/lib/telemetry");
  if (window.localStorage.getItem("daneel.telemetryConsent") === "granted") {
    telemetry.initIfConsented();
    await flushMicrotasks();
  }

  const { default: MarketplacePage } = await import("./marketplace");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memoryLocation({ path: "/settings/marketplace" }).hook}>
        <MarketplacePage />
      </Router>
    </QueryClientProvider>,
  );
  await flushMicrotasks();
}

function marketplaceOpenedCaptures() {
  return posthogMocks.capture.mock.calls.filter(
    ([event]) => event === "providers_marketplace_opened",
  );
}

beforeEach(() => {
  providers = [];
  listeners.clear();
  posthogMocks.init.mockClear();
  posthogMocks.identify.mockClear();
  posthogMocks.capture.mockClear();
  posthogMocks.opt_out_capturing.mockClear();
  posthogMocks.reset.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("MarketplacePage – providers_marketplace_opened gating", () => {
  it(
    "does NOT reach posthog.capture when the user has not granted consent " +
      "(default state — no consent decision recorded yet)",
    async () => {
      await loadAndRenderMarketplace({
        DEV: false,
        VITE_POSTHOG_KEY: "phc_test_key",
      });

      expect(posthogMocks.init).not.toHaveBeenCalled();
      expect(posthogMocks.capture).not.toHaveBeenCalled();
      expect(marketplaceOpenedCaptures()).toHaveLength(0);
    },
  );

  it(
    "does NOT reach posthog.capture when the user has explicitly denied " +
      "consent",
    async () => {
      window.localStorage.setItem("daneel.telemetryConsent", "denied");

      await loadAndRenderMarketplace({
        DEV: false,
        VITE_POSTHOG_KEY: "phc_test_key",
      });

      expect(posthogMocks.init).not.toHaveBeenCalled();
      expect(posthogMocks.capture).not.toHaveBeenCalled();
      expect(marketplaceOpenedCaptures()).toHaveLength(0);
    },
  );

  it(
    "does NOT reach posthog.capture in dev mode even when consent has been " +
      "granted and a PostHog key is configured",
    async () => {
      window.localStorage.setItem("daneel.telemetryConsent", "granted");

      await loadAndRenderMarketplace({
        DEV: true,
        VITE_POSTHOG_KEY: "phc_test_key",
      });

      expect(posthogMocks.init).not.toHaveBeenCalled();
      expect(posthogMocks.capture).not.toHaveBeenCalled();
      expect(marketplaceOpenedCaptures()).toHaveLength(0);
    },
  );

  it(
    "with consent granted in production, fires `providers_marketplace_opened` " +
      "exactly once with ONLY a `timestamp` field — no provider/job/candidate " +
      "data in the payload",
    async () => {
      window.localStorage.setItem("daneel.telemetryConsent", "granted");
      // Seed providers so the page renders cards — this guards against any
      // future regression where provider data accidentally gets folded into
      // the marketplace-opened payload.
      providers = [
        {
          id: 1,
          name: "Custom Webhook A",
          type: "custom_webhook",
          webhookUrl: "https://example.com/hook",
          enabled: true,
        },
        {
          id: 2,
          name: "SerpAPI",
          type: "web_search",
          webhookUrl: null,
          enabled: true,
        },
      ];

      await loadAndRenderMarketplace({
        DEV: false,
        VITE_POSTHOG_KEY: "phc_test_key",
      });

      const calls = marketplaceOpenedCaptures();
      expect(calls).toHaveLength(1);

      const [eventName, payload] = calls[0];
      expect(eventName).toBe("providers_marketplace_opened");

      // The strict payload contract for this event: timestamp ONLY.
      // (PostHog injects distinct_id itself via the bootstrap config — it is
      // not a field we pass in.)
      expect(Object.keys(payload).sort()).toEqual(["timestamp"]);
      expect(typeof payload.timestamp).toBe("string");
      expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();

      // Defense in depth: explicitly assert none of the forbidden keys
      // sneaked in via a future refactor.
      for (const forbidden of [
        "provider",
        "providers",
        "workflow_step",
        "candidateId",
        "candidateName",
        "candidateEmail",
        "jobId",
        "jobTitle",
        "jobDescription",
        "userId",
      ]) {
        expect(payload).not.toHaveProperty(forbidden);
      }
    },
  );
});
