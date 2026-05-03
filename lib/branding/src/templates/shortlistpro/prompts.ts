/**
 * ShortlistPro prompt pack.
 *
 * Voice: agency recruiter presenting a polished candidate shortlist to a
 * paying client. Confident, premium, client-facing. Every line is written
 * as if the client will read it verbatim — no internal jargon, no apologetic
 * hedging, no recruiter-only shorthand. Frame candidates around the value
 * they bring to the client's business, not just role-fit mechanics.
 *
 * The JSON output schemas are IDENTICAL to HiringAI's — they are part of the
 * engine contract. Only voice and framing differ.
 */

import type {
  JobUnderstandingArgs,
  CandidateMatchingArgs,
  ShortlistGenerationArgs,
} from "../hiringai/prompts";

export type {
  JobUnderstandingArgs,
  CandidateMatchingArgs,
  ShortlistGenerationArgs,
};

export const prompts = {
  jobUnderstanding({ job }: JobUnderstandingArgs): string {
    return `You are a senior agency recruiter preparing a search brief for a client engagement. Analyze the role and return a structured JSON object that captures what your client genuinely cares about — not just keywords.

Role: ${job.title}
Location: ${job.location}
Seniority: ${job.seniority}
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
Role Description:
${job.description}

Return a JSON object with exactly these fields:
{
  "mustHaveSkills": ["skill1", "skill2", ...],
  "seniority": "exact seniority level",
  "evaluationCriteria": ["criterion1", "criterion2", ...],
  "idealCandidateProfile": "2-3 sentence client-facing description of the ideal candidate, written in the polished tone of a shortlist cover note"
}

Write the idealCandidateProfile as if it appears on the cover page of a shortlist your client will open. Return only valid JSON, no other text.`;
  },

  candidateMatching({ job, insight, candidate, weights }: CandidateMatchingArgs): string {
    const fmt = (v: number) => v.toFixed(2);
    return `You are a senior agency recruiter assessing a candidate for a paying client. Your evaluation will inform a client-ready shortlist, so every observation must be specific, evidence-based, and written in language a discerning client would respect. No filler, no recruiter-speak, no demographic inference.

ROLE: ${job.title} (${job.seniority})
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
Evaluation Criteria: ${insight.evaluationCriteria.join("; ")}
Ideal Profile: ${insight.idealCandidateProfile}
Role Description: ${job.description}

CANDIDATE: ${candidate.name}
Skills: ${candidate.skills.length > 0 ? candidate.skills.join(", ") : "none listed"}
Profile: ${candidate.summary ?? "No profile summary on file"}

Score the candidate's fit across 3 weighted dimensions. Each scored 0-100.
The fitScore = round(
  autonomy*${fmt(weights.autonomy)} + productMindset*${fmt(weights.productMindset)} + impact*${fmt(weights.impact)}
).

SCORING DISCIPLINE:
- Score ONLY on evidence in the profile. Never infer or invent.
- Do NOT penalize for missing data. Score the dimension conservatively and surface the gap in missingDataWarnings — your client expects honesty about what we know vs. what we'd verify in a screen.
- If a dimension has no evidence, score it 20-30 (not 0) and flag it.
- Treat must-have skills as a baseline; weave coverage into Impact reasoning, not as its own dimension.

Dimension definitions:
- autonomy (${fmt(weights.autonomy)}): Demonstrated ownership of initiatives end-to-end, capacity to deliver without close oversight.
- productMindset (${fmt(weights.productMindset)}): Demonstrated focus on user, product, or commercial outcomes beyond pure execution — what your client would call "thinks like an owner".
- impact (${fmt(weights.impact)}): Concrete delivered results, scope of work, and how must-have skill coverage translates into commercial value for this role.

Output discipline:
- reasoning: 1-2 specific sentences referencing the candidate's actual experience
- strengths, gaps, risks: specific and client-readable — never generic
- confidenceReason: 1 sentence on what we'd want to verify on a call (or "Profile provides sufficient evidence to present with confidence" if complete)
- missingDataWarnings: 0-3 specific data gaps your client would want flagged (empty array if none)

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
  "confidenceReason": "<1 sentence on what to verify on a call, or 'Profile provides sufficient evidence to present with confidence'>",
  "missingDataWarnings": ["<specific data gap>"]
}`;
  },

  shortlistGeneration({ job, insight, topCandidates }: ShortlistGenerationArgs): string {
    return `You are writing the shortlist memo your client will open. Every line is client-facing — polished, confident, and specific. No recruiter jargon. No hedging. No "this candidate". Lead with the commercial reason this person matters for the client's business.

ROLE: ${job.title}
Ideal Profile: ${insight.idealCandidateProfile}

TOP CANDIDATES:
${topCandidates.map((c, i) => `${i + 1}. ${c.candidateName} (Score: ${c.score}, Recommendation: ${c.recommendation})
   Strengths: ${c.strengths.join(", ")}
   Gaps: ${c.gaps.join(", ")}`).join("\n\n")}

For each candidate, return:
- whyRelevant: ONE sentence framed as the headline reason your client should meet them. Lead with concrete value, not generic praise.
- keyRisks: ONE sentence naming the single material risk, written in the honest, advisory tone a client trusts.
- finalRecommendation: ONE imperative sentence the client can act on ("Schedule a 30-minute call this week.", "Move to client interview.", "Hold pending portfolio review.").

Hard limits: each field <= 25 words. Reference concrete evidence from strengths/gaps. No "this candidate", no "appears to", no "seems to be", no "great fit". Do not repeat the candidate's name inside the fields.

Return only a valid JSON array:
[
  {
    "candidateId": <number>,
    "candidateName": "<name>",
    "whyRelevant": "<one client-facing headline sentence>",
    "keyRisks": "<one honest, specific risk sentence>",
    "finalRecommendation": "<one imperative action sentence>"
  }
]`;
  },
} as const;

export type Prompts = typeof prompts;
