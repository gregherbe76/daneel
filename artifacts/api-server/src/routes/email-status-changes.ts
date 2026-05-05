import { Router } from "express";
import {
  db,
  emailStatusChangesTable,
  candidatesTable,
} from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  ListEmailStatusChangesQueryParams,
  MarkEmailStatusChangeReadParams,
} from "@workspace/api-zod";

const router = Router();

const SELECT_COLUMNS = {
  id: emailStatusChangesTable.id,
  candidateId: emailStatusChangesTable.candidateId,
  candidateName: candidatesTable.name,
  candidateEmail: candidatesTable.email,
  previousStatus: emailStatusChangesTable.previousStatus,
  newStatus: emailStatusChangesTable.newStatus,
  previousReason: emailStatusChangesTable.previousReason,
  newReason: emailStatusChangesTable.newReason,
  changedAt: emailStatusChangesTable.changedAt,
  notifiedAt: emailStatusChangesTable.notifiedAt,
  notificationSentAt: emailStatusChangesTable.notificationSentAt,
};

router.get("/email-status-changes", async (req, res) => {
  const { unread, candidateId, limit } = ListEmailStatusChangesQueryParams.parse(
    req.query,
  );

  const filters = [
    unread ? isNull(emailStatusChangesTable.notifiedAt) : undefined,
    candidateId
      ? eq(emailStatusChangesTable.candidateId, candidateId)
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const where =
    filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters);

  const rows = await db
    .select(SELECT_COLUMNS)
    .from(emailStatusChangesTable)
    .innerJoin(
      candidatesTable,
      eq(candidatesTable.id, emailStatusChangesTable.candidateId),
    )
    .where(where)
    .orderBy(desc(emailStatusChangesTable.changedAt))
    .limit(limit ?? 50);

  res.json(rows);
});

router.post("/email-status-changes/mark-all-read", async (_req, res) => {
  const updated = await db
    .update(emailStatusChangesTable)
    .set({ notifiedAt: new Date() })
    .where(isNull(emailStatusChangesTable.notifiedAt))
    .returning({ id: emailStatusChangesTable.id });

  res.json({ updated: updated.length });
});

router.post("/email-status-changes/:id/mark-read", async (req, res) => {
  const { id } = MarkEmailStatusChangeReadParams.parse({
    id: Number(req.params.id),
  });

  const [row] = await db
    .update(emailStatusChangesTable)
    .set({ notifiedAt: new Date() })
    .where(eq(emailStatusChangesTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Email status change not found" });
    return;
  }

  // Re-join with candidate so the response shape matches the list endpoint.
  const [enriched] = await db
    .select(SELECT_COLUMNS)
    .from(emailStatusChangesTable)
    .innerJoin(
      candidatesTable,
      eq(candidatesTable.id, emailStatusChangesTable.candidateId),
    )
    .where(eq(emailStatusChangesTable.id, id));

  res.json(enriched);
});

export default router;
