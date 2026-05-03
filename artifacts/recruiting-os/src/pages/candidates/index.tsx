import { useListCandidates } from "@workspace/api-client-react";
import { Link, useLocation, useSearch } from "wouter";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const EMAIL_SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "profile", label: "Profile" },
  { value: "commit", label: "From commits" },
  { value: "manual", label: "Manual" },
  { value: "noreply", label: "Noreply" },
  { value: "generated", label: "Mock" },
];
const EMAIL_SOURCE_VALUES = new Set(EMAIL_SOURCE_OPTIONS.map((o) => o.value));
const UNKNOWN_SOURCE = "__unknown__";

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

const EMAIL_FILTER_PARAM = "email";

export default function CandidatesPage() {
  const { data: candidates, isLoading, refetch } = useListCandidates();
  const [importOpen, setImportOpen] = useState(false);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const search = useSearch();
  const [, navigate] = useLocation();

  const emailFilter: EmailStatusFilterValue = useMemo(() => {
    const parsed = new URLSearchParams(search);
    const v = parsed.get(EMAIL_FILTER_PARAM);
    return isEmailStatusFilterValue(v) ? v : "all";
  }, [search]);

  const setEmailFilter = (value: EmailStatusFilterValue) => {
    const parsed = new URLSearchParams(search);
    if (value === "all") {
      parsed.delete(EMAIL_FILTER_PARAM);
    } else {
      parsed.set(EMAIL_FILTER_PARAM, value);
    }
    const qs = parsed.toString();
    navigate(`/candidates${qs ? `?${qs}` : ""}`, { replace: true });
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

  const matchesSourceFilter = (emailSource: string | null | undefined) => {
    if (selectedSources.size === 0) return true;
    if (emailSource && EMAIL_SOURCE_VALUES.has(emailSource)) {
      return selectedSources.has(emailSource);
    }
    return selectedSources.has(UNKNOWN_SOURCE);
  };

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

  const toggleSource = (value: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Filter className="mr-2 h-4 w-4" />
                Email source
                {isSourceFiltered && (
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                    {selectedSources.size}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Filter by email source</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {EMAIL_SOURCE_OPTIONS.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={selectedSources.has(opt.value)}
                  onCheckedChange={() => toggleSource(opt.value)}
                  onSelect={(e) => e.preventDefault()}
                  disabled={!availableSources.set.has(opt.value) && !selectedSources.has(opt.value)}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
              {(availableSources.hasUnknown || selectedSources.has(UNKNOWN_SOURCE)) && (
                <DropdownMenuCheckboxItem
                  checked={selectedSources.has(UNKNOWN_SOURCE)}
                  onCheckedChange={() => toggleSource(UNKNOWN_SOURCE)}
                  onSelect={(e) => e.preventDefault()}
                >
                  Unknown
                </DropdownMenuCheckboxItem>
              )}
              {isSourceFiltered && (
                <>
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent"
                    onClick={() => setSelectedSources(new Set())}
                  >
                    Clear filter
                  </button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
