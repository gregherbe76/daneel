import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  ChevronRight,
} from "lucide-react";

type Tab = "csv" | "cv";

interface CSVRow {
  name: string;
  email: string;
  linkedIn?: string;
  skills?: string[];
  location?: string;
  headline?: string;
  currentCompany?: string;
  summary?: string;
}

interface ImportCandidatesModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ImportCandidatesModal({
  open,
  onClose,
  onImported,
}: ImportCandidatesModalProps) {
  const [tab, setTab] = useState<Tab>("csv");
  const { toast } = useToast();

  const handleClose = () => {
    setTab("csv");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Candidates</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 p-1 bg-muted rounded-lg mb-4">
          <button
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              tab === "csv"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("csv")}
          >
            CSV Upload
          </button>
          <button
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              tab === "cv"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("cv")}
          >
            Bulk CV Upload
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "csv" ? (
            <CSVImport onImported={onImported} onClose={handleClose} toast={toast} />
          ) : (
            <CVImport onImported={onImported} onClose={handleClose} toast={toast} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- CSV ----------

function CSVImport({
  onImported,
  onClose,
  toast,
}: {
  onImported: () => void;
  onClose: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [rows, setRows] = useState<CSVRow[]>([]);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
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
      setRows(data.rows);
      setStep("preview");
    } catch (e: unknown) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const confirm = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/candidates/import/csv/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult(data);
      setStep("done");
      onImported();
    } catch (e: unknown) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (step === "done" && result) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
        <div>
          <p className="text-xl font-semibold">{result.created} candidates imported</p>
          {result.skipped > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {result.skipped} skipped (duplicate email)
            </p>
          )}
        </div>
        <Button onClick={onClose}>Done</Button>
      </div>
    );
  }

  if (step === "preview") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {rows.length} valid candidates detected
          </p>
          <button
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setStep("upload")}
          >
            <X className="h-3 w-3" /> Change file
          </button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Email</th>
                  <th className="text-left p-3 font-medium">LinkedIn</th>
                  <th className="text-left p-3 font-medium">Skills</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-t hover:bg-muted/50">
                    <td className="p-3 font-medium">{row.name || <span className="text-red-400">—</span>}</td>
                    <td className="p-3 text-muted-foreground truncate max-w-[180px]">{row.email}</td>
                    <td className="p-3 text-muted-foreground text-xs truncate max-w-[120px]">
                      {row.linkedIn || "—"}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1 flex-wrap">
                        {row.skills?.slice(0, 3).map((s) => (
                          <Badge key={s} variant="secondary" className="text-xs py-0">
                            {s}
                          </Badge>
                        ))}
                        {(row.skills?.length ?? 0) > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{(row.skills?.length ?? 0) - 3}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Candidates with duplicate emails will be skipped. All candidates will be tagged "Imported CSV".
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ChevronRight className="h-4 w-4 mr-2" />
            )}
            Import {rows.length} candidates
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Upload a CSV file. We'll detect columns automatically.
        <br />
        Expected columns: <code className="text-xs bg-muted px-1 rounded">name</code>,{" "}
        <code className="text-xs bg-muted px-1 rounded">email</code>,{" "}
        <code className="text-xs bg-muted px-1 rounded">linkedin</code>,{" "}
        <code className="text-xs bg-muted px-1 rounded">skills</code>
      </p>

      <div
        className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        {loading ? (
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
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

// ---------- CV ----------

function CVImport({
  onImported,
  onClose,
  toast,
}: {
  onImported: () => void;
  onClose: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    failed: number;
    candidates: { name: string; email: string }[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;
    const pdfs = Array.from(newFiles).filter((f) => f.type === "application/pdf");
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...pdfs.filter((f) => !existing.has(f.name))];
    });
  };

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  };

  const submit = async () => {
    if (files.length === 0) return;
    setLoading(true);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    try {
      const res = await fetch("/api/candidates/import/cv", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult(data);
      onImported();
    } catch (e: unknown) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center gap-4">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
        <div>
          <p className="text-xl font-semibold">{result.created} candidates created</p>
          <div className="flex gap-4 justify-center mt-2 text-sm text-muted-foreground">
            {result.skipped > 0 && <span>{result.skipped} duplicate</span>}
            {result.failed > 0 && <span>{result.failed} could not be parsed</span>}
          </div>
        </div>
        {result.candidates.length > 0 && (
          <div className="w-full border rounded-lg overflow-hidden mt-2">
            <div className="max-h-48 overflow-y-auto">
              {result.candidates.map((c, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border-t first:border-t-0">
                  <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.email}</p>
                  </div>
                  <Badge variant="secondary" className="ml-auto text-xs">Uploaded CV</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
        <Button onClick={onClose}>Done</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Upload multiple PDF CVs. We'll extract name, email, and skills from each.
        Candidates must have an email address in their CV.
      </p>

      <div
        className="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <FileText className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="font-medium">Drop PDF files here</p>
        <p className="text-sm text-muted-foreground mt-1">or click to browse — multiple files supported</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            {files.map((f) => (
              <div key={f.name} className="flex items-center gap-3 p-3 border-t first:border-t-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  className="text-muted-foreground hover:text-foreground ml-1"
                  onClick={() => removeFile(f.name)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          All successfully parsed candidates will be tagged "Uploaded CV".
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={files.length === 0 || loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <ChevronRight className="h-4 w-4 mr-2" />
          )}
          {files.length > 0
            ? `Import ${files.length} CV${files.length === 1 ? "" : "s"}`
            : "Import CVs"}
        </Button>
      </div>
    </div>
  );
}
