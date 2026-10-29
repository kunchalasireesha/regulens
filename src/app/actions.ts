"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { getCurrentActor } from "@/server/auth/current-actor";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { createExtractionProvider } from "@/server/extraction/create-provider";
import { UPLOAD_REJECTION_MESSAGES } from "@/server/ingestion/errors";
import { createFileStorage } from "@/server/ingestion/create-storage";
import { uploadDocument } from "@/server/ingestion/upload";
import { runPipeline } from "@/server/pipeline/run-pipeline";
import { requeueDocument, type DocumentRef } from "@/server/pipeline/transitions";

export type UploadState =
  | { status: "idle" }
  | {
      status: "created" | "duplicate";
      document: { id: string; filename: string; pageCount: number | null; failed: boolean };
    }
  | { status: "error"; message: string };

/**
 * Thin adapter between the form and the upload service: reads FormData, resolves the
 * actor, and shapes the result for the UI. All checks live in uploadDocument.
 */
export async function uploadDocumentAction(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a PDF file to upload." };
  }

  const db = getDb();
  // Outside the try: it redirects to the login page when the session has ended.
  const actor = await getCurrentActor(db);
  const env = getEnv();
  // Reject before reading the body into a buffer.
  if (file.size > env.maxUploadBytes) {
    return { status: "error", message: UPLOAD_REJECTION_MESSAGES.file_too_large };
  }

  try {
    const result = await uploadDocument(
      {
        db,
        storage: createFileStorage(env.storage),
        limits: {
          maxUploadBytes: env.maxUploadBytes,
          maxPages: env.maxPages,
          maxDocuments: env.maxDocuments,
        },
      },
      {
        organizationId: actor.organizationId,
        uploadedBy: actor.userId,
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    );

    if (result.kind === "rejected") {
      return { status: "error", message: UPLOAD_REJECTION_MESSAGES[result.code] };
    }
    const { document } = result;
    // A duplicate can still be queued if the process that uploaded it died before
    // processing; the pipeline's claim makes scheduling it again harmless.
    if (document.processingStatus === "queued") {
      schedulePipeline({ organizationId: actor.organizationId, documentId: document.id });
    }
    if (result.kind === "created") refresh();
    return {
      status: result.kind,
      document: {
        id: document.id,
        filename: document.filename,
        pageCount: document.pageCount,
        failed: document.processingStatus === "failed",
      },
    };
  } catch (error) {
    // Log server-side; never send internal error details to the browser.
    console.error("upload failed", error);
    return { status: "error", message: "The upload failed. Please try again." };
  }
}

/** Requeues a document after a retryable failure or a stalled attempt, and processes it. */
export async function retryDocumentAction(formData: FormData): Promise<void> {
  const documentId = z.uuid().safeParse(formData.get("documentId"));
  if (!documentId.success) return;

  const db = getDb();
  const actor = await getCurrentActor(db);
  const ref = { organizationId: actor.organizationId, documentId: documentId.data };
  // Not requeued: the document is in a state that cannot be retried, or another
  // request already did it. Either way, re-rendering shows the current status.
  if (await requeueDocument(db, ref)) schedulePipeline(ref);
  refresh();
}

/**
 * Runs the pipeline after the response is sent, so the analyst sees the document as
 * queued immediately instead of waiting for the model. The document list polls for the
 * outcome. A job queue would replace this function and nothing else.
 */
function schedulePipeline(ref: DocumentRef) {
  after(async () => {
    try {
      const outcome = await runPipeline(
        { db: getDb(), provider: createExtractionProvider(getEnv().ai) },
        ref,
      );
      console.info("pipeline finished", { documentId: ref.documentId, outcome: outcome.kind });
    } catch (error) {
      // Only reachable if recording the failure itself failed (e.g. the database is
      // down). The document stays `processing` until its attempt is stale and retried.
      console.error("pipeline could not record its outcome", { documentId: ref.documentId }, error);
    }
  });
}
