import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const posthogMocks = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthogMocks }));

async function loadPage(env: {
  DEV?: boolean | string;
  VITE_POSTHOG_KEY?: string;
}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DEV", env.DEV === undefined ? false : (env.DEV as boolean));
  vi.stubEnv(
    "VITE_POSTHOG_KEY",
    env.VITE_POSTHOG_KEY === undefined ? "" : env.VITE_POSTHOG_KEY,
  );
  const mod = await import("./telemetry");
  return mod.default;
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <Router hook={memoryLocation({ path: "/settings/telemetry" }).hook}>
      {ui}
    </Router>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  posthogMocks.init.mockClear();
  posthogMocks.identify.mockClear();
  posthogMocks.opt_out_capturing.mockClear();
  posthogMocks.reset.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TelemetrySettingsPage", () => {
  it("the toggle reflects no stored consent (unchecked) and is enabled when key is set + not dev", async () => {
    const Page = await loadPage({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    renderWithRouter(<Page />);

    const toggle = screen.getByTestId("telemetry-consent-toggle");
    expect(toggle).toHaveAttribute("data-state", "unchecked");
    expect(toggle).not.toBeDisabled();
  });

  it("the toggle reflects stored 'granted' consent (checked) on initial render", async () => {
    window.localStorage.setItem("daneel.telemetryConsent", "granted");
    const Page = await loadPage({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    renderWithRouter(<Page />);

    const toggle = screen.getByTestId("telemetry-consent-toggle");
    expect(toggle).toHaveAttribute("data-state", "checked");
  });

  it(
    "flipping the toggle on writes 'granted' to localStorage and reflects checked state; " +
      "flipping it off writes 'denied' and reflects unchecked",
    async () => {
      const Page = await loadPage({
        DEV: false,
        VITE_POSTHOG_KEY: "phc_test_key",
      });
      renderWithRouter(<Page />);

      const toggle = screen.getByTestId("telemetry-consent-toggle");
      expect(toggle).toHaveAttribute("data-state", "unchecked");

      await userEvent.click(toggle);
      expect(window.localStorage.getItem("daneel.telemetryConsent")).toBe(
        "granted",
      );
      expect(toggle).toHaveAttribute("data-state", "checked");

      await userEvent.click(toggle);
      expect(window.localStorage.getItem("daneel.telemetryConsent")).toBe(
        "denied",
      );
      expect(toggle).toHaveAttribute("data-state", "unchecked");
    },
  );

  it("disables the toggle and shows the dev-mode notice when running in dev", async () => {
    const Page = await loadPage({
      DEV: true,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    renderWithRouter(<Page />);

    const toggle = screen.getByTestId("telemetry-consent-toggle");
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText(/Disabled in development mode/i),
    ).toBeInTheDocument();
  });

  it("disables the toggle and shows the missing-key notice when VITE_POSTHOG_KEY is not configured", async () => {
    const Page = await loadPage({ DEV: false, VITE_POSTHOG_KEY: "" });
    renderWithRouter(<Page />);

    const toggle = screen.getByTestId("telemetry-consent-toggle");
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText(/Telemetry key not configured/i),
    ).toBeInTheDocument();
  });
});
