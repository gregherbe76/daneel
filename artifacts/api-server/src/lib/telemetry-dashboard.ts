import { logger } from "./logger";

const ALLOWED_EVENTS = [
  "workflow_started",
  "workflow_completed",
  "provider_card_viewed",
  "provider_connect_clicked",
  "provider_connected",
] as const;

export type TelemetryRange = "7d" | "30d";

export interface TelemetryDailyCount {
  date: string;
  count: number;
}

export interface TelemetryEventStats {
  event: string;
  total: number;
  daily: TelemetryDailyCount[];
}

export interface TelemetryDashboardFilters {
  provider?: string;
  workflowStep?: string;
}

export interface TelemetryDashboard {
  configured: boolean;
  range: TelemetryRange;
  events: TelemetryEventStats[];
  filters: { provider: string | null; workflowStep: string | null };
  availableFilters: { providers: string[]; workflowSteps: string[] };
}

function getConfig(): { host: string; projectId: string; apiKey: string } | null {
  const apiKey = process.env["POSTHOG_PERSONAL_API_KEY"];
  const projectId = process.env["POSTHOG_PROJECT_ID"];
  if (!apiKey || !projectId) return null;
  const host = (process.env["POSTHOG_HOST"] ?? "https://eu.posthog.com").replace(
    /\/$/,
    "",
  );
  return { host, projectId, apiKey };
}

/**
 * Sanitize a user-supplied filter value for safe inclusion in a HogQL string
 * literal. We intentionally restrict to a conservative character set
 * ([A-Za-z0-9_.\-: ]) — the legitimate values for `provider` and
 * `workflow_step` are short identifiers like `native-openai` or
 * `candidate_matching`, never free-form text. Anything outside the set is
 * dropped and the filter is treated as absent so we never inject quotes or
 * backslashes into HogQL.
 */
function sanitizeFilter(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 100) return null;
  if (!/^[A-Za-z0-9_.\-: ]+$/.test(trimmed)) return null;
  return trimmed;
}

function emptyDashboard(
  range: TelemetryRange,
  configured: boolean,
  filters: { provider: string | null; workflowStep: string | null },
): TelemetryDashboard {
  return {
    configured,
    range,
    events: ALLOWED_EVENTS.map((event) => ({ event, total: 0, daily: [] })),
    filters,
    availableFilters: { providers: [], workflowSteps: [] },
  };
}

async function runHogql<T>(
  config: { host: string; projectId: string; apiKey: string },
  hogql: string,
): Promise<T[]> {
  const url = `${config.host}/api/projects/${encodeURIComponent(config.projectId)}/query/`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: { kind: "HogQLQuery", query: hogql },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, body: text.slice(0, 500) },
      "PostHog query failed",
    );
    throw new Error(`PostHog query failed (${res.status})`);
  }

  const json = (await res.json()) as { results?: unknown };
  return Array.isArray(json.results) ? (json.results as T[]) : [];
}

/**
 * Query PostHog for daily counts of the five allow-listed telemetry events.
 * Returns a calm "not configured" payload if the server has no PostHog
 * credentials, so the UI can render a configuration hint instead of erroring.
 *
 * Optional `provider` / `workflowStep` filters are appended as HogQL `WHERE`
 * conditions on `properties.provider` and `properties.workflow_step` so the
 * product team can slice the funnel without leaving the page.
 */
export async function fetchTelemetryDashboard(
  range: TelemetryRange,
  rawFilters: TelemetryDashboardFilters = {},
): Promise<TelemetryDashboard> {
  const provider = sanitizeFilter(rawFilters.provider);
  const workflowStep = sanitizeFilter(rawFilters.workflowStep);
  const appliedFilters = { provider, workflowStep };

  const config = getConfig();
  if (!config) return emptyDashboard(range, false, appliedFilters);

  const days = range === "30d" ? 30 : 7;
  const eventList = ALLOWED_EVENTS.map((e) => `'${e}'`).join(", ");
  const extraConditions: string[] = [];
  if (provider) extraConditions.push(`properties.provider = '${provider}'`);
  if (workflowStep) {
    extraConditions.push(`properties.workflow_step = '${workflowStep}'`);
  }
  const extraWhere = extraConditions.length
    ? `\n  AND ${extraConditions.join("\n  AND ")}`
    : "";

  const hogql = `SELECT event, toString(toDate(timestamp)) AS day, count() AS cnt
FROM events
WHERE event IN (${eventList})
  AND timestamp >= now() - INTERVAL ${days} DAY${extraWhere}
GROUP BY event, day
ORDER BY day ASC`;

  // Discover distinct provider / workflow_step values present in the same
  // time window so the UI can build dropdowns from real data rather than a
  // hard-coded list. We deliberately do NOT apply the current filters here —
  // otherwise selecting "provider = X" would collapse the workflow-step
  // dropdown to only the steps that fired for X, making it impossible to
  // switch to a different combination.
  const distinctHogql = `SELECT
  arraySort(groupUniqArray(properties.provider)) AS providers,
  arraySort(groupUniqArray(properties.workflow_step)) AS workflow_steps
FROM events
WHERE event IN (${eventList})
  AND timestamp >= now() - INTERVAL ${days} DAY`;

  const [rows, distinctRows] = await Promise.all([
    runHogql<unknown>(config, hogql),
    runHogql<unknown>(config, distinctHogql),
  ]);

  const byEvent = new Map<string, Map<string, number>>();
  for (const event of ALLOWED_EVENTS) byEvent.set(event, new Map());

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const event = String(row[0]);
    const day = String(row[1]);
    const cnt = Number(row[2]);
    const bucket = byEvent.get(event);
    if (!bucket || !Number.isFinite(cnt)) continue;
    bucket.set(day, (bucket.get(day) ?? 0) + cnt);
  }

  const events: TelemetryEventStats[] = ALLOWED_EVENTS.map((event) => {
    const bucket = byEvent.get(event) ?? new Map<string, number>();
    const daily = Array.from(bucket.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, count]) => ({ date, count }));
    const total = daily.reduce((acc, d) => acc + d.count, 0);
    return { event, total, daily };
  });

  const cleanList = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const v of raw) {
      if (typeof v !== "string") continue;
      const trimmed = v.trim();
      if (trimmed) out.push(trimmed);
    }
    return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
  };

  const firstDistinct = Array.isArray(distinctRows[0]) ? distinctRows[0] : [];
  const providers = cleanList(firstDistinct[0]);
  const workflowSteps = cleanList(firstDistinct[1]);

  return {
    configured: true,
    range,
    events,
    filters: appliedFilters,
    availableFilters: { providers, workflowSteps },
  };
}
