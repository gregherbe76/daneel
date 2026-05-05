import { logger } from "./logger";

/**
 * Outbound email transport for admin operational alerts (e.g. consecutive
 * sweep failures). Two transports are supported and selected by env vars at
 * call time so the same deployment can be reconfigured without a redeploy:
 *
 * 1. `SENDGRID_API_KEY` (preferred when set) — uses SendGrid's HTTPS API,
 *    no extra deps. Same provider notifications.ts uses for regression
 *    notifications, so a deployment that already wired SendGrid for those
 *    automatically gets sweep-failure alerts too.
 * 2. `SMTP_HOST` (+ optional `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
 *    `SMTP_SECURE`) — uses nodemailer over SMTP. Lets self-hosted
 *    deployments point at any SMTP relay (Postfix, Mailgun SMTP, AWS SES
 *    SMTP, Gmail app password, etc.).
 *
 * The "from" address comes from `ALERT_FROM_EMAIL`, falling back to
 * `NOTIFICATION_FROM_EMAIL`, then a safe `no-reply@hiring.local` default.
 */

export type AlertTransport = "sendgrid" | "smtp" | "none";

export function detectAlertTransport(): AlertTransport {
  if (process.env["SENDGRID_API_KEY"]) return "sendgrid";
  if (process.env["SMTP_HOST"]) return "smtp";
  return "none";
}

function fromAddress(): string {
  return (
    process.env["ALERT_FROM_EMAIL"] ??
    process.env["NOTIFICATION_FROM_EMAIL"] ??
    "no-reply@hiring.local"
  );
}

interface SendArgs {
  to: string;
  subject: string;
  text: string;
}

async function sendViaSendGrid({ to, subject, text }: SendArgs): Promise<void> {
  const apiKey = process.env["SENDGRID_API_KEY"];
  if (!apiKey) throw new Error("SENDGRID_API_KEY is not configured");
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromAddress() },
      subject,
      content: [{ type: "text/plain", value: text }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`SendGrid request failed: ${res.status} ${errBody}`);
  }
}

async function sendViaSmtp({ to, subject, text }: SendArgs): Promise<void> {
  const host = process.env["SMTP_HOST"];
  if (!host) throw new Error("SMTP_HOST is not configured");
  const portRaw = process.env["SMTP_PORT"];
  const port = portRaw ? Number(portRaw) : 587;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid SMTP_PORT: ${portRaw}`);
  }
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  const secureEnv = process.env["SMTP_SECURE"];
  // SMTPS (implicit TLS) is conventionally on 465; otherwise default to
  // STARTTLS on 587. `SMTP_SECURE=true|false` lets operators force either.
  const secure = secureEnv
    ? secureEnv.toLowerCase() === "true"
    : port === 465;

  // Imported dynamically so deployments that never use SMTP don't pay the
  // module-load cost, and so the build stays clean (`nodemailer` is in the
  // esbuild externals list).
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
  await transporter.sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
  });
}

/**
 * Send an admin alert email using whatever transport the deployment has
 * configured. Throws on transport errors so callers can log/swallow them
 * — `maybeFireAlert` wraps this in a try/catch so a flaky mail server can
 * never fail a sweep.
 */
export async function sendAlertEmail(args: SendArgs): Promise<AlertTransport> {
  const transport = detectAlertTransport();
  if (transport === "sendgrid") {
    await sendViaSendGrid(args);
    return "sendgrid";
  }
  if (transport === "smtp") {
    await sendViaSmtp(args);
    return "smtp";
  }
  logger.warn(
    { to: args.to },
    "Alert email not delivered — no transport configured (set SENDGRID_API_KEY or SMTP_HOST)",
  );
  return "none";
}
