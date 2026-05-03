/**
 * HiringAI prompt pack.
 *
 * Three executable prompt builders, one per workflow step. Each returns the
 * full user-message string sent to the model. JSON output schemas are baked
 * in here because they are part of the engine contract — only the *voice*
 * and framing should change between templates.
 *
 * Voice: founder-to-founder, direct, decisive, action-oriented.
 */

export type JobUnderstandingArgs = {
  job: {
    title: string;
    description: string;
    location: string;
    seniority: string;
    mustHaveSkills: string[];
  };
};

export type CandidateMatchingArgs = {
  job: {
    title: string;
    description: string;
    seniority: string;
    mustHaveSkills: string[];
  };
  insight: {
    evaluationCriteria: string[];
    idealCandidateProfile: string;
  };
  candidate: {
    name: string;
    skills: string[];
    summary: string | null;
  };
  /** Already-normalized 0-1 weight fractions. */
  weights: { autonomy: number; productMindset: number; impact: number };
};

export type ShortlistGenerationArgs = {
  job: { title: string };
  insight: { idealCandidateProfile: string };
  topCandidates: Array<{
    candidateName: string;
    score: number;
    recommendation: string;
    strengths: string[];
    gaps: string[];
  }>;
};

export const prompts = {
  jobUnderstanding({ job }: JobUnderstandingArgs): string {
    return `You are a technical recruiter assistant. Analyze this job posting and return a JSON object.

Job Title: ${job.title}
Location: ${job.location}
Seniority: ${job.seniority}
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
Description:
${job.description}

Return a JSON object with exactly these fields:
{
  "mustHaveSkills": ["skill1", "skill2", ...],
  "seniority": "exact seniority level",
  "evaluationCriteria": ["criterion1", "criterion2", ...],
  "idealCandidateProfile": "2-3 sentence description of the ideal candidate"
}

Keep it concise and accurate. Return only valid JSON, no other text.`;
  },

  candidateMatching({ job, insight, candidate, weights }: CandidateMatchingArgs): string {
    const fmt = (v: number) => v.toFixed(2);
    return `You are an experienced HR partner evaluating a candidate for a role. Be concrete and specific — never write generic statements. Every piece of reasoning must reference actual details from the candidate's profile or the job requirements.

JOB: ${job.title} (${job.seniority})
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
Evaluation Criteria: ${insight.evaluationCriteria.join("; ")}
Ideal Profile: ${insight.idealCandidateProfile}
Job Description: ${job.description}

CANDIDATE: ${candidate.name}
Skills: ${candidate.skills.length > 0 ? candidate.skills.join(", ") : "none listed"}
Summary: ${candidate.summary ?? "No summary provided"}

Score this candidate's FIT for the role across 3 weighted dimensions. Each dimension score is 0-100.
The fitScore = round(
  autonomy*${fmt(weights.autonomy)} + productMindset*${fmt(weights.productMindset)} + impact*${fmt(weights.impact)}
).

IMPORTANT — Scoring rules:
- Score ONLY based on evidence present in the profile. Do NOT assume or invent qualifications.
- Do NOT penalize for missing data. Instead, score conservatively on that dimension and flag the gap in missingDataWarnings.
- If a dimension has no evidence at all, score it at 20-30 (not 0) and flag it.
- Never fabricate experience or skills that are not explicitly listed.
- Treat must-have skills as a baseline expectation: weave skill coverage into Impact reasoning rather than as a standalone dimension.

Dimension definitions:
- autonomy (${fmt(weights.autonomy)}): End-to-end ownership, led initiatives, worked without heavy direction. Cite specific evidence of self-direction.
- productMindset (${fmt(weights.productMindset)}): Evidence the candidate thinks about users, product impact, or business outcomes — not just code or tasks.
- impact (${fmt(weights.impact)}): Concrete shipped outcomes, measurable results, scope of work, and how their must-have skill coverage translates into tangible impact for this role.

Additional rules:
- reasoning must be 1-2 specific sentences referencing actual candidate details
- strengths, gaps and risks must be specific, not generic
- confidenceReason: 1 sentence explaining data limitations that reduce scoring confidence (or "Profile provides sufficient data for reliable scoring" if data is complete)
- missingDataWarnings: list 0-3 specific data gaps that affect scoring reliability (empty array if none)

Return only valid JSON matching this exact structure:
{
  "scoreBreakdown": {
    "autonomy":       { "score": <0-100>, "weight": ${fmt(weights.autonomy)}, "reasoning": "<specific 1-2 sentences>" },
    "productMindset": { "score": <0-100>, "weight": ${fmt(weights.productMindset)}, "reasoning": "<specific 1-2 sentences>" },
    "impact":         { "score": <0-100>, "weight": ${fmt(weights.impact)}, "reasoning": "<specific 1-2 sentences>" }
  },
  "fitScore": <integer 0-100, must equal round(weighted sum above)>,
  "strengths": ["<specific strength citing candidate detail>", "<specific strength>"],
  "gaps": ["<specific gap naming missing skill or evidence>"],
  "risks": ["<concrete risk with specific evidence>"],
  "recommendation": "<Strong Yes|Yes|Maybe|No based on fitScore: 80-100=Strong Yes, 60-79=Yes, 40-59=Maybe, 0-39=No>",
  "confidenceReason": "<1 sentence on data limitations, or 'Profile provides sufficient data for reliable scoring'>",
  "missingDataWarnings": ["<specific data gap>"]
}`;
  },

  shortlistGeneration({ job, insight, topCandidates }: ShortlistGenerationArgs): string {
    return `You are creating a startup hiring shortlist for a founder. Be ultra-direct: no jargon, no filler, no diplomatic hedging. Founders want a verdict and the evidence behind it — nothing more.

JOB: ${job.title}
Ideal Profile: ${insight.idealCandidateProfile}

TOP CANDIDATES:
${topCandidates.map((c, i) => `${i + 1}. ${c.candidateName} (Score: ${c.score}, Recommendation: ${c.recommendation})
   Strengths: ${c.strengths.join(", ")}
   Gaps: ${c.gaps.join(", ")}`).join("\n\n")}

For each candidate, return:
- whyRelevant: ONE short sentence verdict — the headline reason to talk to them. No preamble.
- keyRisks: ONE short sentence naming the single biggest risk. No softening language.
- finalRecommendation: ONE short imperative sentence ("Interview now.", "Pass.", "Phone screen first to verify X.").

Hard limits: each field <= 25 words. Reference concrete evidence from strengths/gaps. Do NOT repeat the candidate's name inside the fields. Do NOT use phrases like "this candidate", "appears to", "seems to be", "could be a great fit".

Return only a valid JSON array:
[
  {
    "candidateId": <number>,
    "candidateName": "<name>",
    "whyRelevant": "<one short verdict sentence>",
    "keyRisks": "<one short risk sentence>",
    "finalRecommendation": "<one short imperative sentence>"
  }
]`;
  },
} as const;

export type Prompts = typeof prompts;
