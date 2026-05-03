/**
 * Workflow step names.
 *
 * Each step maps to a phase of the agentic recruiting pipeline.
 * When adding a new step:
 *   1. Add its name here
 *   2. Implement a step function in engine.ts
 *   3. Call it from runWorkflowEngine()
 *   4. Optionally handle it in a provider's run() method
 *   5. Add it to the workflow_provider_settings UI (it appears automatically)
 */
export type WorkflowStep =
  | "job_understanding"      // Parses job description → structured evaluation criteria
  | "candidate_matching"     // Scores each candidate 0–100 with explainable reasoning
  | "shortlist_generation"   // Summarises the top-5 candidates for the hiring manager
  | "sourcing_later"         // Reserved — not yet implemented
  | "sourcing"               // Generates or retrieves candidate profiles
  | "enrichment";            // Enriches existing profiles with additional signals

/**
 * Input passed to every provider.run() call.
 *
 * The engine always provides runId and jobId for logging and DB writes.
 * `payload` is step-specific — see individual provider implementations
 * and native-openai.ts for the expected shape per step.
 */
export interface AgentProviderRunInput {
  step: WorkflowStep;
  runId: number;
  jobId: number;
  payload: Record<string, unknown>;
}

/**
 * The single interface every provider must implement.
 *
 * To add a new provider:
 *   1. Create a class that implements AgentProvider (see examples/custom-provider.md)
 *   2. Set a unique `type` string (e.g. "my_provider")
 *   3. Register the type in providers/registry.ts → buildProvider()
 *   4. Add the type to the DB enum in lib/db/src/schema/agent-providers.ts
 *   5. Add it to ProviderType in lib/api-spec/openapi.yaml → run codegen
 *
 * Built-in implementations:
 *   - NativeOpenAIProvider        (native_openai)   — GPT prompts for all core steps
 *   - NativeOpenAISourcingProvider (native_openai)  — Mock candidate generation
 *   - NativeOpenAIEnrichmentProvider (native_openai) — Profile enrichment
 *   - CustomWebhookProvider       (custom_webhook)  — Generic HTTP POST
 *   - TwinWebhookProvider         (twin_webhook)    — Step-routed webhook system
 */
export interface AgentProvider {
  /**
   * Unique database ID for this provider instance.
   * Set to -1 for native fallback providers that are not stored in the DB.
   */
  readonly id: number;

  /**
   * Human-readable display name shown in the Settings UI and run logs.
   */
  readonly name: string;

  /**
   * Discriminator string used by the registry to instantiate the correct class.
   * Must match the value in the `provider_type` DB enum.
   */
  readonly type: string;

  /**
   * Execute a workflow step.
   *
   * The engine calls this with step-specific data in `input.payload`.
   * Return value must match the expected result shape for the step:
   *   - job_understanding    → JobInsightResult
   *   - candidate_matching   → CandidateMatchResult[]
   *   - shortlist_generation → ShortlistResult[]
   *   - sourcing             → SourcingCandidate[]
   *   - enrichment           → EnrichmentResult[]
   *
   * Throw on error — the engine will catch and log the failure, then
   * decide whether to continue or abort the run based on step criticality.
   */
  run(input: AgentProviderRunInput): Promise<unknown>;

  /**
   * Test the provider connection / reachability.
   *
   * Called by the "Test Connection" button in Settings → Agent Providers.
   * Should make a lightweight request to verify credentials and reachability.
   * Never throw — always return { ok: false, error: string } on failure.
   */
  validateConnection(): Promise<{ ok: boolean; error?: string }>;
}
