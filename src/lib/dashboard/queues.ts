// The dashboard sorts every document into exactly one work queue, so the counts add up
// to the total and each document shows up under one tab. The classification itself is
// a SQL expression (src/server/db/queries/dashboard.ts) so filtering and counting
// happen in the database; this module holds the vocabulary the URL and UI share.

export const DOCUMENT_QUEUES = ["needs_review", "in_progress", "failed", "approved", "rejected"] as const;
export type DocumentQueue = (typeof DOCUMENT_QUEUES)[number];

/** A queue, or every document. */
export type QueueFilter = DocumentQueue | "all";

export const QUEUE_LABELS: Record<QueueFilter, string> = {
  all: "All",
  needs_review: "Needs review",
  in_progress: "In progress",
  failed: "Failed",
  approved: "Approved",
  rejected: "Rejected",
};

/** The dashboard opens on the analyst's work, not on everything. */
export const DEFAULT_QUEUE_FILTER: QueueFilter = "needs_review";

/** Reads the `queue` search parameter; anything unrecognized falls back to the default. */
export function parseQueueFilter(value: string | string[] | undefined): QueueFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "all") return "all";
  return DOCUMENT_QUEUES.find((queue) => queue === raw) ?? DEFAULT_QUEUE_FILTER;
}

/** The URL for a queue tab. The default queue has no parameter, so "/" stays canonical. */
export function queueHref(filter: QueueFilter): string {
  return filter === DEFAULT_QUEUE_FILTER ? "/" : `/?queue=${filter}`;
}
