export type WorkflowStep =
  | "job_understanding"
  | "candidate_matching"
  | "shortlist_generation"
  | "sourcing_later"
  | "sourcing";

export interface AgentProviderRunInput {
  step: WorkflowStep;
  runId: number;
  jobId: number;
  payload: Record<string, unknown>;
}

export interface AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type: string;

  /**
   * Execute a workflow step.  Must return a parsed result object.
   */
  run(input: AgentProviderRunInput): Promise<unknown>;

  /**
   * Test the provider connection / reachability.
   * Returns { ok: true } or { ok: false, error: string }
   */
  validateConnection(): Promise<{ ok: boolean; error?: string }>;
}
