import { Router, type IRouter } from "express";
import {
  UpdateEmailRevalidationSettingsBody,
  UpdateNotificationSettingsBody,
} from "@workspace/api-zod";
import {
  getEmailRevalidationSettings,
  updateEmailRevalidationSettings,
  listRecentEmailRevalidationRuns,
  sweepStaleEmailValidations,
} from "../lib/email-revalidation";
import {
  getNotificationSettings,
  updateNotificationSettings,
} from "../lib/notifications";

const router: IRouter = Router();

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
  const updated = await updateEmailRevalidationSettings(parsed.data);
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

export default router;
