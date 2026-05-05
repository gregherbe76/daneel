import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Hoisted PostHog mock so the same singleton is observable across the
// dynamic `import("posthog-js")` inside telemetry.ts and across the
// `vi.resetModules()` we do in beforeEach.
const posthogMocks = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthogMocks }));

type TelemetryModule = typeof import("./telemetry");

async function loadTelemetry(env: {
  DEV?: boolean | string;
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
}): Promise<TelemetryModule> {
  vi.resetModules();
  vi.unstubAllEnvs();
  // Vitest's stubEnv accepts string|boolean for known boolean envs like DEV.
  vi.stubEnv("DEV", env.DEV === undefined ? "" : (env.DEV as never));
  if (env.VITE_POSTHOG_KEY !== undefined) {
    vi.stubEnv("VITE_POSTHOG_KEY", env.VITE_POSTHOG_KEY);
  } else {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
  }
  if (env.VITE_POSTHOG_HOST !== undefined) {
    vi.stubEnv("VITE_POSTHOG_HOST", env.VITE_POSTHOG_HOST);
  }
  return await import("./telemetry");
}

async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  window.localStorage.clear();
  posthogMocks.init.mockClear();
  posthogMocks.identify.mockClear();
  posthogMocks.capture.mockClear();
  posthogMocks.opt_out_capturing.mockClear();
  posthogMocks.reset.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("telemetry — environment short-circuits", () => {
  it("initIfConsented() does nothing in dev mode even when consent is granted and a key is configured", async () => {
    window.localStorage.setItem("daneel.telemetryConsent", "granted");
    const t = await loadTelemetry({
      DEV: true,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.initIfConsented();
    await flushMicrotasks();
    expect(posthogMocks.init).not.toHaveBeenCalled();
  });

  it("initIfConsented() does nothing when no PostHog key is configured", async () => {
    window.localStorage.setItem("daneel.telemetryConsent", "granted");
    const t = await loadTelemetry({ DEV: false, VITE_POSTHOG_KEY: "" });
    t.initIfConsented();
    await flushMicrotasks();
    expect(posthogMocks.init).not.toHaveBeenCalled();
  });

  it("initIfConsented() does nothing when consent has not been granted", async () => {
    // No consent stored at all.
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.initIfConsented();
    await flushMicrotasks();
    expect(posthogMocks.init).not.toHaveBeenCalled();
  });

  it("initIfConsented() initializes PostHog once consent is granted, key is set, and not in dev", async () => {
    window.localStorage.setItem("daneel.telemetryConsent", "granted");
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
      VITE_POSTHOG_HOST: "https://eu.i.posthog.com",
    });
    t.initIfConsented();
    await flushMicrotasks();
    expect(posthogMocks.init).toHaveBeenCalledTimes(1);
    expect(posthogMocks.init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({
        api_host: "https://eu.i.posthog.com",
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
      }),
    );
    expect(posthogMocks.identify).toHaveBeenCalledTimes(1);
  });
});

describe("telemetry — consent gating of track()", () => {
  it("track() is a no-op when consent has not been granted (no PostHog capture call)", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.track("workflow_started", { provider: "Native OpenAI" });
    await flushMicrotasks();
    expect(posthogMocks.capture).not.toHaveBeenCalled();
  });

  it("track() is a no-op when no key is configured even if consent is granted", async () => {
    window.localStorage.setItem("daneel.telemetryConsent", "granted");
    const t = await loadTelemetry({ DEV: false, VITE_POSTHOG_KEY: "" });
    t.track("workflow_started");
    await flushMicrotasks();
    expect(posthogMocks.capture).not.toHaveBeenCalled();
  });

  it("track() is a no-op in dev mode regardless of consent", async () => {
    window.localStorage.setItem("daneel.telemetryConsent", "granted");
    const t = await loadTelemetry({
      DEV: true,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.track("workflow_started");
    await flushMicrotasks();
    expect(posthogMocks.capture).not.toHaveBeenCalled();
  });

  it(
    "track() forwards the event to PostHog once consent is granted and init has run, " +
      "passing only the allow-listed payload (provider, workflow_step, timestamp)",
    async () => {
      const t = await loadTelemetry({
        DEV: false,
        VITE_POSTHOG_KEY: "phc_test_key",
      });

      t.setConsent(true);
      await flushMicrotasks();

      t.track("provider_connected", {
        provider: "Custom Webhook",
        workflow_step: "candidate_matching",
      });

      expect(posthogMocks.capture).toHaveBeenCalledTimes(1);
      const [eventName, payload] = posthogMocks.capture.mock.calls[0];
      expect(eventName).toBe("provider_connected");
      expect(payload).toMatchObject({
        provider: "Custom Webhook",
        workflow_step: "candidate_matching",
      });
      expect(typeof payload.timestamp).toBe("string");
      // No surprise fields snuck in beyond the three allow-listed keys.
      expect(Object.keys(payload).sort()).toEqual([
        "provider",
        "timestamp",
        "workflow_step",
      ]);
    },
  );

  it("track() omits provider/workflow_step from the payload when not provided", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.setConsent(true);
    await flushMicrotasks();

    t.track("workflow_started");
    expect(posthogMocks.capture).toHaveBeenCalledTimes(1);
    const [, payload] = posthogMocks.capture.mock.calls[0];
    expect(Object.keys(payload)).toEqual(["timestamp"]);
  });
});

describe("telemetry — anonymous id persistence", () => {
  it("generates a stable anonymous id on first init and persists it to localStorage", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });

    t.setConsent(true);
    await flushMicrotasks();

    const stored = window.localStorage.getItem("daneel.telemetryAnonId");
    expect(stored).toBeTruthy();
    expect(stored!.length).toBeGreaterThan(8);

    // identify() is called with the same id that was persisted.
    expect(posthogMocks.identify).toHaveBeenCalledWith(stored);
    // The same id is bootstrapped into PostHog init.
    expect(posthogMocks.init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({
        bootstrap: { distinctID: stored },
      }),
    );
  });

  it("reuses the existing anonymous id from localStorage instead of generating a new one", async () => {
    window.localStorage.setItem("daneel.telemetryAnonId", "fixed-anon-id-123");
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.setConsent(true);
    await flushMicrotasks();

    expect(window.localStorage.getItem("daneel.telemetryAnonId")).toBe(
      "fixed-anon-id-123",
    );
    expect(posthogMocks.identify).toHaveBeenCalledWith("fixed-anon-id-123");
  });
});

describe("telemetry — consent revocation clears state", () => {
  it(
    "setConsent(false) after a granted+initialized session opts out of capture, " +
      "resets PostHog, persists 'denied', and stops further track() calls",
    async () => {
      const t = await loadTelemetry({
        DEV: false,
        VITE_POSTHOG_KEY: "phc_test_key",
      });

      // Grant first so we're fully initialized.
      t.setConsent(true);
      await flushMicrotasks();
      expect(posthogMocks.init).toHaveBeenCalledTimes(1);

      // A track call here should fire.
      t.track("workflow_started");
      expect(posthogMocks.capture).toHaveBeenCalledTimes(1);

      // Now revoke.
      t.setConsent(false);

      expect(posthogMocks.opt_out_capturing).toHaveBeenCalledTimes(1);
      expect(posthogMocks.reset).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem("daneel.telemetryConsent")).toBe(
        "denied",
      );
      expect(t.getConsent()).toBe("denied");

      // Subsequent track() must not reach PostHog.
      posthogMocks.capture.mockClear();
      t.track("workflow_completed");
      expect(posthogMocks.capture).not.toHaveBeenCalled();
    },
  );

  it("subscribeConsent() listeners fire on setConsent and stop firing after unsubscribe", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    const listener = vi.fn();
    const unsubscribe = t.subscribeConsent(listener);

    t.setConsent(true);
    expect(listener).toHaveBeenCalledTimes(1);

    t.setConsent(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    t.setConsent(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
