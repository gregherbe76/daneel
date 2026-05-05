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

export interface TelemetryDashboard {
  configured: boolean;
  range: TelemetryRange;
  events: TelemetryEventStats[];
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

function emptyDashboard(range: TelemetryRange, configured: boolean): TelemetryDashboard {
  return {
    configured,
    range,
    events: ALLOWED_EVENTS.map((event) => ({ event, total: 0, daily: [] })),
  };
}

/**
 * Query PostHog for daily counts of the five allow-listed telemetry events.
 * Returns a calm "not configured" payload if the server has no PostHog
 * credentials, so the UI can render a configuration hint instead of erroring.
 */
export async function fetchTelemetryDashboard(
  range: TelemetryRange,
): Promise<TelemetryDashboard> {
  const config = getConfig();
  if (!config) return emptyDashboard(range, false);

  const days = range === "30d" ? 30 : 7;
  const eventList = ALLOWED_EVENTS.map((e) => `'${e}'`).join(", ");
  const hogql = `SELECT event, toString(toDate(timestamp)) AS day, count() AS cnt
FROM events
WHERE event IN (${eventList})
  AND timestamp >= now() - INTERVAL ${days} DAY
GROUP BY event, day
ORDER BY day ASC`;

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
  const rows = Array.isArray(json.results) ? json.results : [];

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

  return { configured: true, range, events };
}
