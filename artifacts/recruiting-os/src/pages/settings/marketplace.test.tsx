import { describe, expect, it, beforeEach, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router, Switch, Route, Redirect } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LEGACY_SETTINGS_REDIRECTS } from "@/App";

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
function setProviders(next: ProviderRecord[]) {
  providers = next;
  notify();
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

type StepSettingRow = {
  id: number;
  workflowStep: string;
  providerId: number;
  enabled: boolean;
  provider?: ProviderRecord;
};
let stepSettings: StepSettingRow[] = [];
const stepListeners = new Set<() => void>();
function notifySteps() {
  for (const l of Array.from(stepListeners)) l();
}
function setStepSettings(next: StepSettingRow[]) {
  stepSettings = next;
  notifySteps();
}
function useStepSettingsStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    stepListeners.add(l);
    return () => {
      stepListeners.delete(l);
    };
  }, []);
  return stepSettings;
}

const previewGithubQueryMock = vi.fn();
const listJobsData: Array<{ id: number; title: string; location?: string | null }> = [
  { id: 1, title: "Staff Engineer", location: "Remote" },
];

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useListJobs: () => ({ data: listJobsData, isLoading: false, error: null }),
    usePreviewGithubQuery: () => ({
      mutateAsync: previewGithubQueryMock,
      isPending: false,
    }),
    useListProviders: () => {
      const data = useProvidersStore();
      return { data, isLoading: false, error: null };
    },
    useListProviderStepSettings: () => {
      const data = useStepSettingsStore();
      return { data, isLoading: false };
    },
    useUpsertProviderStepSetting: () => ({
      mutateAsync: async ({
        data,
      }: {
        data: { workflowStep: string; providerId: number; enabled: boolean };
      }) => {
        const existing = stepSettings.find(
          (s) => s.workflowStep === data.workflowStep,
        );
        if (existing) {
          setStepSettings(
            stepSettings.map((s) =>
              s.workflowStep === data.workflowStep
                ? { ...s, providerId: data.providerId, enabled: data.enabled }
                : s,
            ),
          );
          return { ...existing, ...data };
        }
        const next: StepSettingRow = {
          id: stepSettings.length + 1,
          workflowStep: data.workflowStep,
          providerId: data.providerId,
          enabled: data.enabled,
        };
        setStepSettings([...stepSettings, next]);
        return next;
      },
    }),
    useCreateProvider: () => ({
      mutateAsync: async ({ data }: { data: Omit<ProviderRecord, "id"> }) => {
        const next = {
          id: providers.length + 1,
          ...data,
        } as ProviderRecord;
        setProviders([...providers, next]);
        return next;
      },
    }),
    useUpdateProvider: () => ({
      mutateAsync: async ({
        id,
        data,
      }: {
        id: number;
        data: Omit<ProviderRecord, "id">;
      }) => {
        setProviders(
          providers.map((p) =>
            p.id === id ? ({ ...p, ...data, id } as ProviderRecord) : p,
          ),
        );
        return { id, ...data } as ProviderRecord;
      },
    }),
    getListProvidersQueryKey: () => ["providers"],
    getListProviderStepSettingsQueryKey: () => ["provider-step-settings"],
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import MarketplacePage from "./marketplace";
import { CATEGORIES, CATALOG, PHASE_COPY } from "./marketplace/catalog";

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

beforeEach(() => {
  providers = [];
  stepSettings = [];
  listeners.clear();
  stepListeners.clear();
  window.localStorage.clear();
  previewGithubQueryMock.mockReset();
});

describe("MarketplacePage – categories", () => {
  it("renders all five category tabs plus All, with the catalog's exact counts", () => {
    renderPage();

    const allTab = screen.getByTestId("category-tab-all");
    expect(allTab).toHaveTextContent(`All`);
    expect(allTab).toHaveTextContent(`(${CATALOG.length})`);

    for (const cat of CATEGORIES) {
      const tab = screen.getByTestId(`category-tab-${cat.key}`);
      expect(tab).toHaveTextContent(cat.label);
      const expected = CATALOG.filter((c) => c.category === cat.key).length;
      expect(tab).toHaveTextContent(`(${expected})`);
    }
  });

  it("'All' view renders one card per catalog entry", () => {
    renderPage();
    for (const entry of CATALOG) {
      expect(
        screen.getByTestId(`marketplace-card-${entry.id}`),
      ).toBeInTheDocument();
    }
  });

  it.each(CATEGORIES.map((c) => [c.key, c.label] as const))(
    "the '%s' tab only shows cards in that category",
    async (key) => {
      renderPage();

      await userEvent.click(screen.getByTestId(`category-tab-${key}`));

      const expectedIds = CATALOG.filter((c) => c.category === key).map(
        (c) => c.id,
      );
      const otherIds = CATALOG.filter((c) => c.category !== key).map((c) => c.id);

      for (const id of expectedIds) {
        expect(
          screen.getByTestId(`marketplace-card-${id}`),
        ).toBeInTheDocument();
      }
      for (const id of otherIds) {
        expect(
          screen.queryByTestId(`marketplace-card-${id}`),
        ).not.toBeInTheDocument();
      }
    },
  );
});

describe("MarketplacePage – A-Player Coming Soon dialogs", () => {
  const stubs = CATALOG.filter((c) => c.kind === "stub") as Extract<
    (typeof CATALOG)[number],
    { kind: "stub" }
  >[];

  it("includes exactly the four expected A-Player stubs", () => {
    expect(stubs.map((s) => s.id).sort()).toEqual(
      ["clearbit-enrich", "linkedin-recruiter", "outreach-agent", "twin-evaluator"].sort(),
    );
  });

  it.each(stubs.map((s) => [s.id, s.name, s.phase] as const))(
    "clicking Connect on the %s card opens the Coming Soon dialog with phase copy",
    async (id, name, phase) => {
      renderPage();

      await userEvent.click(screen.getByTestId(`connect-${id}`));

      const dialog = await screen.findByTestId("coming-soon-dialog");
      expect(within(dialog).getByText(name)).toBeInTheDocument();
      expect(within(dialog).getByText(PHASE_COPY[phase])).toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole("button", { name: /got it/i }));

      await waitFor(() =>
        expect(screen.queryByTestId("coming-soon-dialog")).not.toBeInTheDocument(),
      );
    },
  );
});

describe("MarketplacePage – free provider connect flows", () => {
  function statusOf(id: string): string {
    const card = screen.getByTestId(`marketplace-card-${id}`);
    return card.textContent ?? "";
  }

  it("Custom Webhook flips from Disconnected to Connected after saving a webhook URL", async () => {
    renderPage();

    expect(statusOf("custom-webhook")).toMatch(/Disconnected/);

    await userEvent.click(screen.getByTestId("connect-custom-webhook"));
    const dialog = await screen.findByTestId("connect-dialog-custom_webhook");

    await userEvent.type(
      within(dialog).getByTestId("custom-webhook-url"),
      "https://example.com/hook",
    );
    await userEvent.click(within(dialog).getByTestId("connect-save"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("connect-dialog-custom_webhook"),
      ).not.toBeInTheDocument(),
    );

    await waitFor(() => expect(statusOf("custom-webhook")).toMatch(/Connected/));
    // Once connected, the action button label switches to "Manage".
    expect(screen.getByTestId("connect-custom-webhook")).toHaveTextContent(
      "Manage",
    );
  });

  it("Apify Scrapers persists an `apify` provider record and flips to Connected", async () => {
    renderPage();

    expect(statusOf("apify")).toMatch(/Disconnected/);

    await userEvent.click(screen.getByTestId("connect-apify"));
    const dialog = await screen.findByTestId("connect-dialog-apify");

    await userEvent.type(
      within(dialog).getByTestId("apify-key"),
      "apify_api_test_token",
    );
    await userEvent.click(within(dialog).getByTestId("connect-save"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("connect-dialog-apify"),
      ).not.toBeInTheDocument(),
    );

    // Connection state now comes from the providers list — the marketplace
    // creates a real `apify`-typed provider via the API instead of stashing
    // the key in localStorage.
    await waitFor(() =>
      expect(providers.some((p) => p.type === "apify" && p.enabled)).toBe(true),
    );
    await waitFor(() => expect(statusOf("apify")).toMatch(/Connected/));
    expect(screen.getByTestId("connect-apify")).toHaveTextContent("Manage");
  });

  it("SerpAPI Web Search flips from Disconnected to Connected after saving", async () => {
    renderPage();

    expect(statusOf("serpapi")).toMatch(/Disconnected/);

    await userEvent.click(screen.getByTestId("connect-serpapi"));
    const dialog = await screen.findByTestId("connect-dialog-serpapi");

    await userEvent.type(
      within(dialog).getByTestId("serpapi-key"),
      "serpapi-test-key",
    );
    await userEvent.click(within(dialog).getByTestId("connect-save"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("connect-dialog-serpapi"),
      ).not.toBeInTheDocument(),
    );

    await waitFor(() => expect(statusOf("serpapi")).toMatch(/Connected/));
    expect(screen.getByTestId("connect-serpapi")).toHaveTextContent("Manage");
  });
});

describe("MarketplacePage – GitHub Agent connect entry", () => {
  it("includes a GitHub Agent connect card in the sourcing category", () => {
    const gh = CATALOG.find((c) => c.id === "github-agent");
    expect(gh).toBeDefined();
    expect(gh?.kind).toBe("connect");
    if (gh?.kind === "connect") {
      expect(gh.connectType).toBe("github");
      expect(gh.category).toBe("sourcing");
    }
  });

  it("connects GitHub Agent and saves a github provider row", async () => {
    renderPage();

    await userEvent.click(screen.getByTestId("connect-github-agent"));
    const dialog = await screen.findByTestId("connect-dialog-github");
    await userEvent.click(within(dialog).getByTestId("connect-save"));

    await waitFor(() =>
      expect(screen.queryByTestId("connect-dialog-github")).not.toBeInTheDocument(),
    );
    expect(providers.find((p) => p.type === "github")).toBeDefined();
    await waitFor(() =>
      expect(screen.getByTestId("marketplace-card-github-agent").textContent).toMatch(
        /Connected/,
      ),
    );
  });

  it("opens the advanced GitHub tuning panel from the marketplace card", async () => {
    renderPage();

    await userEvent.click(screen.getByTestId("connect-github-agent"));
    const dialog = await screen.findByTestId("connect-dialog-github");
    expect(within(dialog).queryByTestId("github-advanced")).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByTestId("advanced-toggle"));

    expect(within(dialog).getByTestId("github-advanced")).toBeInTheDocument();
    expect(within(dialog).getByTestId("gh-extra-keywords")).toBeInTheDocument();
    expect(within(dialog).getByTestId("gh-min-followers")).toBeInTheDocument();
  });

  it("renders the GitHub query preview block inside Advanced settings", async () => {
    renderPage();

    await userEvent.click(screen.getByTestId("connect-github-agent"));
    const dialog = await screen.findByTestId("connect-dialog-github");

    expect(
      within(dialog).queryByTestId("github-query-preview"),
    ).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByTestId("advanced-toggle"));

    const preview = within(dialog).getByTestId("github-query-preview");
    expect(preview).toBeInTheDocument();
    expect(within(preview).getByTestId("gh-preview-job-select")).toBeInTheDocument();
    expect(within(preview).getByTestId("gh-preview-build-query")).toBeInTheDocument();
  });

  it("surfaces the assembled query string after clicking Build query", async () => {
    previewGithubQueryMock.mockResolvedValueOnce({
      query: "language:typescript followers:>50",
      totalCount: null,
      totalCountError: null,
    });

    renderPage();

    await userEvent.click(screen.getByTestId("connect-github-agent"));
    const dialog = await screen.findByTestId("connect-dialog-github");
    await userEvent.click(within(dialog).getByTestId("advanced-toggle"));

    const preview = within(dialog).getByTestId("github-query-preview");
    await userEvent.click(within(preview).getByTestId("gh-preview-build-query"));

    await waitFor(() =>
      expect(previewGithubQueryMock).toHaveBeenCalledTimes(1),
    );
    const call = previewGithubQueryMock.mock.calls[0][0];
    expect(call.data.jobId).toBe(1);

    await waitFor(() =>
      expect(within(preview).getByTestId("gh-preview-query")).toHaveTextContent(
        "language:typescript followers:>50",
      ),
    );
  });

  it("opens the advanced Web Search tuning panel from the marketplace card", async () => {
    renderPage();

    await userEvent.click(screen.getByTestId("connect-serpapi"));
    const dialog = await screen.findByTestId("connect-dialog-serpapi");
    expect(within(dialog).queryByTestId("serpapi-advanced")).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByTestId("advanced-toggle"));

    expect(within(dialog).getByTestId("serpapi-advanced")).toBeInTheDocument();
    expect(within(dialog).getByTestId("ws-target-sites")).toBeInTheDocument();
  });
});

describe("MarketplacePage – inline workflow step assignment", () => {
  it("lets a connected provider be assigned to a workflow step from the card", async () => {
    renderPage();

    // Connect SerpAPI first so the inline step picker becomes visible.
    await userEvent.click(screen.getByTestId("connect-serpapi"));
    const dialog = await screen.findByTestId("connect-dialog-serpapi");
    await userEvent.click(within(dialog).getByTestId("connect-save"));
    await waitFor(() =>
      expect(screen.queryByTestId("connect-dialog-serpapi")).not.toBeInTheDocument(),
    );

    // The inline step assignment panel should now be visible on the card.
    const panel = await screen.findByTestId("step-assignment-serpapi");
    const checkbox = within(panel).getByTestId("step-checkbox-serpapi-sourcing");
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);

    await waitFor(() => {
      const setting = stepSettings.find((s) => s.workflowStep === "sourcing");
      expect(setting?.providerId).toBe(
        providers.find((p) => p.type === "web_search")?.id,
      );
      expect(setting?.enabled).toBe(true);
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId("step-assignment-serpapi")).getByTestId(
          "step-checkbox-serpapi-sourcing",
        ),
      ).toBeChecked(),
    );
  });

  it("does not render an inline step picker for stub or apify entries", async () => {
    renderPage();

    expect(screen.queryByTestId("step-assignment-apify")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("step-assignment-linkedin-recruiter"),
    ).not.toBeInTheDocument();
  });
});

describe("MarketplacePage – Advanced (admin) disclosure", () => {
  it("starts closed and toggles open when its summary is clicked", async () => {
    renderPage();

    const details = screen.getByTestId(
      "advanced-admin-section",
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);

    const summary = details.querySelector("summary");
    expect(summary).not.toBeNull();
    await userEvent.click(summary as HTMLElement);

    expect(details.open).toBe(true);
  });

  it("mounts the lifted admin sections inside the disclosure", async () => {
    renderPage();

    const details = screen.getByTestId(
      "advanced-admin-section",
    ) as HTMLDetailsElement;
    const summary = details.querySelector("summary");
    await userEvent.click(summary as HTMLElement);

    // The lifted Configured Providers section ships an "Add Provider" button.
    expect(
      within(details).getByRole("button", { name: /add provider/i }),
    ).toBeInTheDocument();

    // The lifted Workflow Step Assignments section heading.
    expect(
      within(details).getByRole("heading", {
        name: /workflow step assignments/i,
      }),
    ).toBeInTheDocument();

    // The Advanced section's own A-Player integrations subsection heading
    // (separate from the marketplace Scout card above the disclosure).
    expect(
      within(details).getByRole("heading", { name: /a-player integrations/i }),
    ).toBeInTheDocument();
  });
});

describe("App routing – legacy settings paths redirect to the marketplace", () => {
  // Behavioral runtime check driven off the EXACT redirect array exported
  // from App.tsx. If a redirect is dropped, retargeted, or its source path
  // is renamed in production, the corresponding parameterized case here
  // fails (either no route matches and the not-found marker renders, or
  // the recorded history doesn't end at /settings/marketplace).
  function RedirectHarness() {
    return (
      <Switch>
        {LEGACY_SETTINGS_REDIRECTS.map(({ from, to }) => (
          <Route
            key={from}
            path={from}
            component={() => <Redirect to={to} />}
          />
        ))}
        <Route path="/settings/marketplace">
          <div data-testid="marketplace-landed">marketplace</div>
        </Route>
        <Route>
          <div data-testid="not-found">not found</div>
        </Route>
      </Switch>
    );
  }

  it("declares redirects for every legacy settings path the funnel cares about", () => {
    // Locks the contract: if anyone removes one of these from App.tsx the
    // test fails immediately, before we even try to navigate.
    expect(LEGACY_SETTINGS_REDIRECTS).toEqual([
      { from: "/settings", to: "/settings/marketplace" },
      { from: "/settings/providers", to: "/settings/marketplace" },
      {
        from: "/settings/agent-providers",
        to: "/settings/marketplace",
      },
    ]);
  });

  it.each(LEGACY_SETTINGS_REDIRECTS.map((r) => [r.from, r.to] as const))(
    "visiting %s redirects to %s at runtime",
    async (from, to) => {
      const memory = memoryLocation({ path: from, record: true });
      render(
        <Router hook={memory.hook}>
          <RedirectHarness />
        </Router>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("marketplace-landed")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
      expect(memory.history[memory.history.length - 1]).toBe(to);
    },
  );
});
