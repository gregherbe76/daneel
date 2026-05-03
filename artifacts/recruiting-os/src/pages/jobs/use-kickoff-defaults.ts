import { useEffect, useRef, useState } from "react";

export type DataMode = "real" | "mock";

export type KickoffDefaults = {
  dataMode: DataMode;
  runSourcing: boolean;
  /**
   * True until the user explicitly clicks one of the toggles. Used by the
   * UI to render a "defaulted to X" hint paragraph that disappears the
   * instant the recruiter takes control.
   */
  userTouched: boolean;
  setDataMode: (v: DataMode) => void;
  setRunSourcing: (v: boolean) => void;
  /**
   * Reset the "user touched" flag. Call this when navigating to a
   * different job so the new job's defaults can kick in fresh.
   */
  resetTouchFlag: () => void;
};

/**
 * Encapsulates the workflow kickoff modal's auto-defaulting behavior.
 *
 * Rules (Task #83):
 *   - Until the job query resolves, render mock + sourcing-off so the UI
 *     never flashes a destructive default.
 *   - Once the job loads, if it has a real sourcing provider configured
 *     (GitHub Agent or Web Search), promote both toggles to Real + Run
 *     Sourcing on. Otherwise stay on mock + off.
 *   - The promotion is one-shot per job: once the recruiter explicitly
 *     toggles either control, never auto-override their choice on a
 *     subsequent job refetch.
 *   - When the parent switches to a different job, call resetTouchFlag()
 *     so the new job's defaults can apply fresh.
 */
export function useKickoffDefaults(
  realSourcingAvailable: boolean | undefined,
  jobLoaded: boolean,
): KickoffDefaults {
  const userTouchedRef = useRef(false);
  // Mirror the ref in state so the hint paragraph re-renders the moment
  // the user takes control. Refs alone don't trigger re-renders.
  const [userTouched, setUserTouched] = useState(false);
  const [dataMode, setDataModeState] = useState<DataMode>("mock");
  const [runSourcing, setRunSourcingState] = useState(false);

  useEffect(() => {
    if (!jobLoaded) return;
    if (userTouchedRef.current) return;
    if (realSourcingAvailable) {
      setDataModeState("real");
      setRunSourcingState(true);
    } else {
      setDataModeState("mock");
      setRunSourcingState(false);
    }
  }, [jobLoaded, realSourcingAvailable]);

  const markTouched = () => {
    if (!userTouchedRef.current) {
      userTouchedRef.current = true;
      setUserTouched(true);
    }
  };

  return {
    dataMode,
    runSourcing,
    userTouched,
    setDataMode: (v) => {
      markTouched();
      setDataModeState(v);
    },
    setRunSourcing: (v) => {
      markTouched();
      setRunSourcingState(v);
    },
    resetTouchFlag: () => {
      userTouchedRef.current = false;
      setUserTouched(false);
    },
  };
}
