import { Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const EMAIL_SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "profile", label: "Profile" },
  { value: "commit", label: "From commits" },
  { value: "manual", label: "Manual" },
  { value: "noreply", label: "Noreply" },
  { value: "generated", label: "Mock" },
];

export const EMAIL_SOURCE_VALUES = new Set(EMAIL_SOURCE_OPTIONS.map((o) => o.value));
export const UNKNOWN_SOURCE = "__unknown__";
const UNKNOWN_URL_VALUE = "unknown";

export function parseEmailSourceParam(search: string, paramName = "emailSource"): Set<string> {
  const parsed = new URLSearchParams(search);
  const raw = parsed.get(paramName);
  if (!raw) return new Set();
  const next = new Set<string>();
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v) continue;
    if (v === UNKNOWN_URL_VALUE) next.add(UNKNOWN_SOURCE);
    else if (EMAIL_SOURCE_VALUES.has(v)) next.add(v);
  }
  return next;
}

export function serializeEmailSourceParam(selected: Set<string>): string {
  return Array.from(selected)
    .map((v) => (v === UNKNOWN_SOURCE ? UNKNOWN_URL_VALUE : v))
    .join(",");
}

export function matchesEmailSourceFilter(
  emailSource: string | null | undefined,
  selected: Set<string>,
): boolean {
  if (selected.size === 0) return true;
  if (emailSource && EMAIL_SOURCE_VALUES.has(emailSource)) {
    return selected.has(emailSource);
  }
  return selected.has(UNKNOWN_SOURCE);
}

type AvailableSources = { set: Set<string>; hasUnknown: boolean };

type Props = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  availableSources?: AvailableSources;
  triggerLabel?: string;
};

export function EmailSourceFilter({
  selected,
  onChange,
  availableSources,
  triggerLabel = "Email source",
}: Props) {
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };
  const isFiltered = selected.size > 0;
  const showUnknown =
    availableSources?.hasUnknown ?? true ? true : selected.has(UNKNOWN_SOURCE);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Filter className="mr-2 h-4 w-4" />
          {triggerLabel}
          {isFiltered && (
            <Badge variant="secondary" className="ml-2 h-5 px-1.5">
              {selected.size}
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
            checked={selected.has(opt.value)}
            onCheckedChange={() => toggle(opt.value)}
            onSelect={(e) => e.preventDefault()}
            disabled={
              availableSources
                ? !availableSources.set.has(opt.value) && !selected.has(opt.value)
                : false
            }
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
        {showUnknown && (
          <DropdownMenuCheckboxItem
            checked={selected.has(UNKNOWN_SOURCE)}
            onCheckedChange={() => toggle(UNKNOWN_SOURCE)}
            onSelect={(e) => e.preventDefault()}
          >
            Unknown
          </DropdownMenuCheckboxItem>
        )}
        {isFiltered && (
          <>
            <DropdownMenuSeparator />
            <button
              type="button"
              className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent"
              onClick={() => onChange(new Set())}
            >
              Clear filter
            </button>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
