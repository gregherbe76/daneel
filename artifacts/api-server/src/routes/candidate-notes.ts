import { Router } from "express";
import {
  db,
  candidateNotesTable,
  candidateCommentsTable,
  candidatesTable,
  jobsTable,
  activeCandidateFilter,
} from "@workspace/db";
import { eq, and, asc, desc, gt } from "drizzle-orm";
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
      mentions: body.mentions ?? [],
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

// ── TEAM ROSTER & MENTION INBOX ──────────────────────────────────────────────

import { TEAM_ROSTER } from "../lib/team-roster";

router.get("/team", (_req, res) => {
  res.json(TEAM_ROSTER);
});

router.get("/team/:memberId/mentions", async (req, res) => {
  const memberId = String(req.params.memberId);
  const sinceParam = req.query.since ? new Date(String(req.query.since)) : null;

  // Always exclude comments whose candidate is soft-deleted — a teammate's
  // mention inbox should not surface conversations attached to trashed
  // candidates that the rest of the UI has already hidden.
  const where = sinceParam
    ? and(gt(candidateCommentsTable.createdAt, sinceParam), activeCandidateFilter)
    : activeCandidateFilter;

  const rows = await db
    .select({
      comment: candidateCommentsTable,
      candidateName: candidatesTable.name,
      jobTitle: jobsTable.title,
    })
    .from(candidateCommentsTable)
    .innerJoin(candidatesTable, eq(candidateCommentsTable.candidateId, candidatesTable.id))
    .innerJoin(jobsTable, eq(candidateCommentsTable.jobId, jobsTable.id))
    .where(where)
    .orderBy(desc(candidateCommentsTable.createdAt))
    .limit(100);

  const matched = rows.filter((r) =>
    Array.isArray(r.comment.mentions) &&
    r.comment.mentions.some((m) => m.id === memberId),
  );

  res.json(matched);
});

export default router;
