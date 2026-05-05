import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const posthogMocks = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthogMocks }));

async function loadBanner(env: {
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
  const mod = await import("./telemetry-consent-banner");
  return mod.TelemetryConsentBanner;
}

beforeEach(() => {
  window.localStorage.clear();
  posthogMocks.init.mockClear();
  posthogMocks.identify.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TelemetryConsentBanner — visibility gating", () => {
  it("renders when consent is null, key is set, and not in dev mode", async () => {
    const Banner = await loadBanner({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    render(<Banner />);
    expect(screen.getByTestId("telemetry-consent-banner")).toBeInTheDocument();
    expect(screen.getByTestId("telemetry-consent-yes")).toBeInTheDocument();
    expect(screen.getByTestId("telemetry-consent-no")).toBeInTheDocument();
  });

  it("stays hidden in dev mode even when consent is null and key is set", async () => {
    const Banner = await loadBanner({
      DEV: true,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    render(<Banner />);
    expect(
      screen.queryByTestId("telemetry-consent-banner"),
    ).not.toBeInTheDocument();
  });

  it("stays hidden when no PostHog key is configured", async () => {
    const Banner = await loadBanner({ DEV: false, VITE_POSTHOG_KEY: "" });
    render(<Banner />);
    expect(
      screen.queryByTestId("telemetry-consent-banner"),
    ).not.toBeInTheDocument();
  });

  it("stays hidden when consent has already been granted", async () => {
    window.localStorage.setItem("daneel.telemetryConsent", "granted");
    const Banner = await loadBanner({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    render(<Banner />);
    expect(
      screen.queryByTestId("telemetry-consent-banner"),
    ).not.toBeInTheDocument();
  });

  it("stays hidden when consent has already been denied", async () => {
    window.localStorage.setItem("daneel.telemetryConsent", "denied");
    const Banner = await loadBanner({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    render(<Banner />);
    expect(
      screen.queryByTestId("telemetry-consent-banner"),
    ).not.toBeInTheDocument();
  });
});

describe("TelemetryConsentBanner — choice handling", () => {
  it("clicking Yes persists 'granted' to localStorage and removes the banner", async () => {
    const Banner = await loadBanner({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    render(<Banner />);

    await userEvent.click(screen.getByTestId("telemetry-consent-yes"));

    expect(window.localStorage.getItem("daneel.telemetryConsent")).toBe(
      "granted",
    );
    expect(
      screen.queryByTestId("telemetry-consent-banner"),
    ).not.toBeInTheDocument();
  });

  it("clicking No persists 'denied' to localStorage and removes the banner", async () => {
    const Banner = await loadBanner({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    render(<Banner />);

    await userEvent.click(screen.getByTestId("telemetry-consent-no"));

    expect(window.localStorage.getItem("daneel.telemetryConsent")).toBe(
      "denied",
    );
    expect(
      screen.queryByTestId("telemetry-consent-banner"),
    ).not.toBeInTheDocument();
  });

  it(
    "does not re-render once a choice is recorded — even after a fresh mount " +
      "in the same browser session",
    async () => {
      const Banner = await loadBanner({
        DEV: false,
        VITE_POSTHOG_KEY: "phc_test_key",
      });

      // First mount: user clicks Yes.
      const { unmount } = render(<Banner />);
      await userEvent.click(screen.getByTestId("telemetry-consent-yes"));
      expect(
        screen.queryByTestId("telemetry-consent-banner"),
      ).not.toBeInTheDocument();
      unmount();
      cleanup();

      // Second mount, same browser session — banner must stay hidden.
      render(<Banner />);
      expect(
        screen.queryByTestId("telemetry-consent-banner"),
      ).not.toBeInTheDocument();
    },
  );
});
