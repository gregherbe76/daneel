export type JobInsightResult = {
  mustHaveSkills: string[];
  seniority: string;
  evaluationCriteria: string[];
  idealCandidateProfile: string;
};

export type ScoreDimension = {
  score: number;       // 0-100
  weight: number;      // 0-1, sum of all dimensions = 1.0
  reasoning: string;   // specific, concrete reasoning — never generic
};

export type ScoreBreakdown = {
  skillsMatch: ScoreDimension;       // weight: 0.25
  experienceDepth: ScoreDimension;   // weight: 0.20
  communication: ScoreDimension;     // weight: 0.20
  clientFit: ScoreDimension;         // weight: 0.20
  stability: ScoreDimension;         // weight: 0.10
  autonomy: ScoreDimension;          // weight: 0.05
};

export type CandidateMatchResult = {
  candidateId: number;
  candidateName: string;
  score: number;           // = decisionScore (backward-compat for sorting)
  fitScore: number;        // AI-assessed fit only (no data-quality penalty)
  strengths: string[];
  gaps: string[];
  risks: string[];
  recommendation: "Strong Yes" | "Yes" | "Maybe" | "No";
  scoreBreakdown: ScoreBreakdown;
  confidenceReason?: string;
  missingDataWarnings?: string[];
};

export type ShortlistResult = {
  candidateId: number;
  candidateName: string;
  whyRelevant: string;
  keyRisks: string;
  finalRecommendation: string;
};
