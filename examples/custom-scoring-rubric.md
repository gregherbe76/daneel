# Example: Custom Scoring Rubric

This example shows how to change the scoring dimensions, weights, and recommendation thresholds used during candidate matching.

All scoring logic lives in one file:

```
artifacts/api-server/src/routes/workflows/providers/native-openai.ts
→ NativeOpenAIProvider.runCandidateMatching()
```

---

## Default rubric

The default rubric uses 4 dimensions scored 0–100 each, with weights that sum to 1.0:

| Dimension | Weight | What it measures |
|---|---|---|
| `skillsMatch` | 0.35 | Coverage of required skills |
| `experienceDepth` | 0.30 | Seniority and hands-on depth |
| `autonomy` | 0.20 | End-to-end ownership evidence |
| `productMindset` | 0.15 | User and business impact focus |

Recommendation thresholds:
- **80–100** → Strong Yes
- **60–79** → Yes
- **40–59** → Maybe
- **0–39** → No

---

## Example 1: Redistributing weights for a sales role

For a sales-focused role, you might care more about communication and less about technical depth:

```typescript
// In runCandidateMatching(), change the prompt dimensions:

const prompt = `...
Score this candidate across 4 weighted dimensions. Each score is 0-100.
The final weighted score = (skillsMatch * 0.25) + (salesExperience * 0.40) + (communication * 0.20) + (driveAndAmbition * 0.15).

Dimension definitions:
- skillsMatch (weight 0.25): Coverage of required tools and domain knowledge.
- salesExperience (weight 0.40): Direct sales track record — quota attainment, deal sizes, cycle lengths.
- communication (weight 0.20): Evidence of clear written/verbal communication and stakeholder management.
- driveAndAmbition (weight 0.15): Signals of self-motivation, growth trajectory, or entrepreneurial mindset.

Return JSON:
{
  "scoreBreakdown": {
    "skillsMatch": { "score": <0-100>, "weight": 0.25, "reasoning": "..." },
    "salesExperience": { "score": <0-100>, "weight": 0.40, "reasoning": "..." },
    "communication": { "score": <0-100>, "weight": 0.20, "reasoning": "..." },
    "driveAndAmbition": { "score": <0-100>, "weight": 0.15, "reasoning": "..." }
  },
  "score": <weighted average>,
  ...
}
`;
```

Also update the server-side score recomputation to match:

```typescript
// After getting raw results, recompute weighted score:
const bd = raw.scoreBreakdown;
const weightedScore = bd
  ? Math.round(
      bd.skillsMatch.score * 0.25 +
      bd.salesExperience.score * 0.40 +
      bd.communication.score * 0.20 +
      bd.driveAndAmbition.score * 0.15,
    )
  : raw.score;
```

---

## Example 2: Raising the bar for a senior IC role

Tighten recommendation thresholds for a high-signal Senior/Staff hire:

```typescript
// In the prompt, change:
"recommendation": "<Strong Yes|Yes|Maybe|No based on score: 85-100=Strong Yes, 70-84=Yes, 50-69=Maybe, 0-49=No>"
```

---

## Example 3: Per-role rubric from the job definition

To support different rubrics per role, add a `scoringRubric` field to jobs:

**Schema change** (`lib/db/src/schema/jobs.ts`):
```typescript
scoringRubric: jsonb("scoring_rubric").$type<ScoringRubric | null>(),
```

**Engine change** — pass the rubric through the payload:
```typescript
payload: { job, insight, candidates, scoringRubric: job.scoringRubric ?? null }
```

**Provider change** — template the rubric into the prompt:
```typescript
const rubricText = payload.scoringRubric
  ? payload.scoringRubric.dimensions.map(d =>
      `- ${d.name} (weight ${d.weight}): ${d.description}`
    ).join("\n")
  : DEFAULT_RUBRIC_TEXT;

const prompt = `...
${rubricText}
...`;
```

---

## Example 4: Adding a disqualifying flag

To hard-fail candidates who don't meet a baseline (e.g. missing a required certification):

```typescript
// After getting the raw result, apply a post-processing filter:
const qualified = raw.score >= 40 && candidate.skills.includes("AWS Certified");
if (!qualified) {
  return {
    ...raw,
    score: 0,
    recommendation: "No",
    gaps: [...raw.gaps, "Missing required AWS certification"],
    risks: [...raw.risks, "Disqualified: mandatory certification not present"],
  };
}
```

---

## Where to update the score breakdown UI

The score breakdown display is in:
```
artifacts/recruiting-os/src/components/score-breakdown.tsx
```

If you add new dimension names, update the `DIMENSION_LABELS` map in that file to show human-readable labels in the report UI.

The `ScoreBreakdown` type is defined in the same file — update it to match your new dimensions.
