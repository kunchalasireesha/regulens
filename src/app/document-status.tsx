import type { ProcessingStatus } from "@/lib/domain/statuses";
import type { DocumentSummary } from "@/server/db/queries/documents";
import { failureMessage, isRetryableFailure } from "@/server/pipeline/failures";
import { retryDocumentAction } from "./actions";

const STATUS_LABELS: Record<ProcessingStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  processing: { label: "Processing", className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  ready_for_review: {
    label: "Ready for review",
    className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

type StatusFields = Pick<DocumentSummary, "id" | "processingStatus" | "processingStale" | "failureCode">;

/** Queued or processing with a live attempt: the page should poll for the outcome. */
export function isInFlight(doc: StatusFields): boolean {
  return doc.processingStatus === "queued" || (doc.processingStatus === "processing" && !doc.processingStale);
}

/** Processing status badge, the failure reason if any, and a Retry button when allowed. */
export function DocumentStatus({ doc }: { doc: StatusFields }) {
  const status = STATUS_LABELS[doc.processingStatus];
  const stale = doc.processingStale;
  const failure = stale
    ? "Processing stopped responding."
    : doc.processingStatus === "failed"
      ? failureMessage(doc.failureCode)
      : null;
  const retryable = stale || (doc.processingStatus === "failed" && isRetryableFailure(doc.failureCode));
  return (
    <>
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
      {failure && <p className="mt-1 max-w-xs text-xs text-zinc-500">{failure}</p>}
      {retryable && (
        <form action={retryDocumentAction} className="mt-1">
          <input type="hidden" name="documentId" value={doc.id} />
          <button type="submit" className="text-xs font-medium underline underline-offset-2 hover:text-zinc-600">
            Retry
          </button>
        </form>
      )}
    </>
  );
}
