/**
 * Local mirror of the OpenAPI Deliberation* schemas. The shared `@workspace/api-zod`
 * package only exports runtime Zod validators, not TS types, so we keep a thin
 * type-only mirror here. Keep this in sync with `lib/api-spec/openapi.yaml` —
 * the server already validates payloads against the same schemas at the edge.
 */

export interface DeliberationPole {
  id: string;
  name: string;
  verdict: string;
  signal: number;
  reasoning: string;
}

export interface DeliberationOrientation {
  title: string;
  detail: string;
}

export interface DeliberationResultPayload {
  convergence: { summary: string; verdict: string };
  divergence: { summary: string; axes: string[] };
  orientations: DeliberationOrientation[];
  poles: DeliberationPole[];
}

export type DeliberationStatus = "pending" | "running" | "completed" | "failed";

export interface DeliberationRecord {
  id: number;
  candidateId: number;
  jobId: number;
  runId?: number | null;
  stage: string;
  status: DeliberationStatus;
  result?: DeliberationResultPayload | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}
