export type TeamMember = {
  id: string;
  name: string;
  role: string;
  email: string;
  initials: string;
  color: string;
};

export const TEAM_ROSTER: TeamMember[] = [
  {
    id: "alex",
    name: "Alex Rivera",
    role: "Lead Recruiter",
    email: "alex@hiringai.example",
    initials: "AR",
    color: "#6366f1",
  },
  {
    id: "priya",
    name: "Priya Shah",
    role: "Hiring Manager",
    email: "priya@hiringai.example",
    initials: "PS",
    color: "#10b981",
  },
  {
    id: "marcus",
    name: "Marcus Chen",
    role: "Sourcer",
    email: "marcus@hiringai.example",
    initials: "MC",
    color: "#f59e0b",
  },
  {
    id: "jordan",
    name: "Jordan Patel",
    role: "Recruiting Coordinator",
    email: "jordan@hiringai.example",
    initials: "JP",
    color: "#ec4899",
  },
  {
    id: "sam",
    name: "Sam Okafor",
    role: "Engineering Manager",
    email: "sam@hiringai.example",
    initials: "SO",
    color: "#0ea5e9",
  },
];

export function findTeamMember(id: string): TeamMember | undefined {
  return TEAM_ROSTER.find((m) => m.id === id);
}
