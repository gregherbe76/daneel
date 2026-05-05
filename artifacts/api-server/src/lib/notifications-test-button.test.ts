import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recipient = { email: string; mode: "instant" | "digest" };

interface SettingsRow {
  id: number;
  emailEnabled: boolean;
  emailRecipients: string;
  recipientModes: Record<string, "digest"> | null;
  slackEnabled: boolean;
  slackWebhookUrl: string | null;
  digestCadenceHours: number;
  digestLastSentAt: Date | null;
  updatedAt: Date;
}

const state: { row: SettingsRow | null } = { row: null };

function setSettings(input: {
  emailEnabled?: boolean;
  emailRecipients?: Recipient[];
  slackEnabled?: boolean;
  slackWebhookUrl?: string | null;
}): void {
  const recipients = input.emailRecipients ?? [];
  const modes: Record<string, "digest"> = {};
  for (const r of recipients) if (r.mode === "digest") modes[r.email] = "digest";
  state.row = {
    id: 1,
    emailEnabled: input.emailEnabled ?? false,
    emailRecipients: recipients.map((r) => r.email).join(","),
    recipientModes: modes,
    slackEnabled: input.slackEnabled ?? false,
    slackWebhookUrl: input.slackWebhookUrl ?? null,
    digestCadenceHours: 24,
    digestLastSentAt: null,
    updatedAt: new Date(),
  };
}

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(state.row ? [state.row] : []),
          innerJoin: () => ({
            where: () => ({ orderBy: () => Promise.resolve([]) }),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    },
    notificationSettingsTable: { id: "id" },
    emailStatusChangesTable: { id: "id" },
    candidatesTable: { id: "id" },
  };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { sendTestNotification } = await import("./notifications");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  state.row = null;
  delete process.env["SENDGRID_API_KEY"];
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env["SENDGRID_API_KEY"];
});

function findResult(
  results: Awaited<ReturnType<typeof sendTestNotification>>,
  channel: "slack" | "email",
) {
  const r = results.find((x) => x.channel === channel);
  if (!r) throw new Error(`expected a ${channel} result`);
  return r;
}

describe("sendTestNotification", () => {
  it("skips both channels with explicit reasons when neither is enabled", async () => {
    setSettings({ emailEnabled: false, slackEnabled: false });

    const results = await sendTestNotification();

    expect(fetchMock).not.toHaveBeenCalled();
    const slack = findResult(results, "slack");
    const email = findResult(results, "email");
    expect(slack).toMatchObject({ attempted: false, ok: false });
    expect(slack.skippedReason).toMatch(/turned off/i);
    expect(email).toMatchObject({ attempted: false, ok: false });
    expect(email.skippedReason).toMatch(/turned off/i);
  });

  it("skips Slack when enabled but no webhook URL is configured", async () => {
    setSettings({ slackEnabled: true, slackWebhookUrl: null });

    const results = await sendTestNotification();

    const slack = findResult(results, "slack");
    expect(slack).toMatchObject({ attempted: false, ok: false });
    expect(slack.skippedReason).toMatch(/no slack webhook/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips email when enabled but the recipient list is empty", async () => {
    setSettings({ emailEnabled: true, emailRecipients: [] });

    const results = await sendTestNotification();

    const email = findResult(results, "email");
    expect(email).toMatchObject({ attempted: false, ok: false });
    expect(email.skippedReason).toMatch(/no recipient/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips email when enabled with recipients but SENDGRID_API_KEY is missing", async () => {
    setSettings({
      emailEnabled: true,
      emailRecipients: [{ email: "alice@example.com", mode: "instant" }],
    });
    // No SENDGRID_API_KEY in env.

    const results = await sendTestNotification();

    const email = findResult(results, "email");
    expect(email).toMatchObject({ attempted: false, ok: false });
    expect(email.skippedReason).toMatch(/SENDGRID_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a test message to Slack and reports success", async () => {
    setSettings({
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/xyz",
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    const results = await sendTestNotification();

    const slack = findResult(results, "slack");
    expect(slack).toMatchObject({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hooks.slack.test/xyz");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.text).toMatch(/HiringAI test notification/);
    expect(body.text).toMatch(/test notification from HiringAI/);
  });

  it("captures the Slack failure message when the webhook returns non-2xx", async () => {
    setSettings({
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/dead",
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "boom",
    });

    const results = await sendTestNotification();

    const slack = findResult(results, "slack");
    expect(slack.attempted).toBe(true);
    expect(slack.ok).toBe(false);
    expect(slack.error).toMatch(/Slack webhook failed.*500/);
  });

  it("sends a test email via SendGrid to every recipient (regardless of mode) and reports success", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    setSettings({
      emailEnabled: true,
      emailRecipients: [
        { email: "alice@example.com", mode: "instant" },
        { email: "bob@example.com", mode: "digest" },
      ],
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });

    const results = await sendTestNotification();

    const email = findResult(results, "email");
    expect(email).toMatchObject({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe("Bearer sg-test-key");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.subject).toMatch(/HiringAI test notification/);
    expect(body.personalizations[0].to).toEqual([
      { email: "alice@example.com" },
      { email: "bob@example.com" },
    ]);
  });

  it("captures the SendGrid error body when the API rejects the request", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    setSettings({
      emailEnabled: true,
      emailRecipients: [{ email: "alice@example.com", mode: "instant" }],
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("unauthorized"),
    });

    const results = await sendTestNotification();

    const email = findResult(results, "email");
    expect(email.attempted).toBe(true);
    expect(email.ok).toBe(false);
    expect(email.error).toMatch(/SendGrid request failed.*401/);
  });

  it("reports each channel independently when one succeeds and the other fails", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    setSettings({
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/ok",
      emailEnabled: true,
      emailRecipients: [{ email: "alice@example.com", mode: "instant" }],
    });
    // Slack call first (declared first in sendTestNotification), then email.
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("boom"),
      });

    const results = await sendTestNotification();

    expect(findResult(results, "slack")).toMatchObject({
      attempted: true,
      ok: true,
    });
    expect(findResult(results, "email")).toMatchObject({
      attempted: true,
      ok: false,
    });
  });
});
