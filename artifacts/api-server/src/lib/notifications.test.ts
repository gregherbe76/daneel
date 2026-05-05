import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recipient = { email: string; mode: "instant" | "digest" };

const settingsState = {
  current: {
    emailEnabled: false,
    emailRecipients: [] as Recipient[],
    slackEnabled: false,
    slackWebhookUrl: null as string | null,
    emailDeliveryConfigured: false,
    digestCadenceHours: 24,
    digestLastSentAt: null as Date | null,
    updatedAt: new Date(),
  },
};

const updateCalls: { id: number; sentAt: Date | null }[] = [];

vi.mock("@workspace/db", () => {
  return {
    db: {
      update: () => ({
        set: (vals: { notificationSentAt: Date }) => ({
          where: async () => {
            updateCalls.push({ id: 1, sentAt: vals.notificationSentAt });
            return [];
          },
        }),
      }),
    },
    notificationSettingsTable: {},
    emailStatusChangesTable: { id: "id" },
  };
});

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { dispatchRegressionNotification } = await import("./notifications");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  updateCalls.length = 0;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env["SENDGRID_API_KEY"];
});

const sampleChange = {
  id: 1,
  candidateId: 42,
  previousStatus: "valid",
  newStatus: "invalid",
  newReason: "MX lookup failed",
};
const sampleCandidate = { name: "Alice Example", email: "alice@example.com" };

describe("notifyRegression", () => {
  it("does nothing when both channels are disabled", async () => {
    settingsState.current = {
      ...settingsState.current,
      emailEnabled: false,
      slackEnabled: false,
    };
    await dispatchRegressionNotification(
      settingsState.current,
      sampleChange,
      sampleCandidate,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("posts to Slack when slack is enabled and stamps notificationSentAt", async () => {
    settingsState.current = {
      ...settingsState.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
      emailEnabled: false,
    };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    await dispatchRegressionNotification(
      settingsState.current,
      sampleChange,
      sampleCandidate,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hooks.slack.test/abc");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.text).toContain("Alice Example");
    expect(body.text).toContain("valid → invalid");
    expect(body.text).toContain("MX lookup failed");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.sentAt).toBeInstanceOf(Date);
  });

  it("does not stamp notificationSentAt when every channel fails", async () => {
    settingsState.current = {
      ...settingsState.current,
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/bad",
      emailEnabled: false,
    };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "boom",
    });

    await dispatchRegressionNotification(settingsState.current, sampleChange, sampleCandidate);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateCalls).toHaveLength(0);
  });

  it("skips email when emailDeliveryConfigured is false even if enabled", async () => {
    settingsState.current = {
      ...settingsState.current,
      emailEnabled: true,
      emailRecipients: [{ email: "bob@example.com", mode: "instant" }],
      emailDeliveryConfigured: false,
      slackEnabled: false,
    };
    await dispatchRegressionNotification(settingsState.current, sampleChange, sampleCandidate);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("sends email via SendGrid when configured and enabled", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    settingsState.current = {
      ...settingsState.current,
      emailEnabled: true,
      emailRecipients: [
        { email: "bob@example.com", mode: "instant" },
        { email: "carol@example.com", mode: "instant" },
      ],
      emailDeliveryConfigured: true,
      slackEnabled: false,
    };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });

    await dispatchRegressionNotification(settingsState.current, sampleChange, sampleCandidate);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe("Bearer sg-test-key");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.personalizations[0].to).toEqual([
      { email: "bob@example.com" },
      { email: "carol@example.com" },
    ]);
    expect(body.subject).toContain("Alice Example");
    expect(updateCalls).toHaveLength(1);
  });
});
