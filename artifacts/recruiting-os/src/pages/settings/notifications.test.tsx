import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Recipient = { email: string; mode: "instant" | "digest" };
type ChannelResult = {
  channel: "email" | "slack";
  attempted: boolean;
  ok: boolean;
  skippedReason?: string | null;
  error?: string | null;
};

const settings = {
  current: {
    emailEnabled: false,
    emailRecipients: [] as Recipient[],
    slackEnabled: false,
    slackWebhookUrl: null as string | null,
    emailDeliveryConfigured: true,
    digestCadenceHours: 24,
    digestLastSentAt: null as string | null,
    updatedAt: new Date().toISOString(),
  },
};

const testMutationState: {
  nextResults: ChannelResult[];
  nextError: Error | null;
  pending: boolean;
  calls: number;
} = { nextResults: [], nextError: null, pending: false, calls: 0 };

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@workspace/api-client-react", () => {
  return {
    useGetNotificationSettings: () => ({
      data: settings.current,
      isLoading: false,
      error: null,
    }),
    useUpdateNotificationSettings: () => ({
      mutateAsync: async ({
        data,
      }: {
        data: {
          emailEnabled: boolean;
          emailRecipients: Recipient[];
          slackEnabled: boolean;
          slackWebhookUrl: string | null;
          digestCadenceHours: number;
        };
      }) => {
        settings.current = {
          ...settings.current,
          ...data,
          updatedAt: new Date().toISOString(),
        };
        return settings.current;
      },
      isPending: false,
    }),
    useSendTestNotification: () => ({
      mutateAsync: async () => {
        testMutationState.calls += 1;
        if (testMutationState.nextError) throw testMutationState.nextError;
        return { results: testMutationState.nextResults };
      },
      isPending: testMutationState.pending,
    }),
    getGetNotificationSettingsQueryKey: () => ["notification-settings"],
  };
});

const NotificationsPage = (await import("./notifications")).default;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memoryLocation({ path: "/settings/notifications" }).hook}>
        <NotificationsPage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  toastMock.mockReset();
  testMutationState.nextResults = [];
  testMutationState.nextError = null;
  testMutationState.pending = false;
  testMutationState.calls = 0;
  settings.current = {
    emailEnabled: false,
    emailRecipients: [],
    slackEnabled: false,
    slackWebhookUrl: null,
    emailDeliveryConfigured: true,
    digestCadenceHours: 24,
    digestLastSentAt: null,
    updatedAt: new Date().toISOString(),
  };
});

describe("NotificationsSettingsPage – Send test button", () => {
  it("is disabled when both Email and Slack are off (nothing to test)", () => {
    renderPage();
    const btn = screen.getByTestId("button-send-test-notification");
    expect(btn).toBeDisabled();
  });

  it("is disabled while the form is dirty (must save before testing)", async () => {
    settings.current = {
      ...settings.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
    };
    renderPage();

    const btn = screen.getByTestId("button-send-test-notification");
    expect(btn).not.toBeDisabled();

    // Mutate the webhook URL to mark the form dirty.
    const webhook = screen.getByTestId("input-slack-webhook");
    await userEvent.type(webhook, "x");

    expect(btn).toBeDisabled();
  });

  it("does not call the API when the form is dirty (defensive guard)", async () => {
    settings.current = {
      ...settings.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
    };
    renderPage();

    await userEvent.type(screen.getByTestId("input-slack-webhook"), "x");

    // The button is disabled, but exercising the disabled-click path still
    // verifies neither the API nor a success toast fires.
    await userEvent
      .click(screen.getByTestId("button-send-test-notification"))
      .catch(() => undefined);

    expect(testMutationState.calls).toBe(0);
    expect(
      toastMock.mock.calls.some(
        ([arg]) => arg?.title === "Test notification sent",
      ),
    ).toBe(false);
  });

  it("renders a success row with the green check icon for a successful channel", async () => {
    settings.current = {
      ...settings.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
    };
    testMutationState.nextResults = [
      { channel: "slack", attempted: true, ok: true },
    ];
    renderPage();

    await userEvent.click(screen.getByTestId("button-send-test-notification"));

    const row = await screen.findByTestId("test-result-slack");
    expect(row).toHaveTextContent(/Slack:/);
    expect(row).toHaveTextContent(/Delivered\./);
    expect(row.className).toMatch(/green/);
  });

  it("renders a failure row with the failure copy and error message", async () => {
    settings.current = {
      ...settings.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
    };
    testMutationState.nextResults = [
      {
        channel: "slack",
        attempted: true,
        ok: false,
        error: "Slack webhook failed: 500 boom",
      },
    ];
    renderPage();

    await userEvent.click(screen.getByTestId("button-send-test-notification"));

    const row = await screen.findByTestId("test-result-slack");
    expect(row).toHaveTextContent(/Failed: Slack webhook failed: 500 boom/);
    expect(row.className).toMatch(/red/);
  });

  it("renders a skipped row with a muted tone and the skipped reason", async () => {
    settings.current = {
      ...settings.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
    };
    testMutationState.nextResults = [
      {
        channel: "email",
        attempted: false,
        ok: false,
        skippedReason: "Email notifications are turned off.",
      },
      { channel: "slack", attempted: true, ok: true },
    ];
    renderPage();

    await userEvent.click(screen.getByTestId("button-send-test-notification"));

    const emailRow = await screen.findByTestId("test-result-email");
    expect(emailRow).toHaveTextContent(/Email notifications are turned off\./);
    expect(emailRow.className).toMatch(/muted/);
  });

  it("fires a success toast when every attempted channel succeeded", async () => {
    settings.current = {
      ...settings.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
    };
    testMutationState.nextResults = [
      { channel: "slack", attempted: true, ok: true },
      {
        channel: "email",
        attempted: false,
        ok: false,
        skippedReason: "Email notifications are turned off.",
      },
    ];
    renderPage();

    await userEvent.click(screen.getByTestId("button-send-test-notification"));

    await waitFor(() => {
      const titles = toastMock.mock.calls.map(([arg]) => arg?.title);
      expect(titles).toContain("Test notification sent");
    });
    const successCall = toastMock.mock.calls.find(
      ([arg]) => arg?.title === "Test notification sent",
    )!;
    expect(successCall[0].description).toMatch(/slack/);
    expect(successCall[0].variant).not.toBe("destructive");
  });

  it("fires a destructive toast listing the failed channels when at least one fails", async () => {
    settings.current = {
      ...settings.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
      emailEnabled: true,
      emailRecipients: [{ email: "alice@example.com", mode: "instant" }],
    };
    testMutationState.nextResults = [
      { channel: "slack", attempted: true, ok: true },
      {
        channel: "email",
        attempted: true,
        ok: false,
        error: "SendGrid request failed: 401",
      },
    ];
    renderPage();

    await userEvent.click(screen.getByTestId("button-send-test-notification"));

    await waitFor(() => {
      const titles = toastMock.mock.calls.map(([arg]) => arg?.title);
      expect(titles).toContain("Some channels failed");
    });
    const call = toastMock.mock.calls.find(
      ([arg]) => arg?.title === "Some channels failed",
    )!;
    expect(call[0].variant).toBe("destructive");
    expect(call[0].description).toMatch(/email/);
  });

  it("fires a destructive 'Test failed' toast when the request itself rejects", async () => {
    settings.current = {
      ...settings.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
    };
    testMutationState.nextError = new Error("network down");
    renderPage();

    await userEvent.click(screen.getByTestId("button-send-test-notification"));

    await waitFor(() => {
      const titles = toastMock.mock.calls.map(([arg]) => arg?.title);
      expect(titles).toContain("Test failed");
    });
    const call = toastMock.mock.calls.find(
      ([arg]) => arg?.title === "Test failed",
    )!;
    expect(call[0].variant).toBe("destructive");
    expect(call[0].description).toMatch(/network down/);
  });

  it("renders a row per channel result with stable test ids", async () => {
    settings.current = {
      ...settings.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
      emailEnabled: true,
      emailRecipients: [{ email: "alice@example.com", mode: "instant" }],
    };
    testMutationState.nextResults = [
      { channel: "slack", attempted: true, ok: true },
      { channel: "email", attempted: true, ok: true },
    ];
    renderPage();

    await userEvent.click(screen.getByTestId("button-send-test-notification"));

    const container = await screen.findByTestId("test-notification-results");
    expect(within(container).getByTestId("test-result-slack")).toBeInTheDocument();
    expect(within(container).getByTestId("test-result-email")).toBeInTheDocument();
  });
});
