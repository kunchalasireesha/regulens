import "server-only";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { PIPELINE_FAILURE_MESSAGES, isRetryableFailure, type PipelineFailureCode } from "./failures";

// The document processing state machine. Every transition is a single conditional UPDATE,
// so the database, not application code, decides which caller wins a race.
//
//   queued ──claim──► processing ──complete──► ready_for_review
//     ▲                  │  ▲
//     │                  │  └─ claim again once the attempt is stale (its process died)
//     │                  └─────fail──────► failed
//     └──────────── retry ◄────────────────┘   (retryable failure codes only)
//
// Uploads create documents directly in `queued`, or in `failed` when there is no text layer.

/**
 * How long an attempt may stay in `processing` before it is presumed dead. Well above the
 * slowest legitimate run (Gemini: 3 attempts × 120 s timeout plus capped backoff).
 */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export type DocumentRef = { organizationId: string; documentId: string };

/** Proof of a claim: only the holder of the current attempt number may finish it. */
export type Claim = DocumentRef & { attempt: number };

type Executor = Pick<Database, "update">;

const isDocument = ({ organizationId, documentId }: DocumentRef) =>
  and(eq(documents.organizationId, organizationId), eq(documents.id, documentId));

/**
 * Whether a document's processing attempt is presumed dead. Evaluated by the database, so
 * every caller compares against the same clock that stamped updated_at.
 */
export const staleProcessing = (staleAfterMs = STALE_AFTER_MS) =>
  and(
    eq(documents.processingStatus, "processing"),
    lt(documents.updatedAt, sql`now() - make_interval(secs => ${staleAfterMs / 1000})`),
  )!;

/**
 * Moves a queued (or stale processing) document to `processing` and starts a new attempt.
 * Returns null when there is nothing to claim: another caller holds a live claim, the
 * document has already finished, or it is not in this organization.
 */
export async function claimDocument(
  db: Executor,
  ref: DocumentRef,
  staleAfterMs = STALE_AFTER_MS,
): Promise<Claim | null> {
  const [row] = await db
    .update(documents)
    .set({
      processingStatus: "processing",
      processingAttempts: sql`${documents.processingAttempts} + 1`,
      failureCode: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        isDocument(ref),
        or(eq(documents.processingStatus, "queued"), staleProcessing(staleAfterMs)),
      ),
    )
    .returning({ attempt: documents.processingAttempts });
  return row ? { ...ref, attempt: row.attempt } : null;
}

/**
 * Ends the claimed attempt as ready for review or failed. Returns false, changing nothing,
 * when the claim is no longer current (the attempt went stale and was reclaimed, or was
 * requeued); the caller must then discard its work.
 */
export async function finishAttempt(
  db: Executor,
  claim: Claim,
  outcome: { status: "ready_for_review" } | { status: "failed"; failureCode: PipelineFailureCode },
): Promise<boolean> {
  const rows = await db
    .update(documents)
    .set({
      processingStatus: outcome.status,
      failureCode: outcome.status === "failed" ? outcome.failureCode : null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        isDocument(claim),
        eq(documents.processingStatus, "processing"),
        eq(documents.processingAttempts, claim.attempt),
      ),
    )
    .returning({ id: documents.id });
  return rows.length === 1;
}

const RETRYABLE_CODES = Object.keys(PIPELINE_FAILURE_MESSAGES).filter(isRetryableFailure);

/**
 * Puts a document back in the queue: after a retryable failure, or when its attempt is
 * stale. Returns false when the document is in any other state. Does not run the
 * pipeline; the caller schedules that.
 */
export async function requeueDocument(
  db: Executor,
  ref: DocumentRef,
  staleAfterMs = STALE_AFTER_MS,
): Promise<boolean> {
  const rows = await db
    .update(documents)
    .set({ processingStatus: "queued", failureCode: null, updatedAt: sql`now()` })
    .where(
      and(
        isDocument(ref),
        or(
          and(eq(documents.processingStatus, "failed"), inArray(documents.failureCode, RETRYABLE_CODES)),
          staleProcessing(staleAfterMs),
        ),
      ),
    )
    .returning({ id: documents.id });
  return rows.length === 1;
}
