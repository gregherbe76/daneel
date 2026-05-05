import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import TelemetryDashboardPage from "./telemetry-dashboard";

type Range = "7d" | "30d";
type DashboardData = {
  configured: boolean;
  range: Range;
  events: { event: string; total: number; daily: { date: string; count: number }[] }[];
};

const ALLOWED_EVENTS = [
  "workflow_started",
  "workflow_completed",
  "provider_card_viewed",
  "provider_connect_clicked",
  "provider_connected",
] as const;

let mockResponse: {
  data?: DashboardData;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
};
let lastParams: { range?: Range } | undefined;

vi.mock("@workspace/api-client-react", () => ({
  useGetTelemetryDashboard: (params?: { range?: Range }) => {
    lastParams = params;
    return {
      data: mockResponse.data,
      isLoading: mockResponse.isLoading ?? false,
      isError: mockResponse.isError ?? false,
      error: mockResponse.error ?? null,
      refetch: vi.fn(),
    };
  },
}));

// Recharts' ResponsiveContainer needs a real layout to render its children;
// jsdom has no layout so we stub it out with a plain pass-through wrapper.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

function renderPage() {
  return render(
    <Router
      hook={memoryLocation({ path: "/settings/telemetry/dashboard" }).hook}
    >
      <TelemetryDashboardPage />
    </Router>,
  );
}

function fullDashboard(range: Range): DashboardData {
  return {
    configured: true,
    range,
    events: [
      {
        event: "workflow_started",
        total: 12,
        daily: [{ date: "2026-05-01", count: 12 }],
      },
      {
        event: "workflow_completed",
        total: 9,
        daily: [{ date: "2026-05-01", count: 9 }],
      },
      {
        event: "provider_card_viewed",
        total: 47,
        daily: [{ date: "2026-05-02", count: 47 }],
      },
      {
        event: "provider_connect_clicked",
        total: 5,
        daily: [{ date: "2026-05-02", count: 5 }],
      },
      {
        event: "provider_connected",
        total: 3,
        daily: [{ date: "2026-05-03", count: 3 }],
      },
    ],
  };
}

beforeEach(() => {
  mockResponse = {};
  lastParams = undefined;
});

describe("TelemetryDashboardPage", () => {
  it("renders one card per allow-listed event with the correct total when configured", () => {
    mockResponse = { data: fullDashboard("7d") };
    renderPage();

    for (const event of ALLOWED_EVENTS) {
      const card = screen.getByTestId(`telemetry-card-${event}`);
      expect(card).toBeInTheDocument();
      // The raw event name appears as the <code> caption inside the card.
      expect(within(card).getByText(event)).toBeInTheDocument();
    }
    // Five cards, no more, no less.
    const cards = screen.getAllByTestId(/^telemetry-card-/);
    expect(cards).toHaveLength(ALLOWED_EVENTS.length);

    // Totals from the mocked payload are surfaced in the header number.
    expect(
      screen.getByTestId("telemetry-total-workflow_started"),
    ).toHaveTextContent("12");
    expect(
      screen.getByTestId("telemetry-total-workflow_completed"),
    ).toHaveTextContent("9");
    expect(
      screen.getByTestId("telemetry-total-provider_card_viewed"),
    ).toHaveTextContent("47");
    expect(
      screen.getByTestId("telemetry-total-provider_connect_clicked"),
    ).toHaveTextContent("5");
    expect(
      screen.getByTestId("telemetry-total-provider_connected"),
    ).toHaveTextContent("3");

    // No "not configured" hint should be visible in the configured state.
    expect(
      screen.queryByText(/PostHog credentials not configured/i),
    ).not.toBeInTheDocument();
  });

  it("toggling between 7d and 30d updates aria-selected and refetches with the new range", async () => {
    mockResponse = { data: fullDashboard("7d") };
    renderPage();

    const tab7 = screen.getByTestId("telemetry-range-7d");
    const tab30 = screen.getByTestId("telemetry-range-30d");

    // 7d is the default.
    expect(tab7).toHaveAttribute("aria-selected", "true");
    expect(tab30).toHaveAttribute("aria-selected", "false");
    expect(lastParams).toEqual({ range: "7d" });

    await userEvent.click(tab30);

    expect(tab30).toHaveAttribute("aria-selected", "true");
    expect(tab7).toHaveAttribute("aria-selected", "false");
    // The hook must be re-invoked with the new range param so the server
    // returns 30 days of data.
    expect(lastParams).toEqual({ range: "30d" });

    await userEvent.click(tab7);
    expect(tab7).toHaveAttribute("aria-selected", "true");
    expect(lastParams).toEqual({ range: "7d" });
  });

  it("renders the 'PostHog credentials not configured' hint and no event cards when configured:false", () => {
    mockResponse = {
      data: {
        configured: false,
        range: "7d",
        events: ALLOWED_EVENTS.map((event) => ({
          event,
          total: 0,
          daily: [],
        })),
      },
    };
    renderPage();

    expect(
      screen.getByText(/PostHog credentials not configured/i),
    ).toBeInTheDocument();
    // The range toggle still renders so the hint isn't the only thing on the page.
    expect(screen.getByTestId("telemetry-range-7d")).toBeInTheDocument();
    // Cards are gated behind `configured`, so none should render.
    expect(screen.queryAllByTestId(/^telemetry-card-/)).toHaveLength(0);
  });
});
