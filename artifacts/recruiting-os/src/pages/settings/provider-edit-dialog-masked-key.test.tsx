import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Radix Dialog reaches for ResizeObserver / pointer-capture APIs that jsdom
// doesn't ship; polyfill them before any component is mounted.
if (typeof globalThis.ResizeObserver === "undefined") {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
}
if (
  typeof Element !== "undefined" &&
  !(Element.prototype as unknown as { hasPointerCapture?: unknown })
    .hasPointerCapture
) {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
  (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// We render `ProviderDialog` directly with a stored provider so the form's
// initial defaultValues are the saved provider's, mirroring the real edit
// flow. Everything except the dialog form is stubbed.

vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const updateMutateAsync = vi.fn().mockResolvedValue({ id: 7 });
const createMutateAsync = vi.fn().mockResolvedValue({ id: 8 });

vi.mock("@workspace/api-client-react", () => {
  const noopMutation = () => ({
    mutateAsync: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
    isPending: false,
  });
  return {
    useListProviders: () => ({ data: [], isLoading: false }),
    useCreateProvider: () => ({
      mutateAsync: createMutateAsync,
      isPending: false,
    }),
    useUpdateProvider: () => ({
      mutateAsync: updateMutateAsync,
      isPending: false,
    }),
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

vi.mock("@/components/settings-tabs", () => ({
  SettingsTabs: () => null,
}));

import { ProviderDialog } from "./marketplace-admin";

type ProviderDialogProps = React.ComponentProps<typeof ProviderDialog>;
type Provider = NonNullable<ProviderDialogProps["editProvider"]>;

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 7,
    name: "Custom Webhook A",
    type: "custom_webhook",
    baseUrl: null,
    webhookUrl: "https://example.com/hook",
    apiKeyLast4: "abcd",
    config: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderDialog(editProvider: Provider) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProviderDialog
        open={true}
        onOpenChange={() => {}}
        editProvider={editProvider}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  updateMutateAsync.mockClear();
  createMutateAsync.mockClear();
});

afterEach(() => {
  cleanup();
});

function getKeyInput(): HTMLInputElement {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  );
  const match = inputs.find((el) =>
    (el.getAttribute("placeholder") ?? "").includes("•••• "),
  );
  if (!match) {
    const placeholders = inputs.map((el) => el.getAttribute("placeholder"));
    throw new Error(
      `masked key input not found; password placeholders=${JSON.stringify(placeholders)}`,
    );
  }
  return match;
}

describe("Edit Provider dialog — masked-key flow", () => {
  it(
    "shows a '•••• abcd' placeholder for the saved key and never pre-fills " +
      "the actual input",
    async () => {
      renderDialog(makeProvider({ apiKeyLast4: "abcd" }));
      await screen.findByText("Edit Provider");

      const keyInput = getKeyInput();
      expect(keyInput.placeholder).toBe("•••• abcd — leave blank to keep");
      // Critically: the field itself is empty. The live key is never sent
      // back to the browser, so the dialog must not pre-populate it.
      expect(keyInput.value).toBe("");

      // The helper copy explains the contract.
      expect(
        screen.getByText(/A key is already saved\. Leave blank to keep it/i),
      ).toBeInTheDocument();
    },
  );

  it(
    "submits with apiKeyPlaceholder=null when the recruiter leaves the " +
      "key field blank",
    async () => {
      renderDialog(makeProvider({ apiKeyLast4: "abcd" }));
      await screen.findByText("Edit Provider");

      // Sanity: the input is empty before we hit Save.
      expect(getKeyInput().value).toBe("");

      const saveBtn = screen.getByRole("button", { name: /save/i });
      await userEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      });

      const call = updateMutateAsync.mock.calls[0]![0] as {
        id: number;
        data: { apiKeyPlaceholder: string | null };
      };
      expect(call.id).toBe(7);
      // The route treats null/empty as "keep the saved key". This is the
      // contract the server-side test in providers.test.ts pins down.
      expect(call.data.apiKeyPlaceholder).toBeNull();
    },
  );

  it(
    "submits the new value when the recruiter actually types a replacement",
    async () => {
      renderDialog(makeProvider({ apiKeyLast4: "abcd" }));
      await screen.findByText("Edit Provider");

      await userEvent.type(getKeyInput(), "sk-new-rotated-key-7777");

      const saveBtn = screen.getByRole("button", { name: /save/i });
      await userEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      });
      const call = updateMutateAsync.mock.calls[0]![0] as {
        data: { apiKeyPlaceholder: string | null };
      };
      expect(call.data.apiKeyPlaceholder).toBe("sk-new-rotated-key-7777");
    },
  );
});
