import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  status: string | null | undefined;
  reason?: string | null;
  className?: string;
  showLabel?: boolean;
};

const STYLES: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  valid: {
    label: "Verified",
    className: "text-emerald-700 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  invalid: {
    label: "Undeliverable",
    className: "text-red-700 dark:text-red-400",
    Icon: XCircle,
  },
  risky: {
    label: "Risky",
    className: "text-amber-700 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  unchecked: {
    label: "Unverified",
    className: "text-muted-foreground",
    Icon: HelpCircle,
  },
};

export function EmailValidationBadge({ status, reason, className, showLabel = true }: Props) {
  if (!status) return null;
  const cfg = STYLES[status];
  if (!cfg) return null;
  const { Icon, label } = cfg;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", cfg.className, className)}
      title={reason ?? label}
    >
      <Icon className="h-3 w-3" />
      {showLabel && <span>{label}</span>}
    </span>
  );
}
