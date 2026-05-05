import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { loggerMock, sendMailMock, createTransportMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sendMailMock: vi.fn(async () => ({ messageId: "test" })),
  createTransportMock: vi.fn(),
}));
createTransportMock.mockImplementation(() => ({ sendMail: sendMailMock }));

vi.mock("./logger", () => ({ logger: loggerMock }));
vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

import { detectAlertTransport, sendAlertEmail } from "./alert-email";

const ENV_KEYS = [
  "SENDGRID_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_SECURE",
  "ALERT_FROM_EMAIL",
  "NOTIFICATION_FROM_EMAIL",
];

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
  sendMailMock.mockClear();
  createTransportMock.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = originalEnv[k];
    }
  }
});

describe("detectAlertTransport", () => {
  it("returns 'none' when no env is set", () => {
    expect(detectAlertTransport()).toBe("none");
  });

  it("prefers sendgrid when both are set", () => {
    process.env["SENDGRID_API_KEY"] = "sg-key";
    process.env["SMTP_HOST"] = "smtp.example.com";
    expect(detectAlertTransport()).toBe("sendgrid");
  });

  it("falls back to smtp when only SMTP_HOST is set", () => {
    process.env["SMTP_HOST"] = "smtp.example.com";
    expect(detectAlertTransport()).toBe("smtp");
  });
});

describe("sendAlertEmail", () => {
  it("returns 'none' and warns when no transport is configured", async () => {
    const out = await sendAlertEmail({
      to: "ops@example.com",
      subject: "x",
      text: "y",
    });
    expect(out).toBe("none");
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends via SendGrid when SENDGRID_API_KEY is configured", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-key";
    process.env["ALERT_FROM_EMAIL"] = "alerts@example.com";
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const out = await sendAlertEmail({
      to: "ops@example.com",
      subject: "boom",
      text: "details",
    });

    expect(out).toBe("sendgrid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.personalizations[0].to[0].email).toBe("ops@example.com");
    expect(body.from.email).toBe("alerts@example.com");
    expect(body.subject).toBe("boom");
    vi.unstubAllGlobals();
  });

  it("throws when SendGrid responds non-2xx so the caller can log", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-key";
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await expect(
      sendAlertEmail({ to: "ops@example.com", subject: "x", text: "y" }),
    ).rejects.toThrow(/SendGrid request failed: 401/);
    vi.unstubAllGlobals();
  });

  it("sends via SMTP using nodemailer when SMTP_HOST is configured", async () => {
    process.env["SMTP_HOST"] = "smtp.example.com";
    process.env["SMTP_PORT"] = "2525";
    process.env["SMTP_USER"] = "u";
    process.env["SMTP_PASS"] = "p";
    process.env["ALERT_FROM_EMAIL"] = "alerts@example.com";

    const out = await sendAlertEmail({
      to: "ops@example.com",
      subject: "boom",
      text: "details",
    });

    expect(out).toBe("smtp");
    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 2525,
      secure: false,
      auth: { user: "u", pass: "p" },
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "alerts@example.com",
      to: "ops@example.com",
      subject: "boom",
      text: "details",
    });
  });

  it("defaults SMTP port 465 to secure=true (implicit TLS)", async () => {
    process.env["SMTP_HOST"] = "smtp.example.com";
    process.env["SMTP_PORT"] = "465";

    await sendAlertEmail({ to: "a@b.com", subject: "s", text: "t" });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true, auth: undefined }),
    );
  });

  it("propagates SMTP send errors so the caller can log", async () => {
    process.env["SMTP_HOST"] = "smtp.example.com";
    sendMailMock.mockRejectedValueOnce(new Error("relay refused"));

    await expect(
      sendAlertEmail({ to: "a@b.com", subject: "s", text: "t" }),
    ).rejects.toThrow(/relay refused/);
  });
});
