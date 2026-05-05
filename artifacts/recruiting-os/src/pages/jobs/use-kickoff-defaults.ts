import { useEffect, useRef, useState } from "react";

export type DataMode = "real" | "mock";

/**
 * The "kickoff approach" the recruiter picks for a real-data run. This
 * captures HOW the sourcing step should find candidates, in plain
 * recruiter-language, and is auto-defaulted from whichever real sourcing
 * provider is configured on the workspace:
 *
 *   - "jd-scout":         I have a job description → Scout (github / web search)
 *   - "example-profiles": I have a few example profiles → Extend (disabled, Phase 3)
 *   - "agent-explore":    Let an agent explore the web → Twin Agent Browser
 *
 * The selector is purely UX scaffolding right now — engine.ts continues to
 * dispatch to whatever sourcing provider is wired up in Settings → Marketplace.
 * The choice is persisted so the loader copy and any future per-mode hints
 * can react to it.
 */
export type KickoffApproach = "jd-scout" | "example-profiles" | "agent-explore";

export type KickoffDefaults = {
  dataMode: DataMode;
  runSourcing: boolean;
  approach: KickoffApproach;
  /**
   * True until the user explicitly clicks one of the toggles. Used by the
   * UI to render a "defaulted to X" hint paragraph that disappears the
   * instant the recruiter takes control.
   */
  userTouched: boolean;
  setDataMode: (v: DataMode) => void;
  setRunSourcing: (v: boolean) => void;
  setApproach: (v: KickoffApproach) => void;
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
  /**
   * Underlying provider types currently wired to the sourcing step (e.g.
   * `["twin_agent"]` or `["github", "web_search"]`). Used to default the
   * 3-mode kickoff approach selector to the right radio. Optional — when
   * omitted or empty, defaults to "jd-scout".
   */
  realSourcingProviderTypes?: string[],
): KickoffDefaults {
  const userTouchedRef = useRef(false);
  // Mirror the ref in state so the hint paragraph re-renders the moment
  // the user takes control. Refs alone don't trigger re-renders.
  const [userTouched, setUserTouched] = useState(false);
  const [dataMode, setDataModeState] = useState<DataMode>("mock");
  const [runSourcing, setRunSourcingState] = useState(false);
  const [approach, setApproachState] = useState<KickoffApproach>("jd-scout");
  const approachTouchedRef = useRef(false);

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

  // Auto-default the kickoff approach from whichever real provider is wired up.
  // Twin Agent Browser → "agent-explore"; GitHub/web search → "jd-scout".
  useEffect(() => {
    if (!jobLoaded) return;
    if (approachTouchedRef.current) return;
    const types = realSourcingProviderTypes ?? [];
    if (types.includes("twin_agent")) {
      setApproachState("agent-explore");
    } else if (types.length > 0) {
      setApproachState("jd-scout");
    }
  }, [jobLoaded, realSourcingProviderTypes]);

  const markTouched = () => {
    if (!userTouchedRef.current) {
      userTouchedRef.current = true;
      setUserTouched(true);
    }
  };

  return {
    dataMode,
    runSourcing,
    approach,
    userTouched,
    setDataMode: (v) => {
      markTouched();
      setDataModeState(v);
    },
    setRunSourcing: (v) => {
      markTouched();
      setRunSourcingState(v);
    },
    setApproach: (v) => {
      approachTouchedRef.current = true;
      setApproachState(v);
    },
    resetTouchFlag: () => {
      userTouchedRef.current = false;
      approachTouchedRef.current = false;
      setUserTouched(false);
    },
  };
}
