import { Router, type IRouter } from "express";
import {
  UpdateBulkJobsSettingsBody,
  UpdateEmailRevalidationSettingsBody,
  UpdateNotificationSettingsBody,
} from "@workspace/api-zod";
import {
  getBulkJobsSettings,
  updateBulkJobsSettings,
} from "../lib/bulk-jobs-settings";
import {
  getEmailRevalidationSettings,
  updateEmailRevalidationSettings,
  listRecentEmailRevalidationRuns,
  sweepStaleEmailValidations,
  getEmailRevalidationAlertStatus,
} from "../lib/email-revalidation";
import {
  getNotificationSettings,
  updateNotificationSettings,
  sendTestNotification,
  runDigestSweep,
  previewDigest,
} from "../lib/notifications";

const router: IRouter = Router();

function shapeBulkJobsSettings(row: {
  retentionDays: number;
  updatedAt: Date;
}): { retentionDays: number; updatedAt: Date } {
  // The DB row also has the singleton `id`, but the OpenAPI contract only
  // exposes retentionDays + updatedAt. Strip extras so the response matches
  // the generated types exactly.
  return { retentionDays: row.retentionDays, updatedAt: row.updatedAt };
}

router.get("/settings/bulk-jobs", async (_req, res): Promise<void> => {
  const settings = await getBulkJobsSettings();
  res.json(shapeBulkJobsSettings(settings));
});

router.put("/settings/bulk-jobs", async (req, res): Promise<void> => {
  const parsed = UpdateBulkJobsSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await updateBulkJobsSettings({
    retentionDays: parsed.data.retentionDays,
  });
  req.log.info(
    { retentionDays: updated.retentionDays },
    "Bulk-job retention settings updated",
  );
  res.json(shapeBulkJobsSettings(updated));
});

router.get("/settings/email-revalidation", async (_req, res): Promise<void> => {
  const settings = await getEmailRevalidationSettings();
  res.json(settings);
});

router.put("/settings/email-revalidation", async (req, res): Promise<void> => {
  const parsed = UpdateEmailRevalidationSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await updateEmailRevalidationSettings({
    thresholdDays: parsed.data.thresholdDays,
    intervalMs: parsed.data.intervalMs,
    batchSize: parsed.data.batchSize,
    retentionDays: parsed.data.retentionDays,
    enabled: parsed.data.enabled,
    alertThreshold: parsed.data.alertThreshold,
    alertEmail: parsed.data.alertEmail ?? null,
  });
  req.log.info(
    {
      thresholdDays: updated.thresholdDays,
      intervalMs: updated.intervalMs,
      batchSize: updated.batchSize,
      enabled: updated.enabled,
    },
    "Email re-validation settings updated",
  );
  res.json(updated);
});

router.get(
  "/settings/email-revalidation/runs",
  async (_req, res): Promise<void> => {
    const runs = await listRecentEmailRevalidationRuns(10);
    res.json(runs);
  },
);

router.get(
  "/settings/email-revalidation/alert",
  async (_req, res): Promise<void> => {
    const status = await getEmailRevalidationAlertStatus();
    res.json(status);
  },
);

router.post(
  "/settings/email-revalidation/sweep",
  async (req, res): Promise<void> => {
    const run = await sweepStaleEmailValidations("manual");
    req.log.info(
      { runId: run.id, rechecked: run.rechecked, errors: run.errors },
      "Manual email re-validation sweep finished",
    );
    res.json(run);
  },
);

router.get("/settings/notifications", async (_req, res): Promise<void> => {
  const settings = await getNotificationSettings();
  res.json(settings);
});

router.put("/settings/notifications", async (req, res): Promise<void> => {
  const parsed = UpdateNotificationSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await updateNotificationSettings(parsed.data);
  req.log.info(
    {
      emailEnabled: updated.emailEnabled,
      emailRecipientCount: updated.emailRecipients.length,
      slackEnabled: updated.slackEnabled,
    },
    "Notification settings updated",
  );
  res.json(updated);
});

router.post(
  "/settings/notifications/test",
  async (req, res): Promise<void> => {
    const results = await sendTestNotification();
    req.log.info(
      {
        results: results.map((r) => ({
          channel: r.channel,
          attempted: r.attempted,
          ok: r.ok,
        })),
      },
      "Test notification dispatched",
    );
    res.json({ results });
  },
);

router.post(
  "/settings/notifications/digest/run",
  async (req, res): Promise<void> => {
    const result = await runDigestSweep();
    req.log.info(
      {
        attempted: result.attempted,
        recipientCount: result.recipientCount,
        regressionCount: result.regressionCount,
        reason: result.reason,
      },
      "Manual digest sweep finished",
    );
    res.json(result);
  },
);

router.get(
  "/settings/notifications/digest/preview",
  async (_req, res): Promise<void> => {
    const preview = await previewDigest();
    res.json(preview);
  },
);

export default router;
