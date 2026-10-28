import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DocumentReviewStatus, ReviewEventType } from "@/lib/domain/statuses";
import { canApprove, checkApproval } from "@/lib/review/approval";
import { sameJsonValue } from "@/lib/review/format-value";
import { fieldLabel } from "@/lib/schemas/field-paths";
import type { Actor } from "@/server/auth/current-actor";
import type { Database } from "@/server/db/client";
import { documents, extractedFields, reviewEvents, validationIssues } from "@/server/db/schema";
import { fieldValidationStatus, validateExtraction } from "@/server/validation/validate";
import { prepareCorrection } from "./correction";
import { currentResult } from "./current-result";
import type { ReviewErrorCode } from "./errors";
import { reconcileIssues } from "./reconcile-issues";

// What an analyst can do to a document under review. Every command:
//   - runs in one transaction that first locks the document row, so commands on the same
//     document run one at a time and the approval check sees a consistent state;
//   - refuses, writing nothing, unless the document is ready for review and not yet
//     approved or rejected;
//   - records what it did in review_events, the append-only audit log.
//
// The first command on an unreviewed document moves it to in_review and logs
// review_started. Approved and rejected are final.

export type ReviewResult = { ok: true } | { ok: false; code: ReviewErrorCode };

export type IssueDecision = "confirmed" | "accepted_unresolved";

/** A corrected value, a candidate of an ambiguous field (by index), or null for "not stated". */
export type Correction = { value: unknown } | { candidateIndex: number };

const OPEN_FOR_REVIEW: readonly DocumentReviewStatus[] = ["unreviewed", "in_review"];

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Context = { tx: Tx; actor: Actor; documentId: string };

export function acceptField(db: Database, actor: Actor, input: { documentId: string; fieldPath: string }) {
  return reviewCommand(db, actor, input.documentId, async (ctx) => {
    const field = await lockField(ctx, input.fieldPath);
    // Already accepted or corrected: accepting again changes nothing.
    if (field.reviewStatus !== "pending") return;
    // An ambiguous field has no value until the analyst picks one. A not_found field can
    // be accepted: the analyst confirms the document does not state it.
    if (field.currentValue === null && field.extractionStatus === "ambiguous") throw new Refusal("no_value");

    await ctx.tx
      .update(extractedFields)
      .set({ reviewStatus: "accepted", updatedAt: sql`now()` })
      .where(eq(extractedFields.id, field.id));
    await logEvent(ctx, "field_accepted", { fieldPath: input.fieldPath, newValue: field.currentValue });
  });
}

export function correctField(
  db: Database,
  actor: Actor,
  input: { documentId: string; fieldPath: string; correction: Correction; note?: string },
) {
  return reviewCommand(db, actor, input.documentId, async (ctx) => {
    const { fieldPath, correction } = input;
    const field = await lockField(ctx, fieldPath);

    let raw: unknown;
    if ("candidateIndex" in correction) {
      const candidates = field.extractionStatus === "ambiguous" ? field.extractedValue : null;
      if (!Array.isArray(candidates) || !(correction.candidateIndex in candidates)) {
        throw new Refusal("invalid_candidate");
      }
      raw = candidates[correction.candidateIndex];
    } else {
      raw = correction.value;
    }
    const prepared = prepareCorrection(fieldPath, raw);
    if (!prepared.ok) throw new Refusal("invalid_value");
    // Choosing "not stated" for an undecided ambiguous field is a decision, even though
    // its current value is already null.
    const undecided = field.extractionStatus === "ambiguous" && field.reviewStatus === "pending";
    if (sameJsonValue(prepared.value, field.currentValue) && !undecided) throw new Refusal("unchanged");

    await ctx.tx
      .update(extractedFields)
      .set({ currentValue: prepared.value, reviewStatus: "corrected", updatedAt: sql`now()` })
      .where(eq(extractedFields.id, field.id));
    await logEvent(ctx, "field_corrected", {
      fieldPath,
      previousValue: field.currentValue,
      newValue: prepared.value,
      note: input.note,
    });
    await revalidate(ctx, fieldPath);
  });
}

export function resolveIssue(
  db: Database,
  actor: Actor,
  input: { documentId: string; issueId: string; resolution: IssueDecision; note?: string },
) {
  return reviewCommand(db, actor, input.documentId, async (ctx) => {
    const [issue] = await ctx.tx
      .select({ severity: validationIssues.severity, resolution: validationIssues.resolution })
      .from(validationIssues)
      .where(
        and(
          eq(validationIssues.organizationId, actor.organizationId),
          eq(validationIssues.documentId, input.documentId),
          eq(validationIssues.id, input.issueId),
        ),
      );
    if (!issue) throw new Refusal("issue_not_found");
    if (issue.resolution !== null) throw new Refusal("issue_already_resolved");
    // Approving with a known problem, or overruling a critical rule, needs a reason.
    const note = input.note?.trim() || undefined;
    if (!note && (input.resolution === "accepted_unresolved" || issue.severity === "critical")) {
      throw new Refusal("note_required");
    }

    await ctx.tx
      .update(validationIssues)
      .set({ resolution: input.resolution, resolutionNote: note, resolvedBy: actor.userId, resolvedAt: sql`now()` })
      .where(eq(validationIssues.id, input.issueId));
    await logEvent(ctx, "issue_resolved", { issueId: input.issueId, newValue: { resolution: input.resolution }, note });
  });
}

export function approveDocument(db: Database, actor: Actor, input: { documentId: string; note?: string }) {
  return reviewCommand(db, actor, input.documentId, async (ctx) => {
    const [fields, issues] = await Promise.all([
      ctx.tx
        .select({ fieldPath: extractedFields.fieldPath, reviewStatus: extractedFields.reviewStatus })
        .from(extractedFields)
        .where(documentScope(extractedFields, ctx)),
      ctx.tx
        .select({ id: validationIssues.id, severity: validationIssues.severity, resolution: validationIssues.resolution })
        .from(validationIssues)
        .where(documentScope(validationIssues, ctx)),
    ]);
    if (!canApprove(checkApproval(fields, issues))) throw new Refusal("approval_blocked");
    await finalize(ctx, "approved");
    await logEvent(ctx, "document_approved", { note: input.note?.trim() || undefined });
  });
}

export function rejectDocument(db: Database, actor: Actor, input: { documentId: string; note: string }) {
  return reviewCommand(db, actor, input.documentId, async (ctx) => {
    const note = input.note.trim();
    if (!note) throw new Refusal("note_required");
    await finalize(ctx, "rejected");
    await logEvent(ctx, "document_rejected", { note });
  });
}

/** Thrown inside a command to refuse it; the transaction rolls back, so nothing is written. */
class Refusal extends Error {
  constructor(readonly code: ReviewErrorCode) {
    super(code);
  }
}

async function reviewCommand(
  db: Database,
  actor: Actor,
  documentId: string,
  command: (ctx: Context) => Promise<void>,
): Promise<ReviewResult> {
  try {
    await db.transaction(async (tx) => {
      // The row lock serializes every command on this document until commit.
      const [document] = await tx
        .select({ processingStatus: documents.processingStatus, reviewStatus: documents.reviewStatus })
        .from(documents)
        .where(and(eq(documents.organizationId, actor.organizationId), eq(documents.id, documentId)))
        .for("update");
      if (!document) throw new Refusal("document_not_found");
      if (document.processingStatus !== "ready_for_review" || !OPEN_FOR_REVIEW.includes(document.reviewStatus)) {
        throw new Refusal("not_reviewable");
      }

      const ctx: Context = { tx, actor, documentId };
      if (document.reviewStatus === "unreviewed") {
        await tx
          .update(documents)
          .set({ reviewStatus: "in_review", updatedAt: sql`now()` })
          .where(eq(documents.id, documentId));
        await logEvent(ctx, "review_started", {});
      }
      await command(ctx);
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, code: error.code };
    throw error;
  }
}

async function lockField({ tx, actor, documentId }: Context, fieldPath: string) {
  const [field] = await tx
    .select({
      id: extractedFields.id,
      extractionStatus: extractedFields.extractionStatus,
      extractedValue: extractedFields.extractedValue,
      currentValue: extractedFields.currentValue,
      reviewStatus: extractedFields.reviewStatus,
    })
    .from(extractedFields)
    .where(
      and(
        eq(extractedFields.organizationId, actor.organizationId),
        eq(extractedFields.documentId, documentId),
        eq(extractedFields.fieldPath, fieldPath),
      ),
    );
  if (!field) throw new Refusal("field_not_found");
  return field;
}

/**
 * Re-runs the validation rules on the current values after a correction: resolves the
 * open issues the correction fixed, raises the ones it introduced, and refreshes every
 * field's validation status.
 */
async function revalidate(ctx: Context, changedPath: string) {
  const { tx, actor } = ctx;
  const [fields, stored] = await Promise.all([
    tx
      .select({
        id: extractedFields.id,
        fieldPath: extractedFields.fieldPath,
        extractionStatus: extractedFields.extractionStatus,
        extractedValue: extractedFields.extractedValue,
        currentValue: extractedFields.currentValue,
        reviewStatus: extractedFields.reviewStatus,
        evidenceStatus: extractedFields.evidenceStatus,
        validationStatus: extractedFields.validationStatus,
      })
      .from(extractedFields)
      .where(documentScope(extractedFields, ctx)),
    tx
      .select({
        id: validationIssues.id,
        ruleId: validationIssues.ruleId,
        severity: validationIssues.severity,
        fieldPaths: validationIssues.fieldPaths,
        message: validationIssues.message,
        resolution: validationIssues.resolution,
      })
      .from(validationIssues)
      .where(documentScope(validationIssues, ctx)),
  ]);

  // The model's evidence still describes a value nobody changed. A corrected value is the
  // analyst's own, so the evidence rules do not apply to it.
  const evidence = new Map(
    fields
      .filter((field) => field.reviewStatus !== "corrected")
      .map((field) => [field.fieldPath, { evidenceStatus: field.evidenceStatus, valueSupported: null }]),
  );
  const report = validateExtraction(currentResult(fields), evidence);
  const changes = reconcileIssues(stored, report.issues, new Set([changedPath]));

  for (const issueId of changes.resolve) {
    await tx
      .update(validationIssues)
      .set({ resolution: "corrected", resolvedBy: actor.userId, resolvedAt: sql`now()` })
      .where(and(eq(validationIssues.id, issueId), isNull(validationIssues.resolution)));
    await logEvent(ctx, "issue_resolved", {
      issueId,
      newValue: { resolution: "corrected" },
      note: `Resolved by the correction to ${fieldLabel(changedPath)}.`,
    });
  }
  if (changes.insert.length > 0) {
    await tx
      .insert(validationIssues)
      .values(changes.insert.map((issue) => ({ organizationId: actor.organizationId, documentId: ctx.documentId, ...issue })));
  }

  // A field's validation status reflects every issue that still stands against its value:
  // open, confirmed, or accepted, but not one a correction resolved.
  const standing = [
    ...stored.filter((issue) => issue.resolution !== "corrected" && !changes.resolve.includes(issue.id)),
    ...changes.insert,
  ];
  for (const field of fields) {
    const status = fieldValidationStatus(field.fieldPath, standing);
    if (status !== field.validationStatus) {
      await tx.update(extractedFields).set({ validationStatus: status }).where(eq(extractedFields.id, field.id));
    }
  }
}

async function finalize({ tx, actor, documentId }: Context, status: Extract<DocumentReviewStatus, "approved" | "rejected">) {
  await tx
    .update(documents)
    .set({ reviewStatus: status, reviewedBy: actor.userId, reviewedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(documents.id, documentId));
}

async function logEvent(
  { tx, actor, documentId }: Context,
  eventType: ReviewEventType,
  details: { fieldPath?: string; issueId?: string; previousValue?: unknown; newValue?: unknown; note?: string },
) {
  await tx.insert(reviewEvents).values({
    organizationId: actor.organizationId,
    documentId,
    actorId: actor.userId,
    eventType,
    ...details,
    // now() is fixed for the whole transaction; the wall clock keeps the events of one
    // command in the order they happened.
    createdAt: sql`clock_timestamp()`,
  });
}

function documentScope(
  table: typeof extractedFields | typeof validationIssues,
  { actor, documentId }: Pick<Context, "actor" | "documentId">,
) {
  return and(eq(table.organizationId, actor.organizationId), eq(table.documentId, documentId));
}
