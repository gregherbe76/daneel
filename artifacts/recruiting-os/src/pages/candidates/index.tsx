import { useListCandidates } from "@workspace/api-client-react";
import { Link, useLocation, useSearch } from "wouter";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Users, Loader2, Mail, Upload, Filter } from "lucide-react";
import { ImportCandidatesModal } from "@/components/import-candidates-modal";
import { EmailValidationBadge } from "@/components/email-validation-badge";
import { EmailSourceBadge } from "@/components/email-source-badge";
import {
  EmailStatusFilter,
  EmailStatusFilterValue,
  isEmailStatusFilterValue,
  matchesEmailStatusFilter,
} from "@/components/email-status-filter";
import {
  EmailSourceFilter,
  EMAIL_SOURCE_VALUES,
  parseEmailSourceParam,
  serializeEmailSourceParam,
  matchesEmailSourceFilter,
} from "@/components/email-source-filter";

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
  "GitHub Agent": {
    label: "GitHub",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400",
  },
  "Web Search": {
    label: "Web",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
};

const EMAIL_FILTER_PARAM = "email";

export default function CandidatesPage() {
  const { data: candidates, isLoading, refetch } = useListCandidates();
  const search = useSearch();
  const [, navigate] = useLocation();
  const [importOpen, setImportOpen] = useState(false);

  const selectedSources: Set<string> = useMemo(() => parseEmailSourceParam(search), [search]);

  const emailFilter: EmailStatusFilterValue = useMemo(() => {
    const parsed = new URLSearchParams(search);
    const v = parsed.get(EMAIL_FILTER_PARAM);
    return isEmailStatusFilterValue(v) ? v : "all";
  }, [search]);

  const updateUrl = (mutate: (params: URLSearchParams) => void) => {
    const parsed = new URLSearchParams(search);
    mutate(parsed);
    const qs = parsed.toString();
    navigate(`/candidates${qs ? `?${qs}` : ""}`, { replace: true });
  };

  const setEmailFilter = (value: EmailStatusFilterValue) => {
    updateUrl((p) => {
      if (value === "all") p.delete(EMAIL_FILTER_PARAM);
      else p.set(EMAIL_FILTER_PARAM, value);
    });
  };

  const setSelectedSources = (next: Set<string>) => {
    const serialized = serializeEmailSourceParam(next);
    updateUrl((p) => {
      if (serialized) p.set("emailSource", serialized);
      else p.delete("emailSource");
    });
  };

  const availableSources = useMemo(() => {
    const set = new Set<string>();
    let hasUnknown = false;
    for (const c of candidates ?? []) {
      const s = c.emailSource;
      if (s && EMAIL_SOURCE_VALUES.has(s)) {
        set.add(s);
      } else {
        hasUnknown = true;
      }
    }
    return { set, hasUnknown };
  }, [candidates]);

  const matchesSourceFilter = (emailSource: string | null | undefined) =>
    matchesEmailSourceFilter(emailSource, selectedSources);

  const counts = useMemo(() => {
    const c: Partial<Record<EmailStatusFilterValue, number>> = {
      all: 0,
      valid: 0,
      risky: 0,
      invalid: 0,
      unchecked: 0,
    };
    candidates?.forEach((cand) => {
      if (!matchesSourceFilter(cand.emailSource)) return;
      c.all! += 1;
      const s = cand.emailValidationStatus;
      if (s === "valid") c.valid! += 1;
      else if (s === "risky") c.risky! += 1;
      else if (s === "invalid") c.invalid! += 1;
      else c.unchecked! += 1;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, selectedSources]);

  const filteredCandidates = useMemo(() => {
    if (!candidates) return candidates;
    return candidates.filter(
      (c) =>
        matchesSourceFilter(c.emailSource) &&
        matchesEmailStatusFilter(c.emailValidationStatus, emailFilter),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, selectedSources, emailFilter]);

  const totalCount = candidates?.length ?? 0;
  const filteredCount = filteredCandidates?.length ?? 0;
  const isSourceFiltered = selectedSources.size > 0;
  const isStatusFiltered = emailFilter !== "all";
  const isFiltered = isSourceFiltered || isStatusFiltered;

  const clearAllFilters = () => {
    setSelectedSources(new Set());
    setEmailFilter("all");
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Candidates</h1>
          <p className="text-muted-foreground mt-1">Everyone in your talent pool, in one place.</p>
        </div>
        <div className="flex gap-2">
          <EmailSourceFilter
            selected={selectedSources}
            onChange={setSelectedSources}
            availableSources={availableSources}
          />
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

      {!isLoading && (candidates?.length ?? 0) > 0 && (
        <div className="mb-6">
          <EmailStatusFilter value={emailFilter} onChange={setEmailFilter} counts={counts} />
        </div>
      )}

      {isFiltered && !isLoading && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            Showing {filteredCount} of {totalCount} candidates.
          </span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={clearAllFilters}
          >
            Clear all
          </Button>
        </div>
      )}

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
      ) : filteredCount === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Filter className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No candidates match these filters</h3>
          <p className="text-muted-foreground mb-4">
            None of your {totalCount} candidates match the current email source and status
            filters. Try adjusting them.
          </p>
          <Button variant="outline" onClick={clearAllFilters}>
            Clear all filters
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCandidates?.map((candidate) => {
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
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1 mb-2 min-w-0">
                    <Mail className="h-3 w-3 shrink-0" />
                    <span className="truncate">{candidate.email}</span>
                    <EmailSourceBadge source={candidate.emailSource} className="shrink-0" />
                  </div>
                  <div className="mb-4">
                    <EmailValidationBadge
                      status={candidate.emailValidationStatus}
                      reason={candidate.emailValidationReason}
                    />
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
