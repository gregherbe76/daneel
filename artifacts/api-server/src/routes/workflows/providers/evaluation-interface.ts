/**
 * EvaluationProvider — separate from AgentProvider because the shape of the
 * `technical_evaluation` step's I/O is fundamentally different from the
 * existing prompt-style pipeline steps. An evaluation provider scores ONE
 * candidate at a time on five technical dimensions and returns explicit
 * strengths/red-flags rather than a free-form prompt result.
 *
 * Today the only built-in evaluation provider is CodeMatch (closed-source
 * SaaS at https://assess.codes). Any new evaluation provider must:
 *   1. Implement this interface
 *   2. Be wired into providers/registry.ts → buildEvaluationProvider()
 *   3. Be added to the provider_type DB enum
 *   4. Only be selectable for the `technical_evaluation` workflow step in
 *      the UI
 *
 * The engine never recomputes `overall` — each provider owns its own
 * weighting model, and overwriting it here would silently drift from the
 * provider's published methodology.
 */

export interface EvaluationCandidateInput {
  id: number;
  name: string;
  githubUsername: string | null;
  githubUrl: string | null;
}

export interface EvaluateInput {
  candidate: EvaluationCandidateInput;
  jobId: number;
  runId: number;
}

/**
 * Five technical dimensions returned by every evaluation provider. All values
 * are 0-100. `overall` is the provider's composite — see provider docs.
 */
export interface TechnicalScores {
  technical_depth: number;
  ownership: number;
  consistency: number;
  taste: number;
  impact: number;
  overall: number;
}

/**
 * Stable error codes surfaced by every evaluation provider. The UI maps
 * these to user-facing copy ("CodeMatch user not Premium", "Rate limited",
 * etc.) and reports surface them in the "Score Reliability" section.
 */
export type EvaluationErrorCode =
  | "no_github_username"
  | "auth_failed"
  | "premium_required"
  | "github_user_not_found"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network_error"
  | "invalid_response";

export interface EvaluationResult {
  evaluated: boolean;
  provider_name: string;
  provider_type: string;
  scores: TechnicalScores | null;
  strengths: string[];
  red_flags: string[];
  summary: string;
  evaluated_at: string;
  report_url: string | null;
  error: EvaluationErrorCode | null;
}

export interface EvaluationProvider {
  readonly id: number;
  readonly name: string;
  readonly type: string;

  /**
   * Score one candidate. Never throws on operational failures — returns an
   * `evaluated: false` result with a stable `error` code so the engine can
   * persist a row explaining why the candidate wasn't scored.
   */
  evaluate(input: EvaluateInput): Promise<EvaluationResult>;

  /** Lightweight reachability + auth check used by the "Test Connection" UI. */
  validateConnection(): Promise<{ ok: boolean; error?: string }>;
}
