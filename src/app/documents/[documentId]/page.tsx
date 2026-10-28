import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatBytes, formatTimestamp } from "@/lib/format";
import { getCurrentActor } from "@/server/auth/current-actor";
import { getDb } from "@/server/db/client";
import { getDocumentReview, type ReviewDocument } from "@/server/db/queries/review";
import { DocumentStatus, isInFlight } from "../../document-status";
import { RefreshWhileProcessing } from "../../refresh-while-processing";
import { ReviewWorkspace } from "./review-workspace";

export const metadata: Metadata = { title: "Review · ReguLens" };

export default function DocumentPage({ params }: PageProps<"/documents/[documentId]">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <Link href="/" className="text-sm text-zinc-500 underline-offset-2 hover:underline">
        ← All documents
      </Link>
      {/* The id is only known per request, so everything that depends on it streams in. */}
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading document…</p>}>
        {params.then(({ documentId }) => (
          <DocumentReview documentId={documentId} />
        ))}
      </Suspense>
    </main>
  );
}

async function DocumentReview({ documentId }: { documentId: string }) {
  await connection();
  const db = getDb();
  const actor = await getCurrentActor(db);
  const review = await getDocumentReview(db, actor.organizationId, documentId);
  if (!review) notFound();

  const { document } = review;
  return (
    <>
      <RefreshWhileProcessing active={isInFlight(document)} />
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight break-all">{document.filename}</h1>
          <div className="text-right">
            <DocumentStatus doc={document} />
          </div>
        </div>
        <p className="text-sm text-zinc-500">
          {document.pageCount ?? "–"} pages · {formatBytes(document.sizeBytes)} · uploaded{" "}
          <time dateTime={document.createdAt.toISOString()}>{formatTimestamp(document.createdAt)}</time>
          {review.extractionRun && <> · {describeRun(review.extractionRun)}</>}
        </p>
      </header>

      {document.processingStatus === "ready_for_review" ? (
        <ReviewWorkspace fields={review.fields} issues={review.issues} pages={review.pages} />
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{pendingMessage(document)}</p>
      )}
    </>
  );
}

function describeRun(run: NonNullable<ReviewDocument["extractionRun"]>): string {
  const parts = [`extracted by ${run.provider} (${run.model})`];
  if (run.latencyMs !== null) parts.push(`${(run.latencyMs / 1000).toFixed(1)} s`);
  if (run.inputTokens !== null && run.outputTokens !== null) {
    parts.push(`${run.inputTokens.toLocaleString("en-US")} in / ${run.outputTokens.toLocaleString("en-US")} out tokens`);
  }
  return parts.join(", ");
}

function pendingMessage(document: ReviewDocument["document"]): string {
  if (isInFlight(document)) return "Extraction is in progress. This page updates when it finishes.";
  if (document.processingStatus === "failed") return "Processing did not finish, so there is nothing to review.";
  return "Processing stopped responding. Retry to process it again.";
}
