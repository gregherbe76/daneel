import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Plus, GitBranch, Loader2 } from "lucide-react";

const SENIORITY_OPTIONS = [
  "Intern", "Junior", "Mid", "Senior", "Lead", "Principal", "Director", "VP",
];

type VariantCriteria = {
  seniority?: string | null;
  mustHaveSkills?: string[] | null;
  focusNote?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: number;
  baseRunId: number;
  defaultSeniority: string;
  defaultSkills: string[];
  onSubmit: (label: string, criteria: VariantCriteria) => void;
  isSubmitting: boolean;
};

export function RunVariantModal({
  open,
  onOpenChange,
  baseRunId,
  defaultSeniority,
  defaultSkills,
  onSubmit,
  isSubmitting,
}: Props) {
  const [label, setLabel] = useState("");
  const [seniority, setSeniority] = useState(defaultSeniority);
  const [skills, setSkills] = useState<string[]>([...defaultSkills]);
  const [skillInput, setSkillInput] = useState("");
  const [focusNote, setFocusNote] = useState("");

  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills((prev) => [...prev, trimmed]);
    }
    setSkillInput("");
  };

  const removeSkill = (skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill));
  };

  const handleSkillKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSkill();
    }
  };

  const handleSubmit = () => {
    const changed: VariantCriteria = {};
    if (seniority !== defaultSeniority) changed.seniority = seniority;
    const skillsChanged =
      skills.length !== defaultSkills.length ||
      skills.some((s, i) => s !== defaultSkills[i]);
    if (skillsChanged) changed.mustHaveSkills = skills;
    if (focusNote.trim()) changed.focusNote = focusNote.trim();

    onSubmit(label.trim() || `Variant of run #${baseRunId}`, changed);
  };

  const hasChanges =
    seniority !== defaultSeniority ||
    skills.length !== defaultSkills.length ||
    skills.some((s, i) => s !== defaultSkills[i]) ||
    focusNote.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-indigo-600" />
            Run Variant
          </DialogTitle>
          <DialogDescription>
            Adjust the client mission criteria and re-run the AI workflow. The results will
            be shown side-by-side with the original run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="variant-label">Variant name (optional)</Label>
            <Input
              id="variant-label"
              placeholder={`e.g. "Senior only" or "Add Go requirement"`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Seniority level</Label>
            <Select value={seniority} onValueChange={setSeniority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENIORITY_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                    {s === defaultSeniority && (
                      <span className="ml-2 text-xs text-muted-foreground">(current)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Must-have skills</Label>
            <div className="flex flex-wrap gap-1.5 min-h-9 p-2 border border-border rounded-md bg-background">
              {skills.map((s) => (
                <Badge
                  key={s}
                  variant="secondary"
                  className="gap-1 pr-1 text-xs"
                >
                  {s}
                  <button
                    type="button"
                    onClick={() => removeSkill(s)}
                    className="rounded hover:bg-muted-foreground/20 p-0.5"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
              <input
                className="flex-1 min-w-24 text-sm outline-none bg-transparent placeholder:text-muted-foreground"
                placeholder="Type skill + Enter"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={handleSkillKeyDown}
              />
            </div>
            <button
              type="button"
              onClick={addSkill}
              disabled={!skillInput.trim()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
              Add skill
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="focus-note">Focus note (optional)</Label>
            <Textarea
              id="focus-note"
              placeholder="e.g. Prioritise candidates with startup experience over big-tech"
              value={focusNote}
              onChange={(e) => setFocusNote(e.target.value)}
              rows={3}
              className="text-sm resize-none"
            />
            <p className="text-xs text-muted-foreground">
              This note is appended to the client mission brief before the AI evaluates candidates.
            </p>
          </div>

          {!hasChanges && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              No criteria changed yet. Modify at least one field to create a meaningful variant.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <GitBranch className="mr-2 h-4 w-4" />
                Run Variant
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
