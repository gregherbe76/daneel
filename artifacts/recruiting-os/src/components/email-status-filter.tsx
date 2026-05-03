import { AlertTriangle, CheckCircle2, HelpCircle, XCircle, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

export type EmailStatusFilterValue = "all" | "valid" | "risky" | "invalid" | "unchecked";

export const EMAIL_STATUS_FILTER_VALUES: EmailStatusFilterValue[] = [
  "all",
  "valid",
  "risky",
  "invalid",
  "unchecked",
];

export function isEmailStatusFilterValue(v: string | null | undefined): v is EmailStatusFilterValue {
  return !!v && (EMAIL_STATUS_FILTER_VALUES as string[]).includes(v);
}

export function matchesEmailStatusFilter(
  status: string | null | undefined,
  filter: EmailStatusFilterValue,
): boolean {
  if (filter === "all") return true;
  if (filter === "unchecked") return !status || status === "unchecked";
  return status === filter;
}

const CHIPS: {
  value: EmailStatusFilterValue;
  label: string;
  Icon: typeof CheckCircle2;
  activeClass: string;
}[] = [
  {
    value: "all",
    label: "All",
    Icon: Mail,
    activeClass: "bg-foreground text-background border-foreground",
  },
  {
    value: "valid",
    label: "Verified",
    Icon: CheckCircle2,
    activeClass:
      "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800",
  },
  {
    value: "risky",
    label: "Risky",
    Icon: AlertTriangle,
    activeClass:
      "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
  },
  {
    value: "invalid",
    label: "Undeliverable",
    Icon: XCircle,
    activeClass:
      "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
  },
  {
    value: "unchecked",
    label: "Unverified",
    Icon: HelpCircle,
    activeClass: "bg-muted text-foreground border-border",
  },
];

type Props = {
  value: EmailStatusFilterValue;
  onChange: (value: EmailStatusFilterValue) => void;
  counts?: Partial<Record<EmailStatusFilterValue, number>>;
  className?: string;
};

export function EmailStatusFilter({ value, onChange, counts, className }: Props) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      role="group"
      aria-label="Filter by email deliverability"
    >
      {CHIPS.map((chip) => {
        const isActive = value === chip.value;
        const { Icon } = chip;
        const count = counts?.[chip.value];
        return (
          <button
            key={chip.value}
            type="button"
            onClick={() => onChange(chip.value)}
            aria-pressed={isActive}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              isActive
                ? chip.activeClass
                : "bg-background text-muted-foreground border-border hover:bg-muted",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{chip.label}</span>
            {typeof count === "number" && (
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 py-0 text-[10px] font-semibold",
                  isActive ? "bg-background/30" : "bg-muted",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
