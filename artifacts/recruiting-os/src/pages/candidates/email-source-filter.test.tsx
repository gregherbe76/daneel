import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mock the generated API hooks the candidates page reaches for ──────────
// We only need useListCandidates (returns candidates) and getListCandidatesQueryKey
// (used by BulkActionBar invalidation). Everything else can be a no-op.
const candidatesData = vi.hoisted<() => unknown>(() => () => [
  {
    id: 1,
    name: "Alice",
    email: "alice@example.com",
    emailSource: "profile",
    emailValidationStatus: "valid",
    emailValidationReason: null,
    skills: ["ts"],
    source: null,
  },
  {
    id: 2,
    name: "Bob",
    email: "bob@example.com",
    emailSource: "manual",
    emailValidationStatus: "valid",
    emailValidationReason: null,
    skills: [],
    source: null,
  },
  {
    id: 3,
    name: "Carol",
    email: "carol@example.com",
    emailSource: null,
    emailValidationStatus: "valid",
    emailValidationReason: null,
    skills: [],
    source: null,
  },
]);

vi.mock("@workspace/api-client-react", () => ({
  useListCandidates: () => ({
    data: candidatesData(),
    isLoading: false,
    refetch: vi.fn(),
    dataUpdatedAt: 0,
  }),
  getListCandidatesQueryKey: () => ["list-candidates"],
}));

// Heavy modal/bar children that the page mounts but aren't relevant to the
// filter under test. Stub them so we don't drag in their own hook chains.
vi.mock("@/components/import-candidates-modal", () => ({
  ImportCandidatesModal: () => null,
}));
vi.mock("@/components/bulk-action-bar", () => ({
  BulkActionBar: () => null,
}));

const STORAGE_KEY = "recruiting-os:email-source-filter";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderCandidatesAt(initialPath: string) {
  const loc = memoryLocation({ path: initialPath, record: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Import the page after mocks are wired so its module graph picks them up.
  const { default: CandidatesPage } = await import("./index");
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={loc.hook}>
        <CandidatesPage />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, loc };
}

function currentSearch(loc: ReturnType<typeof memoryLocation>): string {
  // memoryLocation paths look like "/candidates?emailSource=profile"
  const path = loc.history[loc.history.length - 1] ?? "";
  const idx = path.indexOf("?");
  return idx === -1 ? "" : path.slice(idx + 1);
}

describe("CandidatesPage — remembered email source filter", () => {
  it(
    "restores the saved selection on a fresh visit when the URL has no " +
      "emailSource param",
    async () => {
      window.localStorage.setItem(STORAGE_KEY, "profile,manual");
      const { loc } = await renderCandidatesAt("/candidates");

      await waitFor(() => {
        expect(currentSearch(loc)).toContain("emailSource=");
      });
      const params = new URLSearchParams(currentSearch(loc));
      const restored = (params.get("emailSource") ?? "").split(",").sort();
      expect(restored).toEqual(["manual", "profile"]);
    },
  );

  it(
    "lets an explicit ?emailSource= URL win over the saved value (no " +
      "overwrite from localStorage)",
    async () => {
      window.localStorage.setItem(STORAGE_KEY, "profile,manual");
      const { loc } = await renderCandidatesAt(
        "/candidates?emailSource=commit",
      );

      // The page rendered candidates is the proof that mount effects flushed.
      await screen.findByText("Candidates");
      // Give the on-mount restoration effect a generous window to (incorrectly)
      // fire — if it ever overwrites the URL, this assertion will fail.
      await waitFor(() => {
        const params = new URLSearchParams(currentSearch(loc));
        expect(params.get("emailSource")).toBe("commit");
      });
      // localStorage must be left untouched — the URL wins, the storage value stays.
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("profile,manual");
    },
  );

  it(
    "clearing all source chips removes the saved preference so the next " +
      "visit does not resurrect it",
    async () => {
      window.localStorage.setItem(STORAGE_KEY, "profile");
      const first = await renderCandidatesAt("/candidates");

      // Wait for restoration to put the chip onto the URL.
      await waitFor(() => {
        const params = new URLSearchParams(currentSearch(first.loc));
        expect(params.get("emailSource")).toBe("profile");
      });

      // Open the dropdown and click "Clear filter" (this calls onChange(new Set())
      // → setSelectedSources(empty), which both clears localStorage and drops
      // the URL param).
      await userEvent.click(
        screen.getByRole("button", { name: /email source/i }),
      );
      const clearItem = await screen.findByRole("button", {
        name: /clear filter/i,
      });
      await userEvent.click(clearItem);

      await waitFor(() => {
        const params = new URLSearchParams(currentSearch(first.loc));
        expect(params.get("emailSource")).toBeNull();
      });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

      // Tear down and re-mount to simulate a fresh visit.
      first.unmount();
      const second = await renderCandidatesAt("/candidates");
      await screen.findByText("Candidates");
      // No restoration should have happened — assert it stays clean.
      await waitFor(() => {
        const params = new URLSearchParams(currentSearch(second.loc));
        expect(params.get("emailSource")).toBeNull();
      });
    },
  );

  it(
    "the inline 'Clear all' shortcut drops both the emailSource and email " +
      "URL params in a single tick (no stale survivor)",
    async () => {
      // Land with both filters active so the inline "Clear all" shortcut
      // renders (it only appears when at least one filter is set).
      const { loc } = await renderCandidatesAt(
        "/candidates?emailSource=profile&email=valid",
      );

      await waitFor(() => {
        const params = new URLSearchParams(currentSearch(loc));
        expect(params.get("emailSource")).toBe("profile");
        expect(params.get("email")).toBe("valid");
      });

      // The inline shortcut sits next to the "Showing N of M candidates" copy.
      const clearAll = await screen.findByRole("button", { name: /^clear all$/i });
      await userEvent.click(clearAll);

      await waitFor(() => {
        const params = new URLSearchParams(currentSearch(loc));
        expect(params.get("emailSource")).toBeNull();
        expect(params.get("email")).toBeNull();
      });
    },
  );
});
