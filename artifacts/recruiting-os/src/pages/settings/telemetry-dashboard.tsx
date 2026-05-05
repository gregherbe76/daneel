import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGetTelemetryDashboard } from "@workspace/api-client-react";
import { SettingsTabs } from "@/components/settings-tabs";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, BarChart3 } from "lucide-react";

type Range = "7d" | "30d";

const EVENT_LABELS: Record<string, string> = {
  workflow_started: "Workflow started",
  workflow_completed: "Workflow completed",
  provider_card_viewed: "Provider card viewed",
  provider_connect_clicked: "Provider connect clicked",
  provider_connected: "Provider connected",
};

function buildSeries(
  daily: { date: string; count: number }[],
  range: Range,
): { date: string; count: number }[] {
  const days = range === "30d" ? 30 : 7;
  const map = new Map(daily.map((d) => [d.date, d.count]));
  const out: { date: string; count: number }[] = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, count: map.get(iso) ?? 0 });
  }
  return out;
}

function formatTick(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function TelemetryDashboardPage() {
  const [range, setRange] = useState<Range>("7d");
  const query = useGetTelemetryDashboard({ range });

  const events = useMemo(() => query.data?.events ?? [], [query.data]);
  const configured = query.data?.configured ?? false;

  return (
    <div>
      <SettingsTabs />
      <div className="p-8 max-w-6xl space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-6 w-6" />
              Telemetry dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Aggregate counts for the five allow-listed events over the
              selected range. Data comes from the PostHog Query API via a
              server-side key — the project key is never exposed to the
              browser.
            </p>
          </div>
          <div
            className="inline-flex border border-border rounded-md overflow-hidden"
            role="tablist"
            aria-label="Time range"
          >
            {(["7d", "30d"] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={range === r}
                onClick={() => setRange(r)}
                data-testid={`telemetry-range-${r}`}
                className={`px-3 py-1.5 text-sm ${
                  range === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                Last {r === "7d" ? "7 days" : "30 days"}
              </button>
            ))}
          </div>
        </div>

        {query.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {query.isError && (
          <div className="border border-amber-500/40 bg-amber-500/10 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-foreground">
                Couldn't load telemetry data
              </p>
              <p className="text-muted-foreground mt-1">
                {query.error instanceof Error
                  ? query.error.message
                  : "The PostHog query failed."}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => query.refetch()}
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {query.data && !configured && (
          <div className="border border-border rounded-lg p-5 bg-muted/30">
            <p className="text-sm font-medium text-foreground">
              PostHog credentials not configured
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Set <code className="text-xs">POSTHOG_PERSONAL_API_KEY</code> and{" "}
              <code className="text-xs">POSTHOG_PROJECT_ID</code> on the API
              server (and optionally{" "}
              <code className="text-xs">POSTHOG_HOST</code>, defaults to{" "}
              <code className="text-xs">https://eu.posthog.com</code>) to
              activate the dashboard. The browser never sees these values.
            </p>
          </div>
        )}

        {query.data && configured && (
          <div className="grid gap-5 md:grid-cols-2">
            {events.map((stats) => {
              const series = buildSeries(stats.daily, range);
              const label = EVENT_LABELS[stats.event] ?? stats.event;
              return (
                <div
                  key={stats.event}
                  className="border border-border rounded-lg p-5 bg-card"
                  data-testid={`telemetry-card-${stats.event}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-medium text-foreground">
                      {label}
                    </h2>
                    <code className="text-[10px] text-muted-foreground">
                      {stats.event}
                    </code>
                  </div>
                  <p
                    className="text-3xl font-semibold text-foreground mt-2"
                    data-testid={`telemetry-total-${stats.event}`}
                  >
                    {stats.total.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Total events in last {range === "7d" ? "7" : "30"} days
                  </p>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={series}
                        margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatTick}
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                          width={32}
                        />
                        <Tooltip
                          labelFormatter={(v) => formatTick(String(v))}
                          contentStyle={{
                            background: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
