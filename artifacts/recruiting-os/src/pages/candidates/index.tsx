import { useListCandidates } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Users, Loader2, Mail, Upload } from "lucide-react";
import { ImportCandidatesModal } from "@/components/import-candidates-modal";

const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  "Imported CSV": {
    label: "CSV",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  "Uploaded CV": {
    label: "CV",
    className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  },
  "AI Generated / Mock Sourcing": {
    label: "AI Sourced",
    className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  },
};

export default function CandidatesPage() {
  const { data: candidates, isLoading, refetch } = useListCandidates();
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Candidates</h1>
          <p className="text-muted-foreground mt-1">Everyone in your talent pool, in one place.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import Candidates
          </Button>
          <Link href="/candidates/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Candidate
            </Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : candidates?.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No candidates yet</h3>
          <p className="text-muted-foreground mb-4">
            Import from CSV, upload CVs, or add one manually.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import Candidates
            </Button>
            <Link href="/candidates/new">
              <Button variant="outline">Add Candidate</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {candidates?.map((candidate) => {
            const sourceTag = candidate.source
              ? SOURCE_LABELS[candidate.source]
              : null;
            return (
              <Link key={candidate.id} href={`/candidates/${candidate.id}`}>
                <Card className="p-6 hover:border-primary/50 transition-colors cursor-pointer group h-full flex flex-col">
                  <div className="flex items-start justify-between mb-4">
                    <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center text-xl font-bold text-secondary-foreground uppercase shrink-0">
                      {candidate.name.charAt(0)}
                    </div>
                    {sourceTag && (
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${sourceTag.className}`}
                      >
                        {sourceTag.label}
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold group-hover:text-primary transition-colors">
                    {candidate.name}
                  </h3>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1 mb-4">
                    <Mail className="h-3 w-3" />
                    <span className="truncate">{candidate.email}</span>
                  </div>

                  <div className="mt-auto">
                    {candidate.skills && candidate.skills.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {candidate.skills.slice(0, 3).map((skill) => (
                          <Badge key={skill} variant="secondary" className="text-xs">
                            {skill}
                          </Badge>
                        ))}
                        {candidate.skills.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{candidate.skills.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <ImportCandidatesModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => refetch()}
      />

    </div>
  );
}
