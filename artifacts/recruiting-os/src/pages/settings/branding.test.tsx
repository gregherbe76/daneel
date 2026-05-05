import { describe, expect, it, beforeEach, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { branding as defaultBranding } from "@workspace/branding";

type BrandingRow = {
  productName: string | null;
  companyName: string | null;
  logoUrl: string | null;
  colorPrimary: string | null;
  colorAccent: string | null;
  updatedAt: string | null;
};

let saved: BrandingRow = {
  productName: null,
  companyName: null,
  logoUrl: null,
  colorPrimary: "#112233",
  colorAccent: "#445566",
  updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
};

const listeners = new Set<() => void>();
function notify() {
  for (const l of Array.from(listeners)) l();
}
function setSaved(next: BrandingRow) {
  saved = next;
  notify();
}
function useBrandingStore(): BrandingRow {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return saved;
}

/**
 * Returns the resolved settings the way the real GET endpoint does — null
 * fields fall back to the template defaults so the form hydrates the same
 * way it does in production.
 */
function resolved(row: BrandingRow) {
  return {
    productName: row.productName ?? defaultBranding.productName,
    companyName: row.companyName ?? defaultBranding.companyName,
    logoUrl: row.logoUrl ?? "",
    colorPrimary: row.colorPrimary ?? defaultBranding.colors.primary,
    colorAccent: row.colorAccent ?? defaultBranding.colors.accent,
    updatedAt: row.updatedAt,
  };
}

vi.mock("@workspace/api-client-react", () => ({
  useGetBrandingSettings: () => {
    const data = useBrandingStore();
    return { data: resolved(data), isLoading: false };
  },
  useUpdateBrandingSettings: () => ({
    mutateAsync: async ({ data }: { data: Partial<BrandingRow> }) => {
      setSaved({ ...saved, ...data, updatedAt: new Date().toISOString() });
      return resolved(saved);
    },
    isPending: false,
  }),
  useRequestUploadUrl: () => ({
    mutateAsync: async () => ({ uploadURL: "", objectPath: "" }),
  }),
  getGetBrandingSettingsQueryKey: () => ["branding"],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import BrandingSettingsPage from "./branding";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memoryLocation({ path: "/settings/branding" }).hook}>
        <BrandingSettingsPage />
      </Router>
    </QueryClientProvider>,
  );
}

const SAVED_PRIMARY = "#112233";
const SAVED_ACCENT = "#445566";

beforeEach(() => {
  saved = {
    productName: null,
    companyName: null,
    logoUrl: null,
    colorPrimary: SAVED_PRIMARY,
    colorAccent: SAVED_ACCENT,
    updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
  };
  listeners.clear();
});

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function bgOf(el: HTMLElement): string {
  // jsdom normalizes inline `style="background-color: #aabbcc"` to the
  // canonical `rgb(170, 187, 204)` form when read back.
  return el.style.backgroundColor || "";
}

async function clearAndType(input: HTMLElement, value: string) {
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
}

describe("BrandingSettingsPage – live color preview", () => {
  it("hydrates the preview swatches from the saved colors", async () => {
    renderPage();

    const previewBtn = await screen.findByTestId("preview-primary-button");
    const previewChip = screen.getByTestId("preview-accent-chip");
    expect(bgOf(previewBtn)).toBe(hexToRgb(SAVED_PRIMARY));
    expect(bgOf(previewChip)).toBe(hexToRgb(SAVED_ACCENT));
  });

  it("updates the preview swatches as the user types new hex values, without saving", async () => {
    renderPage();

    const primaryInput = await screen.findByTestId("input-color-primary");
    const accentInput = screen.getByTestId("input-color-accent");

    await clearAndType(primaryInput, "#aabbcc");
    await clearAndType(accentInput, "#ddeeff");

    const previewBtn = screen.getByTestId("preview-primary-button");
    const previewChip = screen.getByTestId("preview-accent-chip");
    const previewCover = screen.getByTestId("preview-report-cover");

    await waitFor(() =>
      expect(bgOf(previewBtn)).toBe(hexToRgb("#aabbcc")),
    );
    expect(bgOf(previewChip)).toBe(hexToRgb("#ddeeff"));
    // The report cover header band uses the primary color.
    const coverBand = previewCover.querySelector("div");
    expect(coverBand).not.toBeNull();
    expect(bgOf(coverBand as HTMLElement)).toBe(hexToRgb("#aabbcc"));

    // Saved row was NOT touched — the preview is local state until Save fires.
    expect(saved.colorPrimary).toBe(SAVED_PRIMARY);
    expect(saved.colorAccent).toBe(SAVED_ACCENT);
  });

  it("clearing both color inputs reverts the preview to the previously saved colors without persisting anything", async () => {
    renderPage();

    const primaryInput = await screen.findByTestId("input-color-primary");
    const accentInput = screen.getByTestId("input-color-accent");

    await clearAndType(primaryInput, "#aabbcc");
    await clearAndType(accentInput, "#ddeeff");
    expect(bgOf(screen.getByTestId("preview-primary-button"))).toBe(
      hexToRgb("#aabbcc"),
    );

    // Hitting "Clear (use default)" on each color row wipes that row's local
    // input back to "" — the preview then falls back to the *saved* colors
    // (data.colorPrimary / data.colorAccent), not to the typed-then-cleared
    // string and not to the template default. That keeps the preview true to
    // what the rest of the app is currently rendering.
    const clearButtons = screen.getAllByRole("button", { name: /clear \(use default\)/i });
    for (const btn of clearButtons) await userEvent.click(btn);

    // Inputs are now empty.
    expect((primaryInput as HTMLInputElement).value).toBe("");
    expect((accentInput as HTMLInputElement).value).toBe("");

    // Preview reverts to the saved colors — proving the typed-then-cleared
    // values are discarded cleanly instead of leaking into the swatch.
    await waitFor(() =>
      expect(
        bgOf(screen.getByTestId("preview-primary-button")),
      ).toBe(hexToRgb(SAVED_PRIMARY)),
    );
    expect(bgOf(screen.getByTestId("preview-accent-chip"))).toBe(
      hexToRgb(SAVED_ACCENT),
    );

    // And nothing was persisted by the typing-then-clearing dance.
    expect(saved.colorPrimary).toBe(SAVED_PRIMARY);
    expect(saved.colorAccent).toBe(SAVED_ACCENT);
  });

  it("restores the saved colors when the user navigates away (component unmounts) without saving", async () => {
    const { unmount } = renderPage();

    const primaryInput = await screen.findByTestId("input-color-primary");
    await clearAndType(primaryInput, "#aabbcc");
    expect(
      bgOf(screen.getByTestId("preview-primary-button")),
    ).toBe(hexToRgb("#aabbcc"));

    // Simulate the recruiter switching pages in the SPA — the preview
    // tear-down must NOT have written the unsaved hex anywhere.
    act(() => unmount());
    expect(saved.colorPrimary).toBe(SAVED_PRIMARY);
    expect(saved.colorAccent).toBe(SAVED_ACCENT);

    // Re-mounting the page hydrates from the still-saved row — the unsaved
    // value is gone, the saved color is back.
    renderPage();
    const previewBtn = await screen.findByTestId("preview-primary-button");
    expect(bgOf(previewBtn)).toBe(hexToRgb(SAVED_PRIMARY));
  });

  it("shows a validation message for an invalid hex and falls back to the saved color in the preview", async () => {
    renderPage();

    const primaryInput = await screen.findByTestId("input-color-primary");
    const previewBtn = screen.getByTestId("preview-primary-button");

    // Type a known-good hex first so we can prove the preview was responsive.
    await clearAndType(primaryInput, "#aabbcc");
    await waitFor(() =>
      expect(bgOf(previewBtn)).toBe(hexToRgb("#aabbcc")),
    );
    expect(screen.queryByTestId("input-color-primary-error")).not.toBeInTheDocument();

    // Now corrupt it into an invalid value.
    await clearAndType(primaryInput, "not-a-color");

    // Validation message appears.
    const error = await screen.findByTestId("input-color-primary-error");
    expect(error).toHaveTextContent(/valid hex color/i);
    expect(primaryInput).toHaveAttribute("aria-invalid", "true");

    // Preview is FROZEN at the previously saved color — the invalid string
    // never bleeds through into the rendered swatch, and the preview does
    // not get yanked back to the template default either. Recruiters keep
    // looking at the brand color the rest of the app is currently rendering
    // until they finish typing a new valid hex.
    expect(bgOf(previewBtn)).toBe(hexToRgb(SAVED_PRIMARY));

    // And nothing was written to the DB by the bad input.
    expect(saved.colorPrimary).toBe(SAVED_PRIMARY);
  });
});
