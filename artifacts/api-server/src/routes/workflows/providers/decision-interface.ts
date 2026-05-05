/**
 * DecisionProvider — separate from AgentProvider because the shape of the
 * decision step's I/O is fundamentally different from the existing pipeline
 * steps. A decision provider deliberates on ONE candidate at a time and
 * returns a structured deliberation (convergence / divergence / orientations
 * / per-pole signals) rather than a prompt-style result.
 *
 * The only built-in decision provider today is Council. Any new decision
 * provider must:
 *   1. Implement this interface
 *   2. Be wired into providers/registry.ts → buildDecisionProvider()
 *   3. Be added to the provider_type DB enum
 *   4. Only be selectable for the `decision` workflow step in the UI
 */

import type { Deliberation, DeliberationResult } from "@workspace/db";

/**
 * The application-stage context for a deliberation. Mirrors the high-level
 * stages in the application pipeline (kept loose / free-text so adding new
 * pipeline stages doesn't ripple here).
 */
export type DeliberationStage =
  | "Sourced"
  | "Screening"
  | "Interview"
  | "Offer"
  | "Hired";

export interface DeliberationCandidateInput {
  id: number;
  name: string;
  email: string | null;
  headline: string | null;
  summary: string | null;
  skills: string[];
  linkedIn: string | null;
  githubUrl: string | null;
  location: string | null;
  currentCompany: string | null;
}

export interface DeliberationJobInput {
  id: number;
  title: string;
  description: string;
  seniority: string | null;
  mustHaveSkills: string[];
  location: string | null;
}

export interface DeliberateInput {
  candidate: DeliberationCandidateInput;
  jd: DeliberationJobInput;
  stage: DeliberationStage;
}

/**
 * Typed error thrown by a DecisionProvider when the upstream service signals
 * the recruiter has hit their plan quota (HTTP 402). The deliberations API
 * layer catches this and surfaces it to the UI so we can show a clear
 * "Upgrade on Council" CTA rather than a generic failure.
 */
export class DecisionQuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  readonly upgradeUrl?: string;
  constructor(message: string, upgradeUrl?: string) {
    super(message);
    this.name = "DecisionQuotaExceededError";
    this.upgradeUrl = upgradeUrl;
  }
}

export interface DecisionProvider {
  readonly id: number;
  readonly name: string;
  readonly type: string;

  /**
   * Run a deliberation for a single candidate against a single job.
   * Throws DecisionQuotaExceededError on 402 from the upstream service.
   */
  deliberate(input: DeliberateInput): Promise<DeliberationResult>;

  /** Lightweight reachability + auth check used by the "Test Connection" UI. */
  validateConnection(): Promise<{ ok: boolean; error?: string }>;
}

export type { Deliberation, DeliberationResult };
