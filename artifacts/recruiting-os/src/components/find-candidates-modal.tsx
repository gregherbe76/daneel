import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Bot,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  MapPin,
  Building2,
  Zap,
  Play,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Provider = {
  id: number;
  name: string;
  type: "native_openai" | "custom_webhook" | "twin_webhook";
  enabled: boolean;
};

type SourcingResult = {
  id: number;
  name: string;
  email: string;
  headline: string | null;
  location: string | null;
  currentCompany: string | null;
  skills: string[];
  summary: string | null;
  source: string | null;
};

type FoundResult = {
  created: number;
  skipped: number;
  candidates: SourcingResult[];
};

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: number;
  jobTitle: string;
  jobSeniority?: string;
  jobLocation?: string;
  onFound: (result: { created: number }) => void;
};

// ── Count options ─────────────────────────────────────────────────────────────

const COUNT_OPTIONS = [5, 7, 10, 15, 20];

const SENIORITY_OPTIONS = [
  "Intern", "Junior", "Mid", "Senior", "Lead", "Principal", "Director", "VP",
];

// ── Source tag styling ────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string | null }) {
  if (source === "Twin") {
    return (
      <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-700 border-purple-200 shrink-0">
        <Zap className="h-2.5 w-2.5 mr-1" />
        Twin
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-200 shrink-0">
      <Sparkles className="h-2.5 w-2.5 mr-1" />
      AI Mock
    </Badge>
  );
}

// ── Candidate result card ─────────────────────────────────────────────────────

function CandidateCard({ candidate }: { candidate: SourcingResult }) {
  return (
    <div className="flex flex-col gap-1.5 p-3 border border-border rounded-lg bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{candidate.name}</p>
          {candidate.headline && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{candidate.headline}</p>
          )}
        </div>
        <SourceBadge source={candidate.source} />
      </div>
      {(candidate.location || candidate.currentCompany) && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {candidate.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" />{candidate.location}
            </span>
          )}
          {candidate.currentCompany && (
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3 shrink-0" />{candidate.currentCompany}
            </span>
          )}
        </div>
      )}
      {candidate.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {candidate.skills.slice(0, 5).map((s) => (
            <span key={s} className="px-1.5 py-0.5 text-[10px] bg-muted rounded border border-border text-muted-foreground">{s}</span>
          ))}
          {candidate.skills.length > 5 && (
            <span className="text-[10px] text-muted-foreground px-1">+{candidate.skills.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Provider radio card ───────────────────────────────────────────────────────

function ProviderCard({
  label,
  description,
  selected,
  onClick,
  tag,
}: {
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  tag?: "twin" | "mock";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-md border text-left transition-all ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border bg-muted/20 hover:bg-muted/40"
      }`}
    >
      <div className="mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1
        ${selected ? 'border-primary' : 'border-muted-foreground/40'}">
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {tag === "twin" && (
            <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-700 border-purple-200">
              <Zap className="h-2.5 w-2.5 mr-1" />Twin
            </Badge>
          )}
          {tag === "mock" && (
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-200">
              Demo
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function FindCandidatesModal({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  jobSeniority,
  jobLocation,
  onFound,
}: Props) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);

  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [count, setCount] = useState(7);
  const [locationFilter, setLocationFilter] = useState("");
  const [seniorityFilter, setSeniorityFilter] = useState<string>("_default");

  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<FoundResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Fetch providers when modal opens
  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setLocationFilter("");
    setSeniorityFilter("_default");
    setCount(7);

    setLoadingProviders(true);
    fetch("/api/providers")
      .then((r) => r.json())
      .then((data: Provider[]) => {
        const enabled = (data ?? []).filter((p) => p.enabled);
        setProviders(enabled);
        // auto-select: prefer twin/webhook, fall back to native
        const twin = enabled.find((p) => p.type === "twin_webhook" || p.type === "custom_webhook");
        setSelectedProviderId(twin ? twin.id : null);
      })
      .catch(() => setProviders([]))
      .finally(() => setLoadingProviders(false));
  }, [open]);

  const handleFind = async () => {
    setStatus("loading");
    setResult(null);
    setErrorMsg("");

    try {
      const body: Record<string, unknown> = { jobId, count };
      if (selectedProviderId !== null) body.providerId = selectedProviderId;
      if (locationFilter.trim()) body.location = locationFilter.trim();
      if (seniorityFilter && seniorityFilter !== "_default") body.seniority = seniorityFilter;

      const resp = await fetch("/api/candidates/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }

      const data: FoundResult = await resp.json();
      setResult(data);
      setStatus("done");
      onFound({ created: data.created });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred.");
      setStatus("error");
    }
  };

  const nativeOption = { id: null, label: "Native AI (demo)", description: "Generates realistic mock candidates using GPT. Not real people.", tag: "mock" as const };
  const externalOptions = providers
    .filter((p) => p.type === "twin_webhook" || p.type === "custom_webhook")
    .map((p) => ({
      id: p.id,
      label: p.name,
      description: p.type === "twin_webhook" ? "Twin webhook — real external candidates." : "Custom webhook provider.",
      tag: "twin" as const,
    }));

  const canFind = status !== "loading";
  const resolvedSeniority = seniorityFilter === "_default" ? (jobSeniority ?? "Mid") : seniorityFilter;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (status !== "loading") onOpenChange(v); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Find Candidates with AI
          </DialogTitle>
          <DialogDescription className="text-xs">
            Source candidates for <span className="font-medium text-foreground">{jobTitle}</span> — your client mission — via an external provider.
            Results are saved to your pipeline automatically.
          </DialogDescription>
        </DialogHeader>

        {status === "done" && result ? (
          /* ── Success state ─────────────────────────────────────────── */
          <div className="flex flex-col gap-4 mt-2">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              {result.created === 0
                ? "No new candidates found — all were already in your pipeline."
                : `${result.created} candidate${result.created === 1 ? "" : "s"} added to your pipeline.`}
              {result.skipped > 0 && (
                <span className="text-muted-foreground font-normal ml-1">({result.skipped} duplicate{result.skipped === 1 ? "" : "s"} skipped)</span>
              )}
            </div>

            {result.candidates.length > 0 && (
              <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                {result.candidates.map((c) => (
                  <CandidateCard key={c.id} candidate={c} />
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-border">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setStatus("idle");
                  setResult(null);
                }}
              >
                Find More
              </Button>
              <Button className="flex-1 bg-primary/90 hover:bg-primary" onClick={() => onOpenChange(false)}>
                <Play className="mr-2 h-3.5 w-3.5" />
                Run Smart Screening
              </Button>
            </div>
          </div>
        ) : (
          /* ── Config state ──────────────────────────────────────────── */
          <div className="flex flex-col gap-5 mt-2">
            {/* Provider selector */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sourcing Provider
              </Label>
              {loadingProviders ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading providers…
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {externalOptions.map((opt) => (
                    <ProviderCard
                      key={opt.id}
                      label={opt.label}
                      description={opt.description}
                      tag={opt.tag}
                      selected={selectedProviderId === opt.id}
                      onClick={() => setSelectedProviderId(opt.id)}
                    />
                  ))}
                  <ProviderCard
                    label={nativeOption.label}
                    description={nativeOption.description}
                    tag={nativeOption.tag}
                    selected={selectedProviderId === null}
                    onClick={() => setSelectedProviderId(null)}
                  />
                </div>
              )}
            </div>

            {/* Count */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Number of Candidates
              </Label>
              <div className="flex gap-2">
                {COUNT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={`flex-1 py-1.5 rounded-md border text-sm font-medium transition-all ${
                      count === n
                        ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                        : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Filters */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Filters <span className="font-normal normal-case">(optional — overrides mission defaults)</span>
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fc-location" className="text-xs text-muted-foreground">Location</Label>
                  <Input
                    id="fc-location"
                    placeholder={jobLocation ?? "e.g. San Francisco"}
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fc-seniority" className="text-xs text-muted-foreground">Seniority</Label>
                  <Select value={seniorityFilter} onValueChange={setSeniorityFilter}>
                    <SelectTrigger id="fc-seniority" className="h-8 text-sm">
                      <SelectValue placeholder={`Default (${resolvedSeniority})`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_default">Default ({jobSeniority ?? "Mid"})</SelectItem>
                      {SENIORITY_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Error */}
            {status === "error" && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* CTA */}
            <Button
              className="w-full bg-primary/90 hover:bg-primary"
              disabled={!canFind || loadingProviders}
              onClick={handleFind}
            >
              {status === "loading" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Finding candidates…
                </>
              ) : (
                <>
                  <Bot className="mr-2 h-4 w-4" />
                  Find {count} Candidates
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
