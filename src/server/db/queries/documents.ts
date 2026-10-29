import "server-only";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { staleProcessing } from "@/server/pipeline/transitions";
import type { Database } from "../client";
import { documentPages, documents } from "../schema";

// Every query takes organizationId and filters by it. There is no unscoped variant.

/** Columns the UI needs. Excludes the content hash and storage key. */
export const documentSummaryColumns = {
  id: documents.id,
  filename: documents.filename,
  sizeBytes: documents.sizeBytes,
  pageCount: documents.pageCount,
  processingStatus: documents.processingStatus,
  reviewStatus: documents.reviewStatus,
  failureCode: documents.failureCode,
  createdAt: documents.createdAt,
  /** Processing, but the attempt stopped responding; it can be retried. */
  processingStale: sql<boolean>`${staleProcessing()}`.mapWith(Boolean),
};

export type DocumentSummary = Awaited<ReturnType<typeof listRecentDocuments>>[number];

export async function findDocumentByHash(
  db: Database,
  organizationId: string,
  contentHash: string,
): Promise<DocumentSummary | undefined> {
  const [row] = await db
    .select(documentSummaryColumns)
    .from(documents)
    .where(and(eq(documents.organizationId, organizationId), eq(documents.contentHash, contentHash)))
    .limit(1);
  return row;
}

export async function countDocuments(db: Database, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(documents)
    .where(eq(documents.organizationId, organizationId));
  return row?.count ?? 0;
}

export async function listRecentDocuments(
  db: Database,
  organizationId: string,
  limit = 50,
) {
  return db
    .select(documentSummaryColumns)
    .from(documents)
    .where(eq(documents.organizationId, organizationId))
    .orderBy(desc(documents.createdAt))
    .limit(limit);
}

/** Page text in page order (index 0 is page 1), or undefined if the document is not in the org. */
export async function getDocumentPages(
  db: Database,
  organizationId: string,
  documentId: string,
): Promise<string[] | undefined> {
  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)))
    .limit(1);
  if (!document) return undefined;

  const pages = await db
    .select({ text: documentPages.text })
    .from(documentPages)
    .where(
      and(
        eq(documentPages.organizationId, organizationId),
        eq(documentPages.documentId, documentId),
      ),
    )
    .orderBy(asc(documentPages.pageNumber));
  return pages.map((page) => page.text);
}
