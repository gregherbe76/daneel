import { Router } from "express";
import {
  db,
  candidateNotesTable,
  candidateCommentsTable,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import {
  CreateCandidateNoteBody,
  CreateCandidateCommentBody,
  ListCandidateNotesParams,
  ListCandidateNotesQueryParams,
  CreateCandidateNoteParams,
  DeleteCandidateNoteParams,
  ListCandidateCommentsParams,
  ListCandidateCommentsQueryParams,
  CreateCandidateCommentParams,
  DeleteCandidateCommentParams,
} from "@workspace/api-zod";

const router = Router();

// ── NOTES ────────────────────────────────────────────────────────────────────

router.get("/candidates/:candidateId/notes", async (req, res) => {
  const { candidateId } = ListCandidateNotesParams.parse(req.params);
  const { jobId } = ListCandidateNotesQueryParams.parse(req.query);

  const where = jobId
    ? and(eq(candidateNotesTable.candidateId, candidateId), eq(candidateNotesTable.jobId, jobId))
    : eq(candidateNotesTable.candidateId, candidateId);

  const rows = await db
    .select()
    .from(candidateNotesTable)
    .where(where)
    .orderBy(asc(candidateNotesTable.createdAt));
  res.json(rows);
});

router.post("/candidates/:candidateId/notes", async (req, res) => {
  const { candidateId } = CreateCandidateNoteParams.parse(req.params);
  const body = CreateCandidateNoteBody.parse(req.body);
  const [row] = await db
    .insert(candidateNotesTable)
    .values({
      candidateId,
      jobId: body.jobId,
      author: body.author,
      body: body.body,
    })
    .returning();
  res.status(201).json(row);
});

router.delete("/candidates/:candidateId/notes/:noteId", async (req, res) => {
  const { candidateId, noteId } = DeleteCandidateNoteParams.parse(req.params);
  await db
    .delete(candidateNotesTable)
    .where(and(eq(candidateNotesTable.id, noteId), eq(candidateNotesTable.candidateId, candidateId)));
  res.status(204).end();
});

// ── COMMENTS (threaded) ──────────────────────────────────────────────────────

router.get("/candidates/:candidateId/comments", async (req, res) => {
  const { candidateId } = ListCandidateCommentsParams.parse(req.params);
  const { jobId } = ListCandidateCommentsQueryParams.parse(req.query);

  const where = jobId
    ? and(eq(candidateCommentsTable.candidateId, candidateId), eq(candidateCommentsTable.jobId, jobId))
    : eq(candidateCommentsTable.candidateId, candidateId);

  const rows = await db
    .select()
    .from(candidateCommentsTable)
    .where(where)
    .orderBy(asc(candidateCommentsTable.createdAt));
  res.json(rows);
});

router.post("/candidates/:candidateId/comments", async (req, res) => {
  const { candidateId } = CreateCandidateCommentParams.parse(req.params);
  const body = CreateCandidateCommentBody.parse(req.body);
  const [row] = await db
    .insert(candidateCommentsTable)
    .values({
      candidateId,
      jobId: body.jobId,
      parentId: body.parentId ?? null,
      author: body.author,
      body: body.body,
    })
    .returning();
  res.status(201).json(row);
});

router.delete("/candidates/:candidateId/comments/:commentId", async (req, res) => {
  const { candidateId, commentId } = DeleteCandidateCommentParams.parse(req.params);
  await db
    .delete(candidateCommentsTable)
    .where(and(eq(candidateCommentsTable.id, commentId), eq(candidateCommentsTable.candidateId, candidateId)));
  res.status(204).end();
});

export default router;
