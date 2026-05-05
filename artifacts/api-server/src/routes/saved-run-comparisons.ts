import { Router } from "express";
import { db, savedRunComparisonsTable, agentRunsTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  ListSavedRunComparisonsParams,
  CreateSavedRunComparisonParams,
  CreateSavedRunComparisonBody,
  DeleteSavedRunComparisonParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/jobs/:jobId/saved-comparisons", async (req, res) => {
  const { jobId } = ListSavedRunComparisonsParams.parse(req.params);
  const rows = await db
    .select()
    .from(savedRunComparisonsTable)
    .where(eq(savedRunComparisonsTable.jobId, jobId))
    .orderBy(desc(savedRunComparisonsTable.createdAt));
  res.json(rows);
});

router.post("/jobs/:jobId/saved-comparisons", async (req, res) => {
  const { jobId } = CreateSavedRunComparisonParams.parse(req.params);
  const body = CreateSavedRunComparisonBody.parse(req.body);

  const referencedRunIds = [body.runAId, body.runBId, body.runCId].filter(
    (id): id is number => id != null,
  );
  const runs = await db
    .select({ id: agentRunsTable.id, jobId: agentRunsTable.jobId })
    .from(agentRunsTable)
    .where(inArray(agentRunsTable.id, referencedRunIds));
  if (runs.length !== referencedRunIds.length) {
    res.status(400).json({ error: "One or more referenced runs do not exist" });
    return;
  }
  if (runs.some((r) => r.jobId !== jobId)) {
    res.status(400).json({ error: "All runs must belong to this job" });
    return;
  }

  const [row] = await db
    .insert(savedRunComparisonsTable)
    .values({
      jobId,
      name: body.name,
      runAId: body.runAId,
      runBId: body.runBId,
      runCId: body.runCId ?? null,
    })
    .returning();
  res.status(201).json(row);
});

router.delete(
  "/jobs/:jobId/saved-comparisons/:comparisonId",
  async (req, res) => {
    const { jobId, comparisonId } = DeleteSavedRunComparisonParams.parse(
      req.params,
    );
    await db
      .delete(savedRunComparisonsTable)
      .where(
        and(
          eq(savedRunComparisonsTable.id, comparisonId),
          eq(savedRunComparisonsTable.jobId, jobId),
        ),
      );
    res.status(204).end();
  },
);

export default router;
