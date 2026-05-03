# Example: Connecting a Twin Provider

A Twin provider is an external AI agent system that handles one or more workflow steps via HTTP. You point Recruiting OS at a base URL, and each step is routed to a dedicated endpoint on your server.

This is how you connect a fine-tuned model, an n8n workflow, a LangChain agent, or any other external AI system.

---

## How it works

The `TwinWebhookProvider` routes each step to a different URL on your server:

```
sourcing    → POST {baseUrl}/workflow/sourcing
enrichment  → POST {baseUrl}/workflow/enrichment
all others  → POST {baseUrl}/workflow/step
```

It sends:

```json
{
  "step": "candidate_matching",
  "runId": 42,
  "jobId": 7,
  "payload": { ...step-specific data... },
  "schema": { ...expected output shape... },
  "twinContext": {
    "sourceSystem": "recruiting-os",
    "version": "1.0",
    "timestamp": "2026-05-03T..."
  }
}
```

Your server must respond with the correct output shape for the step (see schemas below).

---

## Step 1: Build your Twin server

Your server needs to implement the endpoints it will handle. Here's a minimal Express example:

```typescript
import express from "express";
const app = express();
app.use(express.json());

// Health check — used by Recruiting OS to verify connectivity
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Generic step handler
app.post("/workflow/step", async (req, res) => {
  const { step, payload } = req.body;

  if (step === "candidate_matching") {
    const results = await yourMatchingLogic(payload);
    res.json(results);
    return;
  }

  if (step === "job_understanding") {
    const insight = await yourJobUnderstandingLogic(payload);
    res.json(insight);
    return;
  }

  res.status(400).json({ error: `Unhandled step: ${step}` });
});

// Sourcing — dedicated endpoint
app.post("/workflow/sourcing", async (req, res) => {
  const { payload } = req.body;
  const candidates = await yourSourcingLogic(payload);
  res.json(candidates);
});

// Enrichment — dedicated endpoint
app.post("/workflow/enrichment", async (req, res) => {
  const { payload } = req.body;
  const results = await yourEnrichmentLogic(payload);
  res.json(results);
});

app.listen(3001);
```

---

## Step 2: Register the Twin provider in Recruiting OS

Go to **Settings → Agent Providers → Add Provider**:
- Type: `Twin Webhook`
- Name: anything descriptive (e.g. "My Twin Agent")
- Base URL: `https://your-twin-server.com` (no trailing slash)
- API Key: optional, sent as `Authorization: Bearer <key>`

Then go to **Workflow Step Assignments** and assign your Twin provider to one or more steps.

---

## Request payloads by step

### `job_understanding`

```json
{
  "step": "job_understanding",
  "payload": {
    "job": {
      "title": "Senior Frontend Engineer",
      "description": "...",
      "location": "San Francisco",
      "seniority": "Senior",
      "mustHaveSkills": ["React", "TypeScript"]
    }
  }
}
```

Expected response:
```json
{
  "mustHaveSkills": ["React", "TypeScript", "CSS"],
  "seniority": "Senior",
  "evaluationCriteria": ["Deep React expertise", "TypeScript proficiency"],
  "idealCandidateProfile": "A seasoned frontend engineer..."
}
```

### `candidate_matching`

```json
{
  "step": "candidate_matching",
  "payload": {
    "job": { "title": "...", "description": "...", "mustHaveSkills": [...], "seniority": "..." },
    "insight": { "mustHaveSkills": [...], "seniority": "...", "evaluationCriteria": [...], "idealCandidateProfile": "..." },
    "candidates": [
      { "id": 1, "name": "Alice Chen", "email": "...", "skills": [...], "summary": "..." }
    ]
  }
}
```

Expected response — array, one item per candidate:
```json
[
  {
    "candidateId": 1,
    "candidateName": "Alice Chen",
    "score": 82,
    "strengths": ["Strong React background", "Led design system rewrite"],
    "gaps": ["Limited TypeScript experience"],
    "risks": ["No evidence of senior-level scope"],
    "recommendation": "Strong Yes",
    "scoreBreakdown": {
      "skillsMatch": { "score": 90, "weight": 0.35, "reasoning": "..." },
      "experienceDepth": { "score": 75, "weight": 0.30, "reasoning": "..." },
      "autonomy": { "score": 80, "weight": 0.20, "reasoning": "..." },
      "productMindset": { "score": 70, "weight": 0.15, "reasoning": "..." }
    }
  }
]
```

### `shortlist_generation`

```json
{
  "step": "shortlist_generation",
  "payload": {
    "job": { "title": "...", "description": "..." },
    "insight": { ... },
    "evaluations": [
      { "candidateId": 1, "candidateName": "Alice Chen", "score": 82, "recommendation": "Strong Yes", "strengths": [...], "gaps": [...] }
    ]
  }
}
```

Expected response — array of summaries:
```json
[
  {
    "candidateId": 1,
    "candidateName": "Alice Chen",
    "whyRelevant": "Alice's React and design system experience directly matches the role...",
    "keyRisks": "Limited TypeScript depth could slow onboarding in a TypeScript-first codebase.",
    "finalRecommendation": "Recommend for first-round interview."
  }
]
```

### `sourcing`

Expected response — array of candidate profiles:
```json
[
  {
    "name": "John Smith",
    "headline": "Senior Frontend Engineer at Acme Corp",
    "location": "San Francisco, CA",
    "currentCompany": "Acme Corp",
    "email": "john.smith@example.com",
    "linkedinUrl": "https://linkedin.com/in/johnsmith",
    "githubUrl": "https://github.com/johnsmith",
    "skills": ["React", "TypeScript", "CSS"],
    "summary": "5 years of frontend experience...",
    "evidence": "Led migration from class components to hooks",
    "potentialRisks": "No design system experience",
    "source": "Twin"
  }
]
```

### `enrichment`

Expected response — array of enrichment results:
```json
[
  {
    "candidateId": 1,
    "enrichedSummary": "Alice has 6 years of React experience with a focus on...",
    "enrichedSkills": ["React", "TypeScript", "CSS-in-JS", "Webpack"],
    "enrichedHeadline": "Senior Frontend Engineer — Design Systems & React",
    "additionalSignals": ["Open source contributor", "Published technical blog"],
    "confidence": 0.87
  }
]
```

---

## Data mode and Twin providers

When `dataMode = "real"` is selected, the engine only runs sourcing via a Twin provider. If no Twin provider is assigned to sourcing, the step is skipped (never falls back to generating mock candidates). This guarantees that real data runs never contain AI-generated fake profiles.

If the Twin provider fails during sourcing in real mode, the run is automatically demoted to `fallback` mode and the report will show a warning banner.

---

## Testing your Twin server locally

You can test step routing with curl before connecting it to the UI:

```bash
curl -X POST http://localhost:3001/workflow/step \
  -H "Content-Type: application/json" \
  -d '{
    "step": "job_understanding",
    "runId": 1,
    "jobId": 1,
    "payload": {
      "job": {
        "title": "Senior Frontend Engineer",
        "description": "Build our design system",
        "location": "Remote",
        "seniority": "Senior",
        "mustHaveSkills": ["React", "TypeScript"]
      }
    }
  }'
```
