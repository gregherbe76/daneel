import { Router, type IRouter } from "express";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import candidatesRouter from "./candidates";
import importRouter from "./import";
import applicationsRouter from "./applications";
import workflowsRouter from "./workflows";
import providersRouter from "./providers";
import reportsRouter from "./reports";
import candidateNotesRouter from "./candidate-notes";
import settingsRouter from "./settings";
import emailStatusChangesRouter from "./email-status-changes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(jobsRouter);
router.use(candidatesRouter);
router.use(importRouter);
router.use(applicationsRouter);
router.use(workflowsRouter);
router.use(providersRouter);
router.use(reportsRouter);
router.use(candidateNotesRouter);
router.use(settingsRouter);
router.use(emailStatusChangesRouter);

export default router;
