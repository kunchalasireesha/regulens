import "server-only";
import { createHash } from "node:crypto";
import type { Database } from "@/server/db/client";
import {
  documentSummaryColumns,
  findDocumentByHash,
  type DocumentSummary,
} from "@/server/db/queries/documents";
import { documentPages, documents, processingEvents } from "@/server/db/schema";
import type { DocumentFailureCode, UploadRejectionCode } from "./errors";
import { checkFileBytes, sanitizeFilename } from "./file-checks";
import { readPdfText } from "./pdf-text";
import { storageKeyFor, type FileStorage } from "./storage";

export type UploadDeps = {
  db: Database;
  storage: FileStorage;
  limits: { maxUploadBytes: number; maxPages: number };
};

export type UploadInput = {
  organizationId: string;
  uploadedBy: string;
  filename: string;
  bytes: Uint8Array;
};

export type UploadResult =
  | { kind: "created"; document: DocumentSummary }
  | { kind: "duplicate"; document: DocumentSummary }
  | { kind: "rejected"; code: UploadRejectionCode };

/**
 * Accepts an uploaded file: checks it, detects duplicates, extracts page text,
 * stores the file, and records the document with its pages.
 *
 * Order matters: everything that can reject the file runs before anything is
 * written, so a rejected upload leaves no trace. The file is written before the
 * database rows; if the insert then fails, the stored file is harmless because its
 * key is derived from its content and a retry writes the same key.
 */
export async function uploadDocument(deps: UploadDeps, input: UploadInput): Promise<UploadResult> {
  const { db, storage, limits } = deps;
  const { organizationId, bytes } = input;

  const rejection = checkFileBytes(bytes, limits);
  if (rejection) return { kind: "rejected", code: rejection };

  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const existing = await findDocumentByHash(db, organizationId, contentHash);
  if (existing) return { kind: "duplicate", document: existing };

  const parseStartedAt = performance.now();
  const parsed = await readPdfText(bytes, limits);
  if (!parsed.ok) return { kind: "rejected", code: parsed.code };
  const parseDurationMs = Math.round(performance.now() - parseStartedAt);

  const storageKey = storageKeyFor(organizationId, contentHash);
  await storage.put(storageKey, bytes);

  const failureCode: DocumentFailureCode | null = parsed.hasTextLayer ? null : "no_text_layer";

  const created = await db.transaction(async (tx) => {
    // ON CONFLICT DO NOTHING handles two concurrent uploads of the same file: the
    // unique (organization_id, content_hash) constraint lets exactly one insert win.
    const [document] = await tx
      .insert(documents)
      .values({
        organizationId,
        uploadedBy: input.uploadedBy,
        filename: sanitizeFilename(input.filename),
        contentHash,
        sizeBytes: bytes.length,
        pageCount: parsed.pageCount,
        storageKey,
        // Text extracted: waits in the queue for AI extraction (Phase 3).
        processingStatus: failureCode ? "failed" : "queued",
        failureCode,
      })
      .onConflictDoNothing({ target: [documents.organizationId, documents.contentHash] })
      .returning(documentSummaryColumns);
    if (!document) return null;

    if (parsed.hasTextLayer) {
      await tx.insert(documentPages).values(
        parsed.pages.map((text, i) => ({
          organizationId,
          documentId: document.id,
          pageNumber: i + 1,
          text,
        })),
      );
    }
    await tx.insert(processingEvents).values({
      organizationId,
      documentId: document.id,
      stage: "parse",
      outcome: failureCode ? "failed" : "succeeded",
      durationMs: parseDurationMs,
      errorCode: failureCode,
    });
    return document;
  });

  if (created) return { kind: "created", document: created };

  // Lost the race to a concurrent upload of the same bytes.
  const winner = await findDocumentByHash(db, organizationId, contentHash);
  if (!winner) throw new Error("Document conflict reported but no existing row was found");
  return { kind: "duplicate", document: winner };
}
