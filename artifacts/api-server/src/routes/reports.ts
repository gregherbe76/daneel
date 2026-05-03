import { Router } from "express";
import {
  db,
  agentRunsTable,
  jobsTable,
  jobInsightsTable,
  shortlistsTable,
  aiEvaluationsTable,
  candidatesTable,
  applicationsTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { logger } from "../lib/logger";
import { branding } from "@workspace/branding";

const router = Router();

// ── Data Fetching ─────────────────────────────────────────────────────────────

async function buildReport(jobId: number, runId?: number) {
  let run;
  if (runId !== undefined) {
    const [found] = await db
      .select()
      .from(agentRunsTable)
      .where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.jobId, jobId)));
    run = found;
  } else {
    const [found] = await db
      .select()
      .from(agentRunsTable)
      .where(and(eq(agentRunsTable.jobId, jobId), eq(agentRunsTable.status, "completed")))
      .orderBy(desc(agentRunsTable.createdAt))
      .limit(1);
    run = found;
  }

  if (!run) return null;

  const [job, insights, shortlists, evaluations, candidates] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1),
    db.select().from(jobInsightsTable).where(eq(jobInsightsTable.runId, run.id)).limit(1),
    db.select().from(shortlistsTable).where(eq(shortlistsTable.runId, run.id)).limit(1),
    db.select().from(aiEvaluationsTable).where(eq(aiEvaluationsTable.runId, run.id)),
    db.select().from(candidatesTable),
  ]);

  if (!job[0]) return null;

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const insight = insights[0] ?? null;
  const shortlist = shortlists[0] ?? null;

  // Sort evaluations by score descending
  const sortedEvals = [...evaluations].sort((a, b) => b.score - a.score);
  const top5Ids = (shortlist?.rankedCandidateIds as number[] ?? sortedEvals.slice(0, 5).map((e) => e.candidateId));

  const top5Evals = top5Ids
    .map((id) => sortedEvals.find((e) => e.candidateId === id))
    .filter(Boolean);

  const evaluationsWithCandidates = sortedEvals.map((e) => ({
    ...e,
    candidate: candidateMap.get(e.candidateId) ?? null,
  }));

  const top5WithCandidates = top5Evals.map((e) => {
    const summary = (shortlist?.summaries as Array<{ candidateId: number; whyRelevant: string; keyRisks: string; finalRecommendation: string }> ?? [])
      .find((s) => s.candidateId === e!.candidateId) ?? null;
    const candidateName = candidateMap.get(e!.candidateId)?.name ?? "This candidate";
    const generatedNarrative = summary
      ? `We believe ${candidateName} is a strong fit for your client's mission. ${summary.whyRelevant} Based on our assessment, ${summary.finalRecommendation.charAt(0).toLowerCase()}${summary.finalRecommendation.slice(1)}`
      : null;
    const override = e!.clientFitNarrativeOverride ?? null;
    return {
      ...e!,
      candidate: candidateMap.get(e!.candidateId) ?? null,
      summary,
      clientFitNarrative: override ?? generatedNarrative,
      clientFitNarrativeGenerated: generatedNarrative,
      clientFitNarrativeOverride: override,
    };
  });

  // Derive interview focus areas from top-candidate gaps + evaluation criteria
  const gapFrequency = new Map<string, number>();
  top5Evals.forEach((e) => {
    ((e!.gaps ?? []) as string[]).forEach((g) => {
      gapFrequency.set(g, (gapFrequency.get(g) ?? 0) + 1);
    });
  });
  const topGaps = [...gapFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([gap]) => gap);

  const interviewFocusAreas = [
    ...topGaps.map((gap) => `Probe depth on: ${gap}`),
    ...((insight?.evaluationCriteria ?? []) as string[]).slice(0, 3).map((c) => `Evaluate: ${c}`),
  ].slice(0, 6);

  // Aggregate risks from top 5
  const allRisks: string[] = [];
  top5Evals.forEach((e) => {
    ((e!.risks ?? []) as string[]).forEach((r) => allRisks.push(r));
  });
  const uniqueRisks = [...new Set(allRisks)].slice(0, 6);

  // Recommendation summary
  const recCounts = { "Strong Yes": 0, Yes: 0, Maybe: 0, No: 0 };
  sortedEvals.forEach((e) => {
    const key = e.recommendation as keyof typeof recCounts;
    if (key in recCounts) recCounts[key]++;
  });

  return {
    generatedAt: new Date().toISOString(),
    run: {
      id: run.id,
      runDate: run.createdAt,
      status: run.status,
      dataMode: run.dataMode,
      runSourcing: run.runSourcing,
      variantOf: run.variantOf ?? null,
      variantLabel: run.variantLabel ?? null,
      variantCriteria: run.variantCriteria ?? null,
    },
    job: job[0],
    insight,
    top5: top5WithCandidates,
    evaluations: evaluationsWithCandidates,
    recommendationSummary: recCounts,
    interviewFocusAreas,
    risks: uniqueRisks,
  };
}

// ── Action label helper ───────────────────────────────────────────────────────

function computeActionLabel(e: {
  score: number;
  fitScore: number | null;
  decisionScore: number | null;
  confidenceLevel: string | null;
  requiresEnrichment: boolean;
}): string {
  const decisionScore = e.decisionScore ?? e.score;
  const fitScore = e.fitScore ?? decisionScore;
  const conf = e.confidenceLevel;
  if (e.requiresEnrichment || (fitScore >= 60 && conf === "Low")) return "Enrich before deciding";
  if (decisionScore >= 70 && conf === "High") return "Interview now";
  if (decisionScore < 50) return "Reject / low priority";
  return "Review manually";
}

// ── JSON Report ───────────────────────────────────────────────────────────────

router.get("/reports/job/:jobId/run/:runId", async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const runId = parseInt(req.params.runId, 10);
  const report = await buildReport(jobId, runId);
  if (!report) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(report);
});

// ── Update narrative override ─────────────────────────────────────────────────
router.put("/reports/job/:jobId/run/:runId/candidate/:candidateId/narrative", async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const runId = parseInt(req.params.runId, 10);
  const candidateId = parseInt(req.params.candidateId, 10);
  const body = req.body as { narrative?: string | null };
  const narrative = body?.narrative;
  const value =
    narrative === null || narrative === undefined || (typeof narrative === "string" && narrative.trim() === "")
      ? null
      : String(narrative);

  const updated = await db
    .update(aiEvaluationsTable)
    .set({ clientFitNarrativeOverride: value })
    .where(
      and(
        eq(aiEvaluationsTable.jobId, jobId),
        eq(aiEvaluationsTable.runId, runId),
        eq(aiEvaluationsTable.candidateId, candidateId),
      ),
    )
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "Evaluation not found" });
    return;
  }
  res.json({ ok: true, clientFitNarrativeOverride: value });
});

router.get("/reports/job/:jobId/latest", async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const report = await buildReport(jobId);
  if (!report) {
    res.status(404).json({ error: "No completed workflow run found for this job" });
    return;
  }
  res.json(report);
});

// ── Markdown Export ───────────────────────────────────────────────────────────

router.get("/reports/job/:jobId/latest/markdown", async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const report = await buildReport(jobId);
  if (!report) {
    res.status(404).json({ error: "No completed workflow run found for this job" });
    return;
  }

  const { job, run, insight, top5, evaluations, recommendationSummary, interviewFocusAreas, risks, generatedAt } = report;

  const recLine = Object.entries(recommendationSummary)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");

  const clientDisplayName = job.clientName ?? branding.companyName;
  const md: string[] = [];

  md.push(`# ${branding.productName} Report — ${job.title}`);
  md.push(`**Prepared for:** ${clientDisplayName}  `);
  md.push(`**Location:** ${job.location} | **Seniority:** ${job.seniority}  `);
  md.push(`**Report Date:** ${new Date(generatedAt).toLocaleDateString("en-US", { dateStyle: "long" })}  `);
  md.push(`**Workflow Run:** ${new Date(run.runDate).toLocaleDateString("en-US", { dateStyle: "long" })}${run.runSourcing ? " _(Sourcing enabled)_" : ""}`);
  md.push("");
  md.push("---");
  md.push("");

  // ── Decision Summary
  const actionGroupsNamed: Record<string, string[]> = {
    "Interview now": [],
    "Review manually": [],
    "Enrich before deciding": [],
    "Reject / low priority": [],
  };
  evaluations.forEach((e) => {
    const label = computeActionLabel(e as Parameters<typeof computeActionLabel>[0]);
    actionGroupsNamed[label].push(e.candidate?.name ?? "Unknown");
  });

  md.push("## Decision Summary");
  md.push("");
  md.push(`_${evaluations.length} candidates evaluated · ${actionGroupsNamed["Interview now"].length} ready to advance_`);
  md.push("");
  md.push("| Action | Count | Candidates |");
  md.push("|--------|-------|------------|");
  md.push(`| ✅ Interview now | ${actionGroupsNamed["Interview now"].length} | ${actionGroupsNamed["Interview now"].join(", ") || "—"} |`);
  md.push(`| 👁 Review manually | ${actionGroupsNamed["Review manually"].length} | ${actionGroupsNamed["Review manually"].join(", ") || "—"} |`);
  md.push(`| 🔍 Enrich before deciding | ${actionGroupsNamed["Enrich before deciding"].length} | ${actionGroupsNamed["Enrich before deciding"].join(", ") || "—"} |`);
  md.push(`| ⬇ Reject / low priority | ${actionGroupsNamed["Reject / low priority"].length} | ${actionGroupsNamed["Reject / low priority"].join(", ") || "—"} |`);
  md.push("");
  md.push("### Recommended Next Actions");
  md.push("");
  if (actionGroupsNamed["Interview now"].length > 0) {
    md.push(`- **→ Schedule interviews:** ${actionGroupsNamed["Interview now"].join(", ")}`);
  }
  if (actionGroupsNamed["Review manually"].length > 0) {
    md.push(`- **→ Review before advancing:** ${actionGroupsNamed["Review manually"].join(", ")} — verify experience depth and cultural fit`);
  }
  if (actionGroupsNamed["Enrich before deciding"].length > 0) {
    md.push(`- **→ Enrich profiles first:** ${actionGroupsNamed["Enrich before deciding"].join(", ")} — insufficient data for a reliable decision`);
  }
  if (actionGroupsNamed["Reject / low priority"].length > 0) {
    md.push(`- **→ Deprioritize:** ${actionGroupsNamed["Reject / low priority"].join(", ")}`);
  }
  md.push("");
  md.push("---");
  md.push("");

  if (insight) {
    md.push("## Client Mission Understanding");
    md.push("");
    md.push(`**Ideal Candidate Profile:** ${insight.idealCandidateProfile}`);
    md.push("");
    md.push("**Must-Have Skills:**");
    ((insight.mustHaveSkills ?? []) as string[]).forEach((s) => md.push(`- ${s}`));
    md.push("");
    md.push("**Evaluation Criteria:**");
    ((insight.evaluationCriteria ?? []) as string[]).forEach((c) => md.push(`- ${c}`));
    md.push("");
    md.push("---");
    md.push("");
  }

  md.push("## Recommendation Summary");
  md.push("");
  md.push(`| Rating | Count |`);
  md.push(`|--------|-------|`);
  Object.entries(recommendationSummary).forEach(([k, v]) => {
    md.push(`| ${k} | ${v} |`);
  });
  md.push("");
  md.push(`_Total evaluated: ${evaluations.length}_`);
  md.push("");
  md.push("---");
  md.push("");

  md.push("## Top 5 Shortlisted Candidates");
  md.push("");
  top5.forEach((e, i) => {
    const cand = e.candidate;
    md.push(`### ${i + 1}. ${cand?.name ?? "Unknown"}`);
    if (cand?.headline) md.push(`_${cand.headline}_`);
    md.push("");
    md.push(`**Score:** ${e.score}/100 | **Recommendation:** ${e.recommendation}`);
    if (e.summary?.whyRelevant) {
      md.push("");
      md.push(`**Why Relevant:** ${e.summary.whyRelevant}`);
    }
    md.push("");
    md.push("**Strengths:**");
    ((e.strengths ?? []) as string[]).forEach((s) => md.push(`- ${s}`));
    md.push("");
    md.push("**Gaps:**");
    ((e.gaps ?? []) as string[]).forEach((g) => md.push(`- ${g}`));
    if (((e.risks ?? []) as string[]).length > 0) {
      md.push("");
      md.push("**Risks:**");
      ((e.risks ?? []) as string[]).forEach((r) => md.push(`- ${r}`));
    }
    if (e.summary?.keyRisks) {
      md.push("");
      md.push(`**Key Risks:** ${e.summary.keyRisks}`);
    }
    if (e.clientFitNarrative) {
      md.push("");
      md.push("**Why this candidate fits your client:**");
      md.push(`> ${e.clientFitNarrative}`);
    }
    md.push("");
  });

  md.push("---");
  md.push("");

  if (risks.length > 0) {
    md.push("## Risk Summary");
    md.push("");
    risks.forEach((r) => md.push(`- ${r}`));
    md.push("");
    md.push("---");
    md.push("");
  }

  if (interviewFocusAreas.length > 0) {
    md.push("## Suggested Interview Focus Areas");
    md.push("");
    interviewFocusAreas.forEach((a) => md.push(`- ${a}`));
    md.push("");
    md.push("---");
    md.push("");
  }

  md.push("## Full Evaluation Table");
  md.push("");
  md.push("| Candidate | Score | Recommendation | Top Strength | Top Gap |");
  md.push("|-----------|-------|---------------|--------------|---------|");
  evaluations.forEach((e) => {
    const name = e.candidate?.name ?? "Unknown";
    const strength = (e.strengths as string[])[0] ?? "-";
    const gap = (e.gaps as string[])[0] ?? "-";
    md.push(`| ${name} | ${e.score}/100 | ${e.recommendation} | ${strength} | ${gap} |`);
  });
  md.push("");
  md.push("---");
  md.push("");
  md.push(`_Report generated by HireFlow on ${new Date(generatedAt).toLocaleString()}_`);

  const filename = `hiring-report-${job.title.replace(/\s+/g, "-").toLowerCase()}.md`;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(md.join("\n"));
});

// ── PDF Export ────────────────────────────────────────────────────────────────

router.get("/reports/job/:jobId/latest/pdf", async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const report = await buildReport(jobId);
  if (!report) {
    res.status(404).json({ error: "No completed workflow run found for this job" });
    return;
  }

  const { job, run, insight, top5, evaluations, recommendationSummary, interviewFocusAreas, risks, generatedAt } = report;

  const filename = `hiring-report-${job.title.replace(/\s+/g, "-").toLowerCase()}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  // ── Fetch logo image (client logo URL takes priority over global branding logo)
  const logoUrl = job.clientLogoUrl ?? (branding.logoUrl || null);
  let logoBuffer: Buffer | null = null;
  if (logoUrl) {
    try {
      const imgRes = await fetch(logoUrl, { signal: AbortSignal.timeout(4000) });
      if (imgRes.ok) {
        logoBuffer = Buffer.from(await imgRes.arrayBuffer());
      }
    } catch {
      // Logo fetch failed — continue without image
    }
  }

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(res);

  // ── Color palette (from branding config)
  const PRIMARY: string = branding.colors.primary;
  const MUTED: string = branding.colors.muted;
  const ACCENT: string = branding.colors.accent;
  const DIVIDER: string = branding.colors.divider;
  const GREEN = "#16a34a";
  const AMBER = "#d97706";
  const RED = "#dc2626";
  const clientDisplayName = job.clientName ?? branding.companyName;
  const reportTitle = `${branding.productName} Report`;

  const scoreColor = (score: number) => score >= 80 ? GREEN : score >= 60 ? ACCENT : score >= 40 ? AMBER : RED;
  const recColor = (rec: string) =>
    rec === "Strong Yes" ? GREEN : rec === "Yes" ? GREEN : rec === "Maybe" ? AMBER : RED;

  const W = doc.page.width - 100; // usable width

  // ── COVER / HEADER
  doc.rect(0, 0, doc.page.width, 140).fill("#1e293b");
  doc.fill("#ffffff").fontSize(22).font("Helvetica-Bold").text(job.title, 50, 40, { width: W });
  doc.fill("#94a3b8").fontSize(11).font("Helvetica").text(
    `${job.location}  ·  ${job.seniority}  ·  HireFlow Hiring Report`,
    50,
    106,
    { width: W }
  );
  doc.fill("#64748b").fontSize(9).font("Helvetica").text(
    `Prepared for: ${clientDisplayName}`,
    50,
    86,
    { width: W }
  );
  doc.fill("#64748b").fontSize(9).text(
    `Workflow: ${new Date(run.runDate).toLocaleDateString("en-US", { dateStyle: "long" })}${run.runSourcing ? "  (Sourcing enabled)" : ""}   |   Generated: ${new Date(generatedAt).toLocaleDateString("en-US", { dateStyle: "long" })}`,
    50,
    122,
    { width: W }
  );

  doc.moveDown(4);

  // ── helper: section heading
  function sectionHeading(title: string) {
    doc.moveDown(0.6);
    doc.rect(50, doc.y, W, 1).fill(DIVIDER);
    doc.moveDown(0.3);
    doc.fill(PRIMARY).fontSize(13).font("Helvetica-Bold").text(title.toUpperCase(), { characterSpacing: 1 });
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(10);
  }

  function bodyText(text: string, color = PRIMARY) {
    doc.fill(color).fontSize(10).font("Helvetica").text(text, { width: W });
  }

  function bulletList(items: string[], color = PRIMARY) {
    items.forEach((item) => {
      doc.fill(color).fontSize(10).font("Helvetica").text(`• ${item}`, { indent: 12, width: W - 12 });
    });
  }

  // ── DECISION SUMMARY
  sectionHeading("Decision Summary");
  const pdfActionGroups: Record<string, Array<{ name: string; score: number }>> = {
    "Interview now": [],
    "Review manually": [],
    "Enrich before deciding": [],
    "Reject / low priority": [],
  };
  evaluations.forEach((e) => {
    const label = computeActionLabel(e as Parameters<typeof computeActionLabel>[0]);
    pdfActionGroups[label].push({ name: e.candidate?.name ?? "Unknown", score: e.decisionScore ?? e.score });
  });

  const pdfBuckets = [
    { key: "Interview now",          color: GREEN,   label: "Interview Now",   sub: "High confidence match" },
    { key: "Review manually",        color: "#3b82f6", label: "Review Manually", sub: "Needs closer look" },
    { key: "Enrich before deciding", color: AMBER,   label: "Enrich First",    sub: "Data too sparse" },
    { key: "Reject / low priority",  color: MUTED,   label: "Low Priority",    sub: "Below threshold" },
  ];
  const dsBucketW = W / pdfBuckets.length;
  const dsBucketStartX = 50;
  const dsBucketStartY = doc.y;
  pdfBuckets.forEach(({ key, color, label, sub }, i) => {
    const x = dsBucketStartX + i * dsBucketW;
    doc.rect(x, dsBucketStartY, dsBucketW - 6, 54).fill("#f8fafc").stroke(DIVIDER);
    doc.fill(color).fontSize(20).font("Helvetica-Bold").text(String(pdfActionGroups[key].length), x + 6, dsBucketStartY + 4, { width: dsBucketW - 12, align: "center" });
    doc.fill(PRIMARY).fontSize(8).font("Helvetica-Bold").text(label, x + 6, dsBucketStartY + 30, { width: dsBucketW - 12, align: "center" });
    doc.fill(MUTED).fontSize(7).font("Helvetica").text(sub, x + 6, dsBucketStartY + 42, { width: dsBucketW - 12, align: "center" });
  });
  doc.y = dsBucketStartY + 66;

  // Recommended Next Actions
  doc.fill(MUTED).fontSize(9).font("Helvetica-Bold").text("RECOMMENDED NEXT ACTIONS");
  doc.moveDown(0.2);
  const nextActions: Array<{ arrow: string; color: string; text: string }> = [];
  if (pdfActionGroups["Interview now"].length > 0)
    nextActions.push({ arrow: "→", color: GREEN, text: `Schedule interviews: ${pdfActionGroups["Interview now"].map((c) => c.name).join(", ")}` });
  if (pdfActionGroups["Review manually"].length > 0)
    nextActions.push({ arrow: "→", color: "#3b82f6", text: `Review before advancing: ${pdfActionGroups["Review manually"].map((c) => c.name).join(", ")} — verify experience depth` });
  if (pdfActionGroups["Enrich before deciding"].length > 0)
    nextActions.push({ arrow: "→", color: AMBER, text: `Enrich profiles first: ${pdfActionGroups["Enrich before deciding"].map((c) => c.name).join(", ")} — too sparse to decide` });
  if (pdfActionGroups["Reject / low priority"].length > 0)
    nextActions.push({ arrow: "→", color: MUTED, text: `Deprioritize: ${pdfActionGroups["Reject / low priority"].map((c) => c.name).join(", ")}` });
  nextActions.forEach(({ arrow, color, text }) => {
    doc.fill(color).fontSize(10).font("Helvetica-Bold").text(arrow, 50, doc.y, { continued: true, width: 14 });
    doc.fill(PRIMARY).font("Helvetica").text(` ${text}`, { width: W - 14 });
  });
  doc.moveDown(0.4);

  // ── RECOMMENDATION SUMMARY
  sectionHeading("Recommendation Summary");
  const recEntries = Object.entries(recommendationSummary);
  const colW = W / recEntries.length;
  const startX = 50;
  const startY = doc.y;
  recEntries.forEach(([label, count], i) => {
    const x = startX + i * colW;
    doc.rect(x, startY, colW - 8, 50).fill("#f8fafc").stroke(DIVIDER);
    doc.fill(recColor(label)).fontSize(20).font("Helvetica-Bold").text(String(count), x + 10, startY + 6, { width: colW - 20, align: "center" });
    doc.fill(MUTED).fontSize(8).font("Helvetica").text(label, x + 10, startY + 32, { width: colW - 20, align: "center" });
  });
  doc.y = startY + 62;
  bodyText(`Total candidates evaluated: ${evaluations.length}`, MUTED);
  doc.moveDown(0.4);

  // ── CLIENT MISSION UNDERSTANDING
  if (insight) {
    sectionHeading("Client Mission Understanding");
    bodyText(insight.idealCandidateProfile as string);
    doc.moveDown(0.4);
    if (((insight.mustHaveSkills ?? []) as string[]).length > 0) {
      doc.fill(MUTED).fontSize(9).text("MUST-HAVE SKILLS");
      bulletList(insight.mustHaveSkills as string[]);
    }
    if (((insight.evaluationCriteria ?? []) as string[]).length > 0) {
      doc.moveDown(0.3);
      doc.fill(MUTED).fontSize(9).text("EVALUATION CRITERIA");
      bulletList(insight.evaluationCriteria as string[]);
    }
  }

  // ── TOP 5 CANDIDATES
  sectionHeading("Top 5 Shortlisted Candidates");
  top5.forEach((e, i) => {
    const cand = e.candidate;
    if (doc.y > doc.page.height - 160) doc.addPage();
    const boxY = doc.y;
    doc.rect(50, boxY, W, 8).fill(scoreColor(e.score));
    doc.y = boxY + 12;
    doc.fill(PRIMARY).fontSize(11).font("Helvetica-Bold")
      .text(`${i + 1}. ${cand?.name ?? "Unknown"}`, 50, doc.y, { continued: true });
    doc.fill(scoreColor(e.score)).font("Helvetica-Bold").fontSize(11)
      .text(`  ${e.score}/100`, { continued: true });
    doc.fill(MUTED).font("Helvetica").fontSize(10)
      .text(`  ${e.recommendation}`);
    if (cand?.headline) {
      doc.fill(MUTED).fontSize(9).font("Helvetica").text(cand.headline, { indent: 14 });
    }
    if (e.summary?.whyRelevant) {
      doc.fill(PRIMARY).fontSize(9).font("Helvetica").text(e.summary.whyRelevant, { indent: 14, width: W - 14 });
    }
    doc.moveDown(0.2);
    const strengths = (e.strengths as string[]).slice(0, 2);
    const gaps = (e.gaps as string[]).slice(0, 2);
    if (strengths.length > 0) {
      doc.fill(GREEN).fontSize(8).text("Strengths: " + strengths.join("  ·  "), { indent: 14, width: W - 14 });
    }
    if (gaps.length > 0) {
      doc.fill(RED).fontSize(8).text("Gaps: " + gaps.join("  ·  "), { indent: 14, width: W - 14 });
    }
    if (e.clientFitNarrative) {
      doc.moveDown(0.2);
      doc.fill(MUTED).fontSize(8).font("Helvetica-Bold").text("WHY THIS CANDIDATE FITS YOUR CLIENT", { indent: 14, width: W - 14 });
      doc.fill("#1e40af").fontSize(8).font("Helvetica").text(e.clientFitNarrative, { indent: 14, width: W - 14 });
    }
    doc.moveDown(0.6);
  });

  // ── RISKS
  if (risks.length > 0) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    sectionHeading("Risk Summary");
    bulletList(risks, RED);
  }

  // ── INTERVIEW FOCUS AREAS
  if (interviewFocusAreas.length > 0) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    sectionHeading("Suggested Interview Focus Areas");
    bulletList(interviewFocusAreas, PRIMARY);
  }

  // ── FULL EVALUATION TABLE
  if (doc.y > doc.page.height - 160) doc.addPage();
  sectionHeading("Full Evaluation Table");

  const colWidths = [160, 55, 100, 140, 140];
  const headers = ["Candidate", "Score", "Recommendation", "Top Strength", "Top Gap"];
  const tableX = 50;
  let tableY = doc.y;

  // Table header row
  doc.rect(tableX, tableY, W, 18).fill("#f1f5f9");
  let cx = tableX + 4;
  headers.forEach((h, i) => {
    doc.fill(MUTED).fontSize(8).font("Helvetica-Bold").text(h, cx, tableY + 5, { width: colWidths[i] - 6 });
    cx += colWidths[i];
  });
  tableY += 18;

  evaluations.forEach((e, rowIdx) => {
    if (tableY > doc.page.height - 60) {
      doc.addPage();
      tableY = 50;
    }
    const name = e.candidate?.name ?? "Unknown";
    const strength = (e.strengths as string[])[0] ?? "-";
    const gap = (e.gaps as string[])[0] ?? "-";
    const rowH = 18;
    if (rowIdx % 2 === 0) {
      doc.rect(tableX, tableY, W, rowH).fill("#fafafa");
    }
    const cells = [name, `${e.score}/100`, e.recommendation, strength, gap];
    cx = tableX + 4;
    cells.forEach((cell, i) => {
      const color = i === 1 ? scoreColor(e.score) : i === 2 ? recColor(e.recommendation) : PRIMARY;
      doc.fill(color).fontSize(8).font(i < 2 ? "Helvetica-Bold" : "Helvetica")
        .text(cell, cx, tableY + 5, { width: colWidths[i] - 6, lineBreak: false, ellipsis: true });
      cx += colWidths[i];
    });
    tableY += rowH;
  });

  doc.y = tableY + 10;

  // ── Footer
  doc.rect(0, doc.page.height - 35, doc.page.width, 35).fill("#f8fafc");
  doc.fill(MUTED).fontSize(8).font("Helvetica")
    .text(
      `HireFlow  |  Confidential — Hiring Manager Report  |  ${new Date(generatedAt).toLocaleString()}`,
      50,
      doc.page.height - 22,
      { width: W, align: "center" }
    );

  doc.end();
  logger.info({ jobId }, "PDF report generated");
});

// ── Decision Execution Actions ────────────────────────────────────────────────

router.post("/reports/job/:jobId/candidate/:candidateId/action", async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const candidateId = parseInt(req.params.candidateId, 10);
  const action = req.body.action as string;

  if (!["interview", "deprioritize", "enrich"].includes(action)) {
    res.status(400).json({ error: "Invalid action" });
    return;
  }

  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candidateId))
    .limit(1);

  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  // ── interview / deprioritize
  if (action === "interview" || action === "deprioritize") {
    const stage = action === "interview" ? "Interview" : "Rejected";
    const [existing] = await db
      .select()
      .from(applicationsTable)
      .where(and(eq(applicationsTable.jobId, jobId), eq(applicationsTable.candidateId, candidateId)))
      .limit(1);

    let application;
    if (existing) {
      const newNotes =
        action === "interview" && !existing.notes?.includes("Recommended by AI")
          ? existing.notes
            ? `${existing.notes}\nRecommended by AI`
            : "Recommended by AI"
          : existing.notes ?? null;
      [application] = await db
        .update(applicationsTable)
        .set({ stage, notes: newNotes, updatedAt: new Date() })
        .where(eq(applicationsTable.id, existing.id))
        .returning();
    } else {
      [application] = await db
        .insert(applicationsTable)
        .values({ jobId, candidateId, stage, notes: action === "interview" ? "Recommended by AI" : null })
        .returning();
    }

    logger.info({ jobId, candidateId, action, stage }, "Report action executed");
    res.json({ ok: true, application, candidateName: candidate.name, stage });
    return;
  }

  // ── enrich
  const { resolveEnrichmentProvider } = await import("./workflows/providers");
  const provider = await resolveEnrichmentProvider();

  if (!provider) {
    res.json({ ok: false, message: "No enrichment provider configured — candidate will be enriched on the next workflow run" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);

  const rawResponse = await provider.run({
    step: "enrichment",
    runId: 0,
    jobId,
    payload: {
      candidates: [{
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        skills: candidate.skills as string[],
        summary: candidate.summary,
        headline: candidate.headline,
        location: candidate.location,
        currentCompany: candidate.currentCompany,
        githubUrl: candidate.githubUrl,
        linkedIn: candidate.linkedIn,
      }],
      jobContext: {
        title: job?.title ?? "",
        seniority: job?.seniority ?? "",
        mustHaveSkills: (job?.mustHaveSkills as string[]) ?? [],
      },
    },
  });

  const results = rawResponse as Array<{
    candidateId: number;
    enrichedHeadline: string | null;
    currentCompany: string | null;
    location: string | null;
    skills: string[];
    experienceSummary: string;
    confidence: number;
    missingFields: string[];
  }>;

  const now = new Date();
  for (const r of results) {
    const confidence = typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0;
    const missingSet = new Set<string>(Array.isArray(r.missingFields) ? r.missingFields : []);
    const status = confidence >= 0.7 && missingSet.size === 0 ? "enriched" : confidence >= 0.4 ? "partial" : "failed";
    await db
      .update(candidatesTable)
      .set({
        ...(r.experienceSummary && !missingSet.has("summary") ? { summary: r.experienceSummary } : {}),
        ...(Array.isArray(r.skills) && r.skills.length > 0 && !missingSet.has("skills") ? { skills: r.skills } : {}),
        ...(r.enrichedHeadline && !missingSet.has("headline") ? { headline: r.enrichedHeadline } : {}),
        ...(r.currentCompany && !missingSet.has("currentCompany") ? { currentCompany: r.currentCompany } : {}),
        ...(r.location && !missingSet.has("location") ? { location: r.location } : {}),
        enrichedAt: now,
        enrichmentSource: provider.name,
        enrichmentConfidence: confidence,
        enrichmentStatus: status,
        updatedAt: now,
      })
      .where(eq(candidatesTable.id, r.candidateId));
  }

  logger.info({ jobId, candidateId, enriched: results.length }, "Candidate enriched via report action");
  res.json({ ok: true, candidateName: candidate.name, enriched: true });
});

export default router;
