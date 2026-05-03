import { Router, type IRouter } from "express";
import { UpdateEmailRevalidationSettingsBody } from "@workspace/api-zod";
import {
  getEmailRevalidationSettings,
  updateEmailRevalidationSettings,
} from "../lib/email-revalidation";

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

export default router;
