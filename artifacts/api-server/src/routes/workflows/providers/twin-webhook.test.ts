import { describe, expect, it } from "vitest";
import { normaliseSourcingResponse } from "./twin-webhook";

function validRow(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    headline: "h",
    location: "l",
    currentCompany: "c",
    email: `${name}@example.com`,
    linkedinUrl: `https://linkedin.com/in/${name}`,
    githubUrl: `https://github.com/${name}`,
    skills: ["s"],
    summary: "sum",
    evidence: "ev",
    potentialRisks: "r",
    source: "Twin Agent",
    ...overrides,
  };
}

function asObject(result: ReturnType<typeof normaliseSourcingResponse>) {
  if (Array.isArray(result)) throw new Error("expected { candidates, stats }");
  return result;
}

describe("normaliseSourcingResponse", () => {
  it("accepts a bare candidate array and synthesises stats", () => {
    const result = asObject(
      normaliseSourcingResponse([validRow("alice"), validRow("bob")]),
    );
    expect(result.candidates).toHaveLength(2);
    expect(result.stats?.returnedCount).toBe(2);
    expect(result.stats?.extractedCount).toBe(2);
    expect(result.stats?.droppedInvalid).toBe(0);
  });

  it("accepts { candidates, stats } and returns parsed candidates", () => {
    const result = asObject(
      normaliseSourcingResponse({
        candidates: [validRow("alice")],
        stats: { searchTotalCount: 50, consideredCount: 10 },
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.stats?.returnedCount).toBe(1);
    expect(result.stats?.searchTotalCount).toBe(50);
    expect(result.stats?.consideredCount).toBe(10);
  });

  it("counts rows missing name or identity as droppedInvalid", () => {
    const result = asObject(
      normaliseSourcingResponse([
        validRow("alice"),
        validRow("bob", { name: "" }),
        validRow("carol", { email: "", linkedinUrl: "", githubUrl: "" }),
        null,
        "not an object",
        validRow("dave", { name: "   " }),
      ]),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.name).toBe("alice");
    expect(result.stats?.returnedCount).toBe(1);
    expect(result.stats?.droppedInvalid).toBe(5);
    expect(result.stats?.extractedCount).toBe(6);
  });

  it("preserves upstream stats and adds locally-observed drops", () => {
    const result = asObject(
      normaliseSourcingResponse({
        candidates: [
          validRow("alice"),
          validRow("bob", { name: "" }),
        ],
        stats: {
          searchTotalCount: 100,
          consideredCount: 25,
          extractedCount: 20,
          droppedNoBio: 5,
          droppedStale: 3,
          droppedInvalid: 2,
          returnedCount: 999,
        },
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.stats?.searchTotalCount).toBe(100);
    expect(result.stats?.consideredCount).toBe(25);
    expect(result.stats?.extractedCount).toBe(20);
    expect(result.stats?.droppedNoBio).toBe(5);
    expect(result.stats?.droppedStale).toBe(3);
    expect(result.stats?.droppedInvalid).toBe(3);
    expect(result.stats?.returnedCount).toBe(1);
  });
});
