import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type Express } from "express";

const sendTestNotificationMock = vi.fn();

vi.mock("../lib/notifications", () => ({
  // Stubs for the other lib exports settings.ts pulls in. The route under
  // test only invokes sendTestNotification, so the rest can be no-ops.
  getNotificationSettings: vi.fn(async () => ({})),
  updateNotificationSettings: vi.fn(async () => ({})),
  sendTestNotification: sendTestNotificationMock,
}));

vi.mock("../lib/email-revalidation", () => ({
  getEmailRevalidationSettings: vi.fn(async () => ({})),
  updateEmailRevalidationSettings: vi.fn(async () => ({})),
  listRecentEmailRevalidationRuns: vi.fn(async () => []),
  sweepStaleEmailValidations: vi.fn(async () => ({})),
  getEmailRevalidationAlertStatus: vi.fn(async () => ({})),
}));

const settingsRouter = (await import("./settings")).default;
const supertest = (await import("supertest")).default;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // Hand-roll a tiny req.log so the route's `req.log.info()` call works
  // without pulling in pino-http and the full app middleware stack.
  app.use((req, _res, next) => {
    (req as unknown as { log: { info: () => void } }).log = { info: () => {} };
    next();
  });
  app.use("/api", settingsRouter);
  return app;
}

beforeEach(() => {
  sendTestNotificationMock.mockReset();
});

describe("POST /api/settings/notifications/test", () => {
  it("returns 200 with { results } shaped exactly like sendTestNotification()", async () => {
    const fakeResults = [
      { channel: "slack", attempted: true, ok: true },
      {
        channel: "email",
        attempted: false,
        ok: false,
        skippedReason: "Email notifications are turned off.",
      },
    ];
    sendTestNotificationMock.mockResolvedValueOnce(fakeResults);

    const res = await supertest(buildApp())
      .post("/api/settings/notifications/test")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: fakeResults });
    expect(sendTestNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a per-channel failure result faithfully (the route does not collapse errors)", async () => {
    const fakeResults = [
      {
        channel: "slack",
        attempted: true,
        ok: false,
        error: "Slack webhook failed: 500 boom",
      },
    ];
    sendTestNotificationMock.mockResolvedValueOnce(fakeResults);

    const res = await supertest(buildApp())
      .post("/api/settings/notifications/test")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(fakeResults);
    expect(res.body.results[0]).toHaveProperty("error");
  });

  it("ignores any request body — the endpoint takes no parameters", async () => {
    sendTestNotificationMock.mockResolvedValueOnce([]);

    const res = await supertest(buildApp())
      .post("/api/settings/notifications/test")
      .send({ channel: "slack", anythingElse: 123 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [] });
    // sendTestNotification is invoked with no arguments (it reads settings
    // itself); the body is intentionally ignored.
    expect(sendTestNotificationMock).toHaveBeenCalledWith();
  });

  it("surfaces a thrown error from sendTestNotification as a 500 (Express default)", async () => {
    sendTestNotificationMock.mockRejectedValueOnce(
      new Error("settings table unreachable"),
    );

    const res = await supertest(buildApp())
      .post("/api/settings/notifications/test")
      .send({});

    expect(res.status).toBe(500);
  });
});
