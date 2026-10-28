import "server-only";
import type { ProcessingStage, StageOutcome } from "@/lib/domain/statuses";
import type { Database } from "@/server/db/client";
import { extractedFields, fieldEvidence, processingEvents, validationIssues } from "@/server/db/schema";
import { verifyResultEvidence } from "@/server/evidence/verify";
import { extractDocument } from "@/server/extraction/extract-document";
import type { ExtractionProvider } from "@/server/extraction/provider";
import { validateExtraction } from "@/server/validation/validate";
import { deriveRecords, type DerivedRecords } from "./derive-records";
import type { PipelineFailureCode } from "./failures";
import { claimDocument, finishAttempt, type Claim, type DocumentRef } from "./transitions";

export type PipelineDeps = {
  db: Database;
  provider: ExtractionProvider;
  staleAfterMs?: number;
};

export type PipelineOutcome =
  /** Nothing to do: already claimed by a live attempt, already finished, or not in this org. */
  | { kind: "not_claimed" }
  | { kind: "ready_for_review"; extractionRunId: string; fieldCount: number; issueCount: number }
  | { kind: "failed"; failureCode: PipelineFailureCode }
  /** This attempt went stale and a newer one took over; its work was discarded. */
  | { kind: "superseded" };

/**
 * Takes a queued document through extract → verify evidence → validate, and leaves it
 * `ready_for_review` with its fields, evidence, and issues, or `failed` with a code.
 *
 * Safe to call any number of times, concurrently: only the caller that claims the
 * document does any work. The model call runs outside any transaction (it can take
 * minutes); everything after it is written in one transaction together with the final
 * status, so a document is never ready for review with half its fields.
 *
 * Plain function, no framework: the upload action runs it after responding, and a job
 * queue could run it unchanged.
 */
export async function runPipeline(deps: PipelineDeps, ref: DocumentRef): Promise<PipelineOutcome> {
  const { db } = deps;
  const claim = await claimDocument(db, ref, deps.staleAfterMs);
  if (!claim) return { kind: "not_claimed" };

  let stage: ProcessingStage = "extract";
  let stageStartedAt = performance.now();
  try {
    const extraction = await extractDocument({ db, provider: deps.provider }, ref);
    if (extraction.kind === "not_found") throw new Error("claimed document no longer exists");
    await recordEvent(db, claim, stage, stageStartedAt, extraction);
    if (extraction.kind === "failed") {
      const finished = await finishAttempt(db, claim, { status: "failed", failureCode: extraction.errorCode });
      return finished ? { kind: "failed", failureCode: extraction.errorCode } : { kind: "superseded" };
    }

    const { result, pages, runId } = extraction;
    stage = "verify_evidence";
    stageStartedAt = performance.now();
    const evidence = verifyResultEvidence(pages, result);
    const verifyMs = elapsedSince(stageStartedAt);

    stage = "validate";
    stageStartedAt = performance.now();
    const report = validateExtraction(result, evidence);
    const records = deriveRecords(result, evidence, report);
    const validateMs = elapsedSince(stageStartedAt);

    const finished = await db.transaction(async (tx) => {
      // Status first: the UPDATE locks the row, and if the claim is no longer current
      // nothing has been written yet, so there is nothing to roll back.
      if (!(await finishAttempt(tx, claim, { status: "ready_for_review" }))) return false;
      await insertRecords(tx, claim, runId, records);
      await tx.insert(processingEvents).values([
        { ...eventBase(claim), stage: "verify_evidence", outcome: "succeeded", durationMs: verifyMs },
        { ...eventBase(claim), stage: "validate", outcome: "succeeded", durationMs: validateMs },
      ]);
      return true;
    });
    if (!finished) return { kind: "superseded" };
    return {
      kind: "ready_for_review",
      extractionRunId: runId,
      fieldCount: records.fields.length,
      issueCount: records.issues.length,
    };
  } catch (error) {
    // Error details stay server-side, and only their class: database errors can carry
    // query parameters, which here are document values.
    console.error("pipeline stage failed", { documentId: ref.documentId, stage, error: describeError(error) });
    await recordEvent(db, claim, stage, stageStartedAt, { kind: "failed", errorCode: "processing_error" });
    const finished = await finishAttempt(db, claim, { status: "failed", failureCode: "processing_error" });
    return finished ? { kind: "failed", failureCode: "processing_error" } : { kind: "superseded" };
  }
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function insertRecords(tx: Tx, claim: Claim, extractionRunId: string, records: DerivedRecords) {
  const { organizationId, documentId } = claim;
  const inserted = await tx
    .insert(extractedFields)
    .values(
      records.fields.map((field) => ({
        organizationId,
        documentId,
        extractionRunId,
        fieldPath: field.fieldPath,
        extractedValue: field.extractedValue,
        normalizedValue: field.normalizedValue,
        currentValue: field.currentValue,
        extractionStatus: field.extractionStatus,
        evidenceStatus: field.evidenceStatus,
        validationStatus: field.validationStatus,
      })),
    )
    .returning({ id: extractedFields.id, fieldPath: extractedFields.fieldPath });
  const fieldIds = new Map(inserted.map((row) => [row.fieldPath, row.id]));

  const evidence = records.fields.flatMap((field) =>
    field.evidence.map((check) => ({ organizationId, fieldId: fieldIds.get(field.fieldPath)!, ...check })),
  );
  if (evidence.length > 0) await tx.insert(fieldEvidence).values(evidence);

  if (records.issues.length > 0) {
    await tx.insert(validationIssues).values(
      records.issues.map((issue) => ({ organizationId, documentId, ...issue })),
    );
  }
}

const eventBase = (claim: Claim) => ({ organizationId: claim.organizationId, documentId: claim.documentId });

async function recordEvent(
  db: Pick<Database, "insert">,
  claim: Claim,
  stage: ProcessingStage,
  startedAt: number,
  outcome: { kind: "succeeded" } | { kind: "failed"; errorCode: string },
) {
  const result: StageOutcome = outcome.kind === "succeeded" ? "succeeded" : "failed";
  await db.insert(processingEvents).values({
    ...eventBase(claim),
    stage,
    outcome: result,
    durationMs: elapsedSince(startedAt),
    errorCode: outcome.kind === "failed" ? outcome.errorCode : null,
  });
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

/** Error name plus a Postgres error code, if any. Never the message, which may hold values. */
function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  const cause = error.cause as { code?: unknown } | undefined;
  return { name: error.name, ...(typeof cause?.code === "string" ? { code: cause.code } : {}) };
}
