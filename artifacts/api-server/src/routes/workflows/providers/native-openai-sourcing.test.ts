import { describe, expect, it, vi, beforeEach } from "vitest";

const create = vi.fn();
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => create(...args) } } },
}));

import { NativeOpenAISourcingProvider } from "./native-openai-sourcing";
import type { AgentProviderRunInput } from "./interface";

const baseInput: AgentProviderRunInput = {
  step: "sourcing",
  runId: 1,
  jobId: 1,
  payload: {
    job: {
      title: "Senior Engineer",
      description: "desc",
      location: "Remote",
      seniority: "senior",
      mustHaveSkills: ["TypeScript"],
    },
    insight: {
      idealCandidateProfile: "ideal",
      evaluationCriteria: ["criterion"],
    },
  },
};

function llmResponse(rows: unknown[]) {
  return {
    choices: [{ message: { content: JSON.stringify(rows) } }],
  };
}

function validRow(name: string) {
  return {
    name,
    headline: "h",
    location: "l",
    currentCompany: "c",
    email: `${name}.mock@example.com`,
    linkedinUrl: `https://linkedin.com/in/${name}`,
    githubUrl: `https://github.com/${name}`,
    skills: ["s"],
    summary: "sum",
    evidence: "ev",
    potentialRisks: "r",
    source: "AI Generated / Mock Sourcing",
  };
}

describe("NativeOpenAISourcingProvider.run", () => {
  beforeEach(() => create.mockReset());

  it("returns { candidates, stats } reflecting the LLM response", async () => {
    create.mockResolvedValue(llmResponse([validRow("alice"), validRow("bob"), validRow("carol")]));
    const provider = new NativeOpenAISourcingProvider(1, "Mock");

    const result = await provider.run(baseInput);
    if (Array.isArray(result)) throw new Error("expected object form");

    expect(result.candidates).toHaveLength(3);
    expect(result.stats?.returnedCount).toBe(3);
    expect(result.stats?.extractedCount).toBe(3);
    expect(result.stats?.droppedInvalid).toBe(0);
    expect(result.candidates[0]?.emailSource).toBe("generated");
  });

  it("counts rows missing a name as droppedInvalid", async () => {
    create.mockResolvedValue(
      llmResponse([
        validRow("alice"),
        { ...validRow("bob"), name: "" },
        { ...validRow("carol"), name: "   " },
        validRow("dave"),
      ]),
    );
    const provider = new NativeOpenAISourcingProvider(1, "Mock");

    const result = await provider.run(baseInput);
    if (Array.isArray(result)) throw new Error("expected object form");

    expect(result.candidates).toHaveLength(2);
    expect(result.stats?.returnedCount).toBe(2);
    expect(result.stats?.extractedCount).toBe(4);
    expect(result.stats?.droppedInvalid).toBe(2);
  });

  it("sets emailSource to null when the LLM omitted an email", async () => {
    const row = { ...validRow("alice"), email: "" };
    create.mockResolvedValue(llmResponse([row]));
    const provider = new NativeOpenAISourcingProvider(1, "Mock");

    const result = await provider.run(baseInput);
    if (Array.isArray(result)) throw new Error("expected object form");
    expect(result.candidates[0]?.emailSource).toBe(null);
  });
});
