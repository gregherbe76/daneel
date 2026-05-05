// Compile-time-only assertions for the telemetry contract.
//
// This file is intentionally NOT named `*.test.ts` so it is included by
// `tsc --noEmit` (the recruiting-os tsconfig excludes `**/*.test.ts`). It
// runs as part of `pnpm typecheck` and acts as a tripwire: if anyone
// loosens `TelemetryEvent` or `TelemetryProps` such that PII keys or
// unknown event names slip through again, this file fails the build.
//
// There is no runtime behaviour here — every `track()` call is unreachable.

import { track, type TelemetryProps } from "./telemetry";

// Guard against accidental dead-code-elimination warnings.
export const __telemetryTypeTest = (): void => {
  if (Math.random() < 0) {
    // ── Valid call shapes (must compile cleanly) ───────────────────────────
    track("workflow_started");
    track("workflow_started", { provider: "Native OpenAI" });
    track("provider_connected", {
      provider: "Custom Webhook",
      workflow_step: "candidate_matching",
    });
    track("providers_marketplace_opened");

    // ── Forbidden payload keys (object literal) ────────────────────────────
    // @ts-expect-error — `candidateEmail` is not in TelemetryProps.
    track("workflow_started", { provider: "x", candidateEmail: "a@b.com" });

    // @ts-expect-error — `userId` is not in TelemetryProps.
    track("workflow_completed", { userId: 42 });

    // ── Forbidden payload keys (intermediate variable) ─────────────────────
    // The mapped-type guard must also fire when the payload is built up in
    // a variable, where TS's normal excess-property check does NOT apply.
    const leakyPayload = {
      provider: "GitHub Agent",
      candidateName: "Alice Example",
    };
    // @ts-expect-error — `candidateName` makes `leakyPayload` incompatible.
    track("workflow_started", leakyPayload);

    // ── Unknown / typo'd event names ───────────────────────────────────────
    // @ts-expect-error — event name is not in the TelemetryEvent union.
    track("not_a_real_event", {});

    // @ts-expect-error — typo'd event name.
    track("provider_conected", { provider: "x" });

    // ── Sanity: TelemetryProps stays optional and string-typed ─────────────
    const _p: TelemetryProps = { provider: "x", workflow_step: "y" };
    void _p;
  }
};
