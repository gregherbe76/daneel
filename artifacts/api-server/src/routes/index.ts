import { Router, type IRouter } from "express";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import candidatesRouter from "./candidates";
import applicationsRouter from "./applications";
import workflowsRouter from "./workflows";
import providersRouter from "./providers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(jobsRouter);
router.use(candidatesRouter);
router.use(applicationsRouter);
router.use(workflowsRouter);
router.use(providersRouter);

export default router;
