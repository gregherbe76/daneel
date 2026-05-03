/**
 * Small label that tells recruiters where a candidate's email came from
 * so they can gauge how much to trust it before sending outreach.
 *
 * Provider semantics (set on the server when the candidate is created):
 *   - profile:   verified profile email (e.g. public GitHub email)
 *   - commit:    inferred from public commit metadata — best effort, not verified
 *   - noreply:   placeholder noreply address — NOT deliverable
 *   - generated: AI/mock placeholder (e.g. *.mock@example.com) — NOT deliverable
 *   - manual:    entered by a recruiter
 */
type EmailSource = "profile" | "commit" | "noreply" | "generated" | "manual";

const STYLES: Record<
  EmailSource,
  { label: string; className: string; title: string }
> = {
  profile: {
    label: "Profile",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    title: "From the candidate's verified profile (highest trust)",
  },
  commit: {
    label: "From commits",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    title:
      "Inferred from public commit metadata — best effort, double-check before outreach",
  },
  noreply: {
    label: "Noreply",
    className:
      "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    title: "Placeholder noreply address — not deliverable",
  },
  generated: {
    label: "Mock",
    className:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
    title: "AI-generated placeholder — not a real address",
  },
  manual: {
    label: "Manual",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    title: "Entered by a recruiter",
  },
};

export function EmailSourceBadge({
  source,
  className = "",
}: {
  source: string | null | undefined;
  className?: string;
}) {
  if (!source) return null;
  const style = STYLES[source as EmailSource];
  if (!style) return null;
  return (
    <span
      title={style.title}
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${style.className} ${className}`}
    >
      {style.label}
    </span>
  );
}
