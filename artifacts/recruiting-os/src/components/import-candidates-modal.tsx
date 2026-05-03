import { useState, useRef, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileText,
  CheckCircle2,
  Loader2,
  X,
  Link2,
  Sparkles,
  Play,
  AlertCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportSource = "CV Upload" | "LinkedIn Paste" | "CSV Import";
type ImportTab = "cv" | "linkedin" | "csv";

export type PendingCandidate = {
  _id: string;
  name: string;
  email: string;
  skills: string[];
  source: ImportSource;
  linkedIn?: string;
  summary?: string;
  location?: string;
  headline?: string;
  currentCompany?: string;
};

// ── Source badge colours ────────────────────────────────────────────────────

const SOURCE_COLORS: Record<ImportSource, string> = {
  "CV Upload":      "bg-violet-100 text-violet-700 border-violet-200",
  "LinkedIn Paste": "bg-blue-100 text-blue-700 border-blue-200",
  "CSV Import":     "bg-emerald-100 text-emerald-700 border-emerald-200",
};

// ── LinkedIn URL parser (runs client-side, no server round-trip) ─────────────

function parseLinkedInURLs(raw: string): PendingCandidate[] {
  const urls = raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const out: PendingCandidate[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const match = url.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i);
    if (!match) continue;
    const slug = decodeURIComponent(match[1].replace(/_/g, "-")).toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    const name = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    out.push({
      _id: `li-${slug}`,
      name,
      email: `linkedin-${slug}@placeholder.import`,
      skills: [],
      source: "LinkedIn Paste",
      linkedIn: url.startsWith("http") ? url : `https://${url}`,
    });
  }
  return out;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ImportCandidatesModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (result: { created: number; jobId?: number }) => void;
  jobId?: number;
  jobTitle?: string;
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function ImportCandidatesModal({
  open,
  onClose,
  onImported,
  jobId,
  jobTitle,
}: ImportCandidatesModalProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<ImportTab>("cv");
  const [pending, setPending] = useState<PendingCandidate[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);

  const addCandidates = useCallback((incoming: PendingCandidate[]) => {
    setPending((prev) => {
      const existingIds = new Set(prev.map((c) => c._id));
      const existingEmails = new Set(prev.map((c) => c.email.toLowerCase()));
      const filtered = incoming.filter(
        (c) => !existingIds.has(c._id) && !existingEmails.has(c.email.toLowerCase()),
      );
      return [...prev, ...filtered];
    });
  }, []);

  const removeCandidate = (id: string) =>
    setPending((prev) => prev.filter((c) => c._id !== id));

  const reset = () => {
    setPending([]);
    setDone(null);
    setTab("cv");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleImport = async () => {
    if (pending.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch("/api/candidates/import/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: pending.map((c) => ({
            name: c.name,
            email: c.email,
            skills: c.skills,
            linkedIn: c.linkedIn,
            summary: c.summary,
            location: c.location,
            headline: c.headline,
            currentCompany: c.currentCompany,
            source: c.source,
          })),
          jobId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setDone({ created: data.created, skipped: data.skipped });
      onImported({ created: data.created, jobId });
    } catch (e: unknown) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  // Done state
  if (done) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className="max-w-lg">
          <div className="flex flex-col items-center justify-center py-10 text-center gap-4">
            <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div>
              <p className="text-xl font-semibold">
                {done.created} candidate{done.created !== 1 ? "s" : ""} imported
              </p>
              {done.skipped > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {done.skipped} skipped (already exist)
                </p>
              )}
              {jobTitle && (
                <p className="text-sm text-muted-foreground mt-1">
                  Added to <span className="font-medium text-foreground">{jobTitle}</span>
                </p>
              )}
            </div>
            {jobId ? (
              <div className="flex flex-col gap-2 w-full">
                <Button
                  className="w-full gap-2 bg-primary/90 hover:bg-primary"
                  onClick={() => { handleClose(); }}
                >
                  <Sparkles className="h-4 w-4" />
                  Run AI Workflow on these candidates
                </Button>
                <Button variant="outline" className="w-full" onClick={() => { reset(); }}>
                  Import more
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => reset()}>Import more</Button>
                <Button onClick={handleClose}>Done</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <DialogTitle className="text-lg font-semibold">
            Import Candidates
            {jobTitle && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                → {jobTitle}
              </span>
            )}
          </DialogTitle>
          {jobTitle && (
            <DialogDescription className="text-xs mt-0.5">
              Candidates will be added to this job's pipeline.
            </DialogDescription>
          )}
          {!jobTitle && <DialogDescription className="sr-only">Import candidates via CV, LinkedIn, or CSV.</DialogDescription>}

          {/* Tab bar */}
          <div className="flex gap-1 mt-4 p-1 bg-muted rounded-lg">
            {(["cv", "linkedin", "csv"] as ImportTab[]).map((t) => {
              const label = t === "cv" ? "📄 CVs" : t === "linkedin" ? "🔗 LinkedIn" : "📊 CSV";
              const count = pending.filter((c) =>
                (t === "cv" && c.source === "CV Upload") ||
                (t === "linkedin" && c.source === "LinkedIn Paste") ||
                (t === "csv" && c.source === "CSV Import"),
              ).length;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                    tab === t
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 pb-3">
            {tab === "cv" && <CVTab onAdd={addCandidates} toast={toast} />}
            {tab === "linkedin" && <LinkedInTab onAdd={addCandidates} existing={pending} />}
            {tab === "csv" && <CSVTab onAdd={addCandidates} toast={toast} />}
          </div>

          {/* Pending candidates list */}
          {pending.length > 0 && (
            <div className="px-6 pb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ready to import ({pending.length})
                </p>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setPending([])}
                >
                  Clear all
                </button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-52 overflow-y-auto divide-y divide-border">
                  {pending.map((c) => (
                    <div key={c._id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold shrink-0 uppercase">
                        {c.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        {c.skills.length > 0 && (
                          <p className="text-xs text-muted-foreground truncate">
                            {c.skills.slice(0, 4).join(", ")}
                            {c.skills.length > 4 ? ` +${c.skills.length - 4}` : ""}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${SOURCE_COLORS[c.source]}`}
                      >
                        {c.source === "CV Upload" ? "CV" : c.source === "LinkedIn Paste" ? "LinkedIn" : "CSV"}
                      </Badge>
                      <button
                        className="text-muted-foreground hover:text-foreground shrink-0 ml-1"
                        onClick={() => removeCandidate(c._id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-between items-center shrink-0 bg-muted/30">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={pending.length === 0 || importing}
            className="min-w-[160px]"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {importing
              ? "Importing…"
              : pending.length === 0
              ? "Import candidates"
              : `Import ${pending.length} candidate${pending.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── CV tab ────────────────────────────────────────────────────────────────────

function CVTab({
  onAdd,
  toast,
}: {
  onAdd: (candidates: PendingCandidate[]) => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    async (newFiles: File[]) => {
      if (newFiles.length === 0) return;
      setQueued((prev) => {
        const existing = new Set(prev.map((f) => f.name));
        return [...prev, ...newFiles.filter((f) => !existing.has(f.name))];
      });

      setLoading(true);
      const fd = new FormData();
      newFiles.forEach((f) => fd.append("files", f));
      try {
        const res = await fetch("/api/candidates/import/cv/preview", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Preview failed");

        const extracted: PendingCandidate[] = data.candidates
          .filter((c: { failed: boolean }) => !c.failed)
          .map((c: { name: string; email: string; skills: string[]; linkedIn: string; summary: string; fileName: string }) => ({
            _id: `cv-${c.email || c.fileName}`,
            name: c.name,
            email: c.email,
            skills: c.skills,
            source: "CV Upload" as const,
            linkedIn: c.linkedIn || undefined,
            summary: c.summary || undefined,
          }));

        const failed = data.candidates.filter((c: { failed: boolean }) => c.failed).length;
        onAdd(extracted);
        if (failed > 0) {
          toast({
            title: `${failed} CV${failed > 1 ? "s" : ""} could not be parsed`,
            description: "Make sure the PDF contains an email address.",
            variant: "destructive",
          });
        }
      } catch (e: unknown) {
        toast({ title: "CV processing failed", description: (e as Error).message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    [onAdd, toast],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const pdfs = Array.from(e.dataTransfer.files).filter((f) => f.type === "application/pdf");
      processFiles(pdfs);
    },
    [processFiles],
  );

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          loading
            ? "border-primary/30 bg-primary/5"
            : "hover:border-primary/50 hover:bg-muted/30"
        }`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => !loading && fileRef.current?.click()}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Extracting candidate data…</p>
            <p className="text-xs text-muted-foreground">This takes a few seconds</p>
          </div>
        ) : (
          <>
            <FileText className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">Drop PDF CVs here</p>
            <p className="text-sm text-muted-foreground mt-1">
              or click to browse — multiple files supported
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Name, email, skills and LinkedIn extracted automatically
            </p>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const pdfs = Array.from(e.target.files ?? []).filter((f) => f.type === "application/pdf");
          processFiles(pdfs);
          e.target.value = "";
        }}
      />
      {queued.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {queued.length} file{queued.length !== 1 ? "s" : ""} processed
          {loading ? "…" : " — extracted candidates appear below"}
        </p>
      )}
    </div>
  );
}

// ── LinkedIn tab ──────────────────────────────────────────────────────────────

function LinkedInTab({
  onAdd,
  existing,
}: {
  onAdd: (candidates: PendingCandidate[]) => void;
  existing: PendingCandidate[];
}) {
  const [raw, setRaw] = useState("");

  const parsed = parseLinkedInURLs(raw);
  const existingEmails = new Set(existing.map((c) => c.email.toLowerCase()));
  const newOnes = parsed.filter((c) => !existingEmails.has(c.email.toLowerCase()));

  const handleAdd = () => {
    if (newOnes.length === 0) return;
    onAdd(newOnes);
    setRaw("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="text-sm font-medium mb-1.5 block">
          Paste LinkedIn profile URLs
        </label>
        <textarea
          className="w-full border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 bg-background min-h-[120px] font-mono"
          placeholder={`https://linkedin.com/in/alice-chen\nhttps://linkedin.com/in/bob-smith\n\nOne per line, or comma-separated`}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </div>

      {parsed.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
            Detected profiles ({parsed.length})
          </div>
          <div className="max-h-40 overflow-y-auto divide-y divide-border">
            {parsed.map((c) => (
              <div key={c._id} className="flex items-center gap-2 px-3 py-2">
                <Link2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                <span className="text-sm font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground truncate flex-1">{c.linkedIn}</span>
                {existingEmails.has(c.email.toLowerCase()) && (
                  <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                    already added
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {parsed.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Names are derived from the URL slug. Run AI Workflow after import to enrich profiles
            with skills and summaries.
          </span>
        </div>
      )}

      <Button
        onClick={handleAdd}
        disabled={newOnes.length === 0}
        variant="outline"
        className="w-full"
      >
        <Upload className="h-4 w-4 mr-2" />
        {newOnes.length > 0
          ? `Add ${newOnes.length} profile${newOnes.length !== 1 ? "s" : ""} to import list`
          : parsed.length > 0
          ? "All profiles already in list"
          : "Add profiles to import list"}
      </Button>
    </div>
  );
}

// ── CSV tab ───────────────────────────────────────────────────────────────────

function CSVTab({
  onAdd,
  toast,
}: {
  onAdd: (candidates: PendingCandidate[]) => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState<PendingCandidate[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/candidates/import/csv/preview", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");

        const candidates: PendingCandidate[] = data.rows.map(
          (r: {
            name: string;
            email: string;
            skills?: string[];
            linkedIn?: string;
            summary?: string;
            location?: string;
            headline?: string;
            currentCompany?: string;
          }) => ({
            _id: `csv-${r.email}`,
            name: r.name,
            email: r.email,
            skills: r.skills ?? [],
            source: "CSV Import" as const,
            linkedIn: r.linkedIn || undefined,
            summary: r.summary || undefined,
            location: r.location || undefined,
            headline: r.headline || undefined,
            currentCompany: r.currentCompany || undefined,
          }),
        );
        setParsed(candidates);
      } catch (e: unknown) {
        toast({ title: "CSV parse failed", description: (e as Error).message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleAdd = () => {
    onAdd(parsed);
    setParsed([]);
  };

  if (parsed.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground border-b flex items-center justify-between">
            <span>{parsed.length} candidates detected</span>
            <button className="text-xs hover:text-foreground" onClick={() => setParsed([])}>
              Change file
            </button>
          </div>
          <div className="overflow-x-auto max-h-56">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-xs">Name</th>
                  <th className="text-left px-3 py-2 font-medium text-xs">Email</th>
                  <th className="text-left px-3 py-2 font-medium text-xs">Skills</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((c) => (
                  <tr key={c._id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-[160px]">{c.email}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 flex-wrap">
                        {c.skills.slice(0, 3).map((s) => (
                          <Badge key={s} variant="secondary" className="text-[10px] py-0 h-4">
                            {s}
                          </Badge>
                        ))}
                        {c.skills.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{c.skills.length - 3}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Button onClick={handleAdd} variant="outline" className="w-full">
          <Upload className="h-4 w-4 mr-2" />
          Add {parsed.length} candidates to import list
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Auto-detects columns:{" "}
        {["name", "email", "linkedin", "skills", "location", "summary"].map((col) => (
          <code key={col} className="text-xs bg-muted px-1 rounded mx-0.5">{col}</code>
        ))}
      </p>

      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          loading ? "border-primary/30 bg-primary/5" : "hover:border-primary/50 hover:bg-muted/30"
        }`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => !loading && fileRef.current?.click()}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Parsing CSV…</p>
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">Drop a CSV file here</p>
            <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
