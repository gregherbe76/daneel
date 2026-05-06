import { Router } from "express";
import { db, savedRunComparisonsTable, agentRunsTable } from "@workspace/db";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  ListSavedRunComparisonsParams,
  ListSavedRunComparisonsQueryParams,
  CreateSavedRunComparisonParams,
  CreateSavedRunComparisonBody,
  UpdateSavedRunComparisonParams,
  UpdateSavedRunComparisonBody,
  DeleteSavedRunComparisonParams,
} from "@workspace/api-zod";
import { findTeamMember } from "../lib/team-roster";

const router = Router();

type SavedRow = typeof savedRunComparisonsTable.$inferSelect;

function hydrate(row: SavedRow) {
  const member = row.createdById ? findTeamMember(row.createdById) : undefined;
  return {
    ...row,
    createdByName: member?.name ?? null,
  };
}

router.get("/jobs/:jobId/saved-comparisons", async (req, res) => {
  const { jobId } = ListSavedRunComparisonsParams.parse(req.params);
  const { userId } = ListSavedRunComparisonsQueryParams.parse(req.query);

  // Visibility rule: shared comparisons are visible to everyone, private
  // ones only to their creator. When `userId` is omitted we only return
  // shared rows so anonymous viewers can't see anyone's private chips.
  const visibilityFilter = userId
    ? or(
        eq(savedRunComparisonsTable.visibility, "shared"),
        and(
          eq(savedRunComparisonsTable.visibility, "private"),
          eq(savedRunComparisonsTable.createdById, userId),
        ),
      )
    : eq(savedRunComparisonsTable.visibility, "shared");

  const rows = await db
    .select()
    .from(savedRunComparisonsTable)
    .where(and(eq(savedRunComparisonsTable.jobId, jobId), visibilityFilter))
    .orderBy(desc(savedRunComparisonsTable.createdAt));
  res.json(rows.map(hydrate));
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
      createdById: body.createdById ?? null,
      visibility: body.visibility ?? "private",
    })
    .returning();
  res.status(201).json(hydrate(row));
});

router.patch(
  "/jobs/:jobId/saved-comparisons/:comparisonId",
  async (req, res) => {
    const { jobId, comparisonId } = UpdateSavedRunComparisonParams.parse(
      req.params,
    );
    const body = UpdateSavedRunComparisonBody.parse(req.body);

    const updates: Partial<typeof savedRunComparisonsTable.$inferInsert> = {};
    if (body.visibility !== undefined) updates.visibility = body.visibility;

    if (Object.keys(updates).length === 0) {
      const [existing] = await db
        .select()
        .from(savedRunComparisonsTable)
        .where(
          and(
            eq(savedRunComparisonsTable.id, comparisonId),
            eq(savedRunComparisonsTable.jobId, jobId),
          ),
        );
      if (!existing) {
        res.status(404).json({ error: "Saved comparison not found" });
        return;
      }
      res.json(hydrate(existing));
      return;
    }

    const [row] = await db
      .update(savedRunComparisonsTable)
      .set(updates)
      .where(
        and(
          eq(savedRunComparisonsTable.id, comparisonId),
          eq(savedRunComparisonsTable.jobId, jobId),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Saved comparison not found" });
      return;
    }
    res.json(hydrate(row));
  },
);

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
