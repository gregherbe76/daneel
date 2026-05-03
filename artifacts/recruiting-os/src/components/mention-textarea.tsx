import { useRef, useState, useEffect } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { TeamMember, CommentMention } from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  value: string;
  onChange: (value: string, mentions: CommentMention[]) => void;
  roster: TeamMember[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/**
 * Detect names from the roster that appear after an `@` in the text and
 * return them as a deduped mentions list.
 */
function extractMentions(text: string, roster: TeamMember[]): CommentMention[] {
  const found = new Map<string, CommentMention>();
  for (const m of roster) {
    // word-boundary match preceded by @
    const re = new RegExp(`@${m.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "g");
    if (re.test(text)) {
      found.set(m.id, { id: m.id, name: m.name });
    }
  }
  return Array.from(found.values());
}

export function MentionTextarea({
  value,
  onChange,
  roster,
  placeholder,
  className,
  autoFocus,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  // Caret position where the `@` is, so we know what to replace
  const triggerStart = useRef<number | null>(null);

  const filtered = roster.filter((m) =>
    m.name.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  const updateTriggerState = (text: string, caret: number) => {
    // Look back from caret for an `@` not preceded by a word char, with no whitespace between.
    let i = caret - 1;
    while (i >= 0 && !/\s/.test(text[i])) {
      if (text[i] === "@") {
        const before = i === 0 ? " " : text[i - 1];
        if (/\s/.test(before) || i === 0) {
          triggerStart.current = i;
          setQuery(text.slice(i + 1, caret));
          setOpen(true);
          return;
        }
        break;
      }
      i--;
    }
    triggerStart.current = null;
    setOpen(false);
    setQuery("");
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next, extractMentions(next, roster));
    updateTriggerState(next, e.target.selectionStart ?? next.length);
  };

  const insertMention = (member: TeamMember) => {
    if (triggerStart.current == null) return;
    const start = triggerStart.current;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(caret);
    const insertion = `@${member.name} `;
    const next = before + insertion + after;
    onChange(next, extractMentions(next, roster));
    setOpen(false);
    triggerStart.current = null;
    requestAnimationFrame(() => {
      const pos = (before + insertion).length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(filtered[activeIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const handleSelect = () => {
    const el = ref.current;
    if (!el) return;
    updateTriggerState(value, el.selectionStart ?? value.length);
  };

  return (
    <div className="relative flex-1">
      <Textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={handleSelect}
        onKeyUp={handleSelect}
        placeholder={placeholder}
        className={className}
        autoFocus={autoFocus}
      />
      {open && filtered.length > 0 && (
        <div
          className="absolute left-0 right-0 mt-1 z-50 max-h-56 overflow-auto rounded-md border border-border bg-popover shadow-lg"
          role="listbox"
          data-testid="mention-suggestions"
        >
          {filtered.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              data-testid={`mention-option-${m.id}`}
              onMouseDown={(ev) => {
                ev.preventDefault();
                insertMention(m);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition ${
                i === activeIdx
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/60"
              }`}
            >
              <span
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white text-xs font-semibold shrink-0"
                style={{ backgroundColor: m.color }}
              >
                {m.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium block truncate">{m.name}</span>
                <span className="text-xs text-muted-foreground block truncate">
                  {m.role}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
