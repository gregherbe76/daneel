import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";

const LINKEDIN_PROFILE_URL = /^https?:\/\/(www\.)?linkedin\.com\/in\//i;
const MAX_URLS = 10;

export interface ProfileUrlsMultiInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Optional override for the test id prefix (defaults to "profile-urls"). */
  testIdPrefix?: string;
}

/**
 * 1-10 LinkedIn profile URLs editor used by the job edit/new pages to seed
 * pattern-matching sourcing providers (currently Extend). Validates each URL
 * client-side against `https?://(www.)?linkedin.com/in/...`. Duplicate URLs
 * are silently rejected. Exceeding 10 URLs disables the input.
 */
export function ProfileUrlsMultiInput({
  value,
  onChange,
  testIdPrefix = "profile-urls",
}: ProfileUrlsMultiInputProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const atCap = value.length >= MAX_URLS;

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!LINKEDIN_PROFILE_URL.test(trimmed)) {
      setError("Must be a LinkedIn profile URL (https://linkedin.com/in/…)");
      return;
    }
    if (value.includes(trimmed)) {
      setError("URL already added");
      return;
    }
    if (atCap) {
      setError(`Maximum ${MAX_URLS} URLs`);
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
    setError(null);
  }

  function remove(index: number) {
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
    setError(null);
  }

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-root`}>
      <div className="flex flex-wrap gap-2">
        {value.map((url, idx) => (
          <Badge
            key={url}
            variant="secondary"
            className="flex items-center gap-1 max-w-full"
            data-testid={`${testIdPrefix}-chip`}
          >
            <span className="truncate max-w-[260px]" title={url}>
              {url.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, "in/")}
            </span>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="ml-1 hover:text-destructive focus:outline-none"
              aria-label={`Remove ${url}`}
              data-testid={`${testIdPrefix}-remove`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="https://linkedin.com/in/jane-doe"
          disabled={atCap}
          data-testid={`${testIdPrefix}-input`}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={add}
          disabled={atCap || !draft.trim()}
          data-testid={`${testIdPrefix}-add`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive" data-testid={`${testIdPrefix}-error`}>
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {value.length} / {MAX_URLS} URLs added.
      </p>
    </div>
  );
}
