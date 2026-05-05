import { Router, type IRouter } from "express";
import {
  fetchTelemetryDashboard,
  type TelemetryRange,
} from "../lib/telemetry-dashboard";

const router: IRouter = Router();

router.get("/telemetry/dashboard", async (req, res): Promise<void> => {
  const rawRange = typeof req.query["range"] === "string" ? req.query["range"] : "7d";
  const range: TelemetryRange = rawRange === "30d" ? "30d" : "7d";
  const provider =
    typeof req.query["provider"] === "string" ? req.query["provider"] : undefined;
  const workflowStep =
    typeof req.query["workflowStep"] === "string"
      ? req.query["workflowStep"]
      : undefined;
  try {
    const data = await fetchTelemetryDashboard(range, { provider, workflowStep });
    res.json(data);
  } catch (err) {
    req.log.warn({ err }, "Failed to load telemetry dashboard");
    res.status(502).json({
      error: err instanceof Error ? err.message : "PostHog query failed",
    });
  }
});

export default router;
