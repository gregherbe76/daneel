import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useKickoffDefaults } from "./use-kickoff-defaults";

describe("useKickoffDefaults", () => {
  it("starts on mock + sourcing-off before the job has loaded", () => {
    const { result } = renderHook(() =>
      useKickoffDefaults(/* realSourcingAvailable */ true, /* jobLoaded */ false),
    );
    expect(result.current.dataMode).toBe("mock");
    expect(result.current.runSourcing).toBe(false);
    expect(result.current.userTouched).toBe(false);
  });

  it("promotes to Real + sourcing-on once the job loads with a real provider", () => {
    const { result, rerender } = renderHook(
      ({ available, loaded }) => useKickoffDefaults(available, loaded),
      { initialProps: { available: true, loaded: false } },
    );
    expect(result.current.dataMode).toBe("mock");
    rerender({ available: true, loaded: true });
    expect(result.current.dataMode).toBe("real");
    expect(result.current.runSourcing).toBe(true);
    expect(result.current.userTouched).toBe(false);
  });

  it("stays on mock + sourcing-off when the job has no real sourcing provider", () => {
    const { result, rerender } = renderHook(
      ({ available, loaded }) => useKickoffDefaults(available, loaded),
      { initialProps: { available: false, loaded: false } },
    );
    rerender({ available: false, loaded: true });
    expect(result.current.dataMode).toBe("mock");
    expect(result.current.runSourcing).toBe(false);
  });

  it("never auto-overrides an explicit user choice on a later refetch", () => {
    const { result, rerender } = renderHook(
      ({ available, loaded }) => useKickoffDefaults(available, loaded),
      { initialProps: { available: true, loaded: true } },
    );
    expect(result.current.dataMode).toBe("real");

    // Recruiter opts out of real mode.
    act(() => result.current.setDataMode("mock"));
    expect(result.current.dataMode).toBe("mock");
    expect(result.current.userTouched).toBe(true);

    // Simulate a job refetch — same job, same flag, just a new query
    // reference. The hook must NOT silently flip back to "real".
    rerender({ available: true, loaded: true });
    expect(result.current.dataMode).toBe("mock");

    // And toggling runSourcing off should also stick across a refetch.
    act(() => result.current.setRunSourcing(false));
    rerender({ available: true, loaded: true });
    expect(result.current.runSourcing).toBe(false);
  });

  it("resetTouchFlag re-enables defaulting (used when switching jobs)", () => {
    const { result, rerender } = renderHook(
      ({ available, loaded }) => useKickoffDefaults(available, loaded),
      { initialProps: { available: false, loaded: true } },
    );
    expect(result.current.dataMode).toBe("mock");

    // User explicitly upgrades to Real on this mock-only job.
    act(() => result.current.setDataMode("real"));
    expect(result.current.userTouched).toBe(true);

    // Navigate to a new job that DOES have a real provider. Without
    // resetting the touched flag the auto-default would be skipped.
    act(() => result.current.resetTouchFlag());
    rerender({ available: true, loaded: true });
    expect(result.current.dataMode).toBe("real");
    expect(result.current.runSourcing).toBe(true);
    expect(result.current.userTouched).toBe(false);
  });

  it("reflects userTouched in the returned state so hints can re-render", () => {
    const { result } = renderHook(() => useKickoffDefaults(true, true));
    expect(result.current.userTouched).toBe(false);
    act(() => result.current.setRunSourcing(false));
    expect(result.current.userTouched).toBe(true);
  });
});
