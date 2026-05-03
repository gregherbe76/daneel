export type JobInsightResult = {
  mustHaveSkills: string[];
  seniority: string;
  evaluationCriteria: string[];
  idealCandidateProfile: string;
};

export type CandidateMatchResult = {
  candidateId: number;
  candidateName: string;
  score: number;
  strengths: string[];
  gaps: string[];
  risks: string[];
  recommendation: "Strong Yes" | "Yes" | "Maybe" | "No";
};

export type ShortlistResult = {
  candidateId: number;
  candidateName: string;
  whyRelevant: string;
  keyRisks: string;
  finalRecommendation: string;
};
