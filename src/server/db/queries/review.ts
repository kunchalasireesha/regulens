import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { compareFieldPaths } from "@/lib/schemas/field-paths";
import type { Database } from "../client";
import {
  documentPages,
  documents,
  extractedFields,
  extractionRuns,
  fieldEvidence,
  reviewEvents,
  users,
  validationIssues,
} from "../schema";
import { documentSummaryColumns } from "./documents";

// Everything the review screen shows for one document, read in one place so the page
// component does no data shaping. Like every query module, scoped by organization.

export type ReviewDocument = NonNullable<Awaited<ReturnType<typeof getDocumentReview>>>;
export type ReviewField = ReviewDocument["fields"][number];
export type ReviewEvidence = ReviewField["evidence"][number];
export type ReviewIssue = ReviewDocument["issues"][number];
export type ReviewEvent = ReviewDocument["events"][number];

const reviewer = alias(users, "reviewer");

/**
 * The document, its page text, fields (in schema order, each with its evidence),
 * validation issues (most severe first), and the review history (oldest first). Undefined when the id is malformed or the
 * document belongs to another organization, so the two cases are indistinguishable.
 */
export async function getDocumentReview(db: Database, organizationId: string, documentId: string) {
  // A malformed id would make Postgres raise on the uuid cast; treat it as not found.
  if (!z.uuid().safeParse(documentId).success) return undefined;

  const [document] = await db
    .select({ ...documentSummaryColumns, reviewedAt: documents.reviewedAt, reviewedBy: reviewer.name })
    .from(documents)
    .leftJoin(reviewer, eq(reviewer.id, documents.reviewedBy))
    .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)))
    .limit(1);
  if (!document) return undefined;

  const [pages, fieldRows, issues, events] = await Promise.all([
    db
      .select({ pageNumber: documentPages.pageNumber, text: documentPages.text })
      .from(documentPages)
      .where(and(eq(documentPages.organizationId, organizationId), eq(documentPages.documentId, documentId)))
      .orderBy(asc(documentPages.pageNumber)),
    db
      .select({
        id: extractedFields.id,
        extractionRunId: extractedFields.extractionRunId,
        fieldPath: extractedFields.fieldPath,
        extractedValue: extractedFields.extractedValue,
        normalizedValue: extractedFields.normalizedValue,
        currentValue: extractedFields.currentValue,
        extractionStatus: extractedFields.extractionStatus,
        evidenceStatus: extractedFields.evidenceStatus,
        validationStatus: extractedFields.validationStatus,
        reviewStatus: extractedFields.reviewStatus,
      })
      .from(extractedFields)
      .where(and(eq(extractedFields.organizationId, organizationId), eq(extractedFields.documentId, documentId))),
    db
      .select({
        id: validationIssues.id,
        ruleId: validationIssues.ruleId,
        severity: validationIssues.severity,
        fieldPaths: validationIssues.fieldPaths,
        message: validationIssues.message,
        resolution: validationIssues.resolution,
        resolutionNote: validationIssues.resolutionNote,
        resolvedAt: validationIssues.resolvedAt,
      })
      .from(validationIssues)
      .where(and(eq(validationIssues.organizationId, organizationId), eq(validationIssues.documentId, documentId)))
      // Postgres orders enums by declaration: critical, warning, info.
      .orderBy(asc(validationIssues.severity), asc(validationIssues.createdAt), asc(validationIssues.id)),
    db
      .select({
        id: reviewEvents.id,
        eventType: reviewEvents.eventType,
        actorName: users.name,
        fieldPath: reviewEvents.fieldPath,
        issueId: reviewEvents.issueId,
        previousValue: reviewEvents.previousValue,
        newValue: reviewEvents.newValue,
        note: reviewEvents.note,
        createdAt: reviewEvents.createdAt,
      })
      .from(reviewEvents)
      .innerJoin(users, eq(users.id, reviewEvents.actorId))
      .where(and(eq(reviewEvents.organizationId, organizationId), eq(reviewEvents.documentId, documentId)))
      .orderBy(asc(reviewEvents.createdAt), asc(reviewEvents.id)),
  ]);

  const fieldIds = fieldRows.map((field) => field.id);
  const evidenceRows =
    fieldIds.length === 0
      ? []
      : await db
          .select({
            id: fieldEvidence.id,
            fieldId: fieldEvidence.fieldId,
            candidateIndex: fieldEvidence.candidateIndex,
            citedPage: fieldEvidence.citedPage,
            quote: fieldEvidence.quote,
            verification: fieldEvidence.verification,
            matchedPage: fieldEvidence.matchedPage,
            matchStart: fieldEvidence.matchStart,
            matchEnd: fieldEvidence.matchEnd,
          })
          .from(fieldEvidence)
          .where(
            and(eq(fieldEvidence.organizationId, organizationId), inArray(fieldEvidence.fieldId, fieldIds)),
          )
          // Insertion order is lost in a heap table; order by where the quote was cited.
          .orderBy(asc(fieldEvidence.candidateIndex), asc(fieldEvidence.citedPage), asc(fieldEvidence.matchStart));

  // Every field of a document comes from the same run (the pipeline writes them together).
  const runId = fieldRows[0]?.extractionRunId;
  const [run] = runId
    ? await db
        .select({
          id: extractionRuns.id,
          provider: extractionRuns.provider,
          model: extractionRuns.model,
          promptVersion: extractionRuns.promptVersion,
          schemaVersion: extractionRuns.schemaVersion,
          latencyMs: extractionRuns.latencyMs,
          inputTokens: extractionRuns.inputTokens,
          outputTokens: extractionRuns.outputTokens,
          createdAt: extractionRuns.createdAt,
        })
        .from(extractionRuns)
        .where(and(eq(extractionRuns.organizationId, organizationId), eq(extractionRuns.id, runId)))
        .limit(1)
    : [];

  const evidenceByField = new Map<string, typeof evidenceRows>();
  for (const row of evidenceRows) evidenceByField.set(row.fieldId, [...(evidenceByField.get(row.fieldId) ?? []), row]);
  const fields = fieldRows
    .map((field) => ({ ...field, evidence: evidenceByField.get(field.id) ?? [] }))
    .sort((a, b) => compareFieldPaths(a.fieldPath, b.fieldPath));

  return { document, pages, fields, issues, events, extractionRun: run ?? null };
}
