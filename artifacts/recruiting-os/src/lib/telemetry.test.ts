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

  it("track() rejects events outside the whitelist (does not call capture)", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.setConsent(true);
    await flushMicrotasks();

    // Bypass the TS union to simulate a future caller drifting from the contract.
    (t.track as unknown as (e: string, p?: unknown) => void)(
      "candidate_clicked",
      { provider: "x" },
    );
    (t.track as unknown as (e: string, p?: unknown) => void)("page_view");

    expect(posthogMocks.capture).not.toHaveBeenCalled();
  });

  it(
    "track() strips payload keys outside the {provider, workflow_step, timestamp} " +
      "allow-list — no candidate PII or JD content can leak through",
    async () => {
      const t = await loadTelemetry({
        DEV: false,
        VITE_POSTHOG_KEY: "phc_test_key",
      });
      t.setConsent(true);
      await flushMicrotasks();

      (t.track as unknown as (
        e: string,
        p?: Record<string, unknown>,
      ) => void)("workflow_started", {
        provider: "GitHub Agent",
        workflow_step: "sourcing",
        // The following must NEVER reach posthog.capture():
        candidateEmail: "alice@example.com",
        candidateName: "Alice Example",
        jobDescription: "secret JD body",
        userId: 42,
      });

      expect(posthogMocks.capture).toHaveBeenCalledTimes(1);
      const [event, payload] = posthogMocks.capture.mock.calls[0];
      expect(event).toBe("workflow_started");
      expect(Object.keys(payload).sort()).toEqual([
        "provider",
        "timestamp",
        "workflow_step",
      ]);
      expect(payload.provider).toBe("GitHub Agent");
      expect(payload.workflow_step).toBe("sourcing");
      expect(payload).not.toHaveProperty("candidateEmail");
      expect(payload).not.toHaveProperty("candidateName");
      expect(payload).not.toHaveProperty("jobDescription");
      expect(payload).not.toHaveProperty("userId");
    },
  );
});

describe("telemetry — recent events ring buffer", () => {
  it("records fired events with event name, timestamp, and sorted payload keys", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.setConsent(true);
    await flushMicrotasks();

    expect(t.getRecentEvents()).toEqual([]);

    t.track("provider_connected", {
      provider: "Custom Webhook",
      workflow_step: "candidate_matching",
    });
    t.track("workflow_started");

    const recent = t.getRecentEvents();
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({
      event: "provider_connected",
      payloadKeys: ["provider", "timestamp", "workflow_step"],
    });
    expect(typeof recent[0].timestamp).toBe("string");
    expect(recent[1]).toMatchObject({
      event: "workflow_started",
      payloadKeys: ["timestamp"],
    });
  });

  it(
    "the recent buffer never stores raw payload values — even when callers pass " +
      "PII-shaped fields, only the (already-stripped) key names are recorded",
    async () => {
      const t = await loadTelemetry({
        DEV: false,
        VITE_POSTHOG_KEY: "phc_test_key",
      });
      t.setConsent(true);
      await flushMicrotasks();

      (t.track as unknown as (
        e: string,
        p?: Record<string, unknown>,
      ) => void)("workflow_started", {
        provider: "GitHub Agent",
        workflow_step: "sourcing",
        candidateEmail: "alice@example.com",
        candidateName: "Alice Example",
        jobDescription: "secret JD body",
      });

      const recent = t.getRecentEvents();
      expect(recent).toHaveLength(1);
      const entry = recent[0];

      // Only key NAMES from the allow-listed surface — never values, never the
      // forbidden field names that the caller tried to slip in.
      expect(entry.payloadKeys).toEqual([
        "provider",
        "timestamp",
        "workflow_step",
      ]);
      expect(entry.payloadKeys).not.toContain("candidateEmail");
      expect(entry.payloadKeys).not.toContain("candidateName");
      expect(entry.payloadKeys).not.toContain("jobDescription");

      // Walk every property of the buffer entry and ensure no raw value leaked.
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain("alice@example.com");
      expect(serialized).not.toContain("Alice Example");
      expect(serialized).not.toContain("secret JD body");
      expect(serialized).not.toContain("GitHub Agent");

      // Buffer entry should expose exactly these three top-level fields.
      expect(Object.keys(entry).sort()).toEqual([
        "event",
        "payloadKeys",
        "timestamp",
      ]);
    },
  );

  it("caps the ring buffer at 20 entries, dropping the oldest first", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.setConsent(true);
    await flushMicrotasks();

    for (let i = 0; i < 25; i++) {
      t.track("workflow_started", { provider: `p-${i}` });
    }
    const recent = t.getRecentEvents();
    expect(recent).toHaveLength(20);
  });

  it("does not record entries for events that never reach posthog.capture (e.g. no consent)", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    // No consent granted.
    t.track("workflow_started");
    expect(t.getRecentEvents()).toEqual([]);
  });

  it("subscribeRecentEvents() listeners fire on each recorded event and stop after unsubscribe", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });
    t.setConsent(true);
    await flushMicrotasks();

    const listener = vi.fn();
    const unsubscribe = t.subscribeRecentEvents(listener);

    t.track("workflow_started");
    expect(listener).toHaveBeenCalledTimes(1);

    t.track("workflow_completed");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    t.track("provider_card_viewed");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("telemetry — compile-time payload guard", () => {
  it("rejects forbidden payload keys and unknown event names at compile time", async () => {
    const t = await loadTelemetry({
      DEV: false,
      VITE_POSTHOG_KEY: "phc_test_key",
    });

    // These calls must compile cleanly — they match the contract.
    t.track("workflow_started");
    t.track("workflow_started", { provider: "Native OpenAI" });
    t.track("provider_connected", {
      provider: "Custom Webhook",
      workflow_step: "candidate_matching",
    });

    // @ts-expect-error — `candidateEmail` is not in TelemetryProps.
    t.track("workflow_started", { provider: "x", candidateEmail: "a@b.com" });

    // @ts-expect-error — `userId` is not in TelemetryProps.
    t.track("workflow_completed", { userId: 42 });

    // @ts-expect-error — event name is not in the TelemetryEvent union.
    t.track("not_a_real_event", {});

    // @ts-expect-error — typo'd event name.
    t.track("provider_conected", { provider: "x" });

    // The runtime-side behaviour of these guards is exhaustively covered by
    // the other suites; this test exists purely so `pnpm typecheck` fails if
    // the type-level guard ever regresses.
    expect(true).toBe(true);
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
