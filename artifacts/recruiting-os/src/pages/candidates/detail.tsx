import { useRoute, Link } from "wouter";
import { useState } from "react";
import {
  useGetCandidate,
  useGetCandidateApplications,
  useListJobs,
  getGetCandidateQueryKey,
  getGetCandidateApplicationsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Mail,
  Linkedin,
  Github,
  MapPin,
  Building2,
  Loader2,
  User,
} from "lucide-react";
import { CandidateNotesPanel } from "@/components/candidate-notes-panel";
import { EmailValidationBadge } from "@/components/email-validation-badge";

export default function CandidateDetailPage() {
  const [, params] = useRoute("/candidates/:id");
  const candidateId = parseInt(params?.id ?? "0", 10);

  const { data: candidate, isLoading } = useGetCandidate(candidateId, {
    query: {
      enabled: !!candidateId,
      queryKey: getGetCandidateQueryKey(candidateId),
    },
  });
  const { data: applications } = useGetCandidateApplications(candidateId, {
    query: {
      enabled: !!candidateId,
      queryKey: getGetCandidateApplicationsQueryKey(candidateId),
    },
  });
  const { data: jobs } = useListJobs();

  const appJobIds = new Set((applications ?? []).map((a) => a.jobId));
  const linkedJobs = (jobs ?? []).filter((j) => appJobIds.has(j.id));
  const firstJobId = linkedJobs[0]?.id ?? jobs?.[0]?.id ?? 0;
  const [selectedJobId, setSelectedJobId] = useState<number>(firstJobId);
  const activeJobId = selectedJobId || firstJobId;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-200px)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!candidate) {
    return <div className="p-8">Candidate not found.</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <Link href="/candidates">
          <Button variant="ghost" size="sm" className="mb-3 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to candidates
          </Button>
        </Link>

        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center shrink-0">
            <User className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{candidate.name}</h1>
            {candidate.headline && (
              <p className="text-sm text-muted-foreground mt-0.5">{candidate.headline}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
              <a href={`mailto:${candidate.email}`} className="flex items-center gap-1 hover:text-foreground">
                <Mail className="h-3.5 w-3.5" /> {candidate.email}
              </a>
              <EmailValidationBadge
                status={candidate.emailValidationStatus}
                reason={candidate.emailValidationReason}
              />
              {candidate.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {candidate.location}
                </span>
              )}
              {candidate.currentCompany && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" /> {candidate.currentCompany}
                </span>
              )}
              {candidate.linkedIn && (
                <a href={candidate.linkedIn} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
                  <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                </a>
              )}
              {candidate.githubUrl && (
                <a href={candidate.githubUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
                  <Github className="h-3.5 w-3.5" /> GitHub
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {candidate.summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {candidate.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {candidate.skills && candidate.skills.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Skills</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {candidate.skills.map((s) => (
                <Badge key={s} variant="outline" className="bg-background">{s}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes & comments scoped to a job */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notes &amp; team discussion</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Notes and comments are scoped to one job at a time so each role keeps its own conversation.
          </p>
        </CardHeader>
        <CardContent>
          {(jobs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Create a job first to start a discussion about this candidate.
            </p>
          ) : (
            <>
              <div className="mb-4">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Discussing for which role?
                </label>
                <Select
                  value={String(activeJobId)}
                  onValueChange={(v) => setSelectedJobId(parseInt(v, 10))}
                >
                  <SelectTrigger className="max-w-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(jobs ?? []).map((j) => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        {j.title} · {j.location}
                        {appJobIds.has(j.id) ? " (applied)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {activeJobId > 0 && (
                <CandidateNotesPanel
                  candidateId={candidateId}
                  jobId={activeJobId}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
