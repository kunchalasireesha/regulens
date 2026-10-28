import Link from "next/link";
import { connection } from "next/server";
import { QUEUE_LABELS, queueHref, type QueueFilter } from "@/lib/dashboard/queues";
import { formatTimestamp } from "@/lib/format";
import { getCurrentActor } from "@/server/auth/current-actor";
import { getDb } from "@/server/db/client";
import {
  getQueueCounts,
  listQueueDocuments,
  type QueueCounts,
  type QueueDocument,
} from "@/server/db/queries/dashboard";
import { DocumentStatus, ReviewStatus } from "./document-status";
import { RefreshWhileProcessing } from "./refresh-while-processing";

const TABS: QueueFilter[] = ["needs_review", "in_progress", "failed", "approved", "rejected", "all"];

const EMPTY_MESSAGES: Record<QueueFilter, string> = {
  all: "No documents yet. Upload a sample from samples/.",
  needs_review: "Nothing is waiting for review.",
  in_progress: "Nothing is being processed.",
  failed: "No failed documents.",
  approved: "No approved documents yet.",
  rejected: "No rejected documents.",
};

export async function DocumentList({ filter }: { filter: QueueFilter }) {
  // Database reads must happen per request, not during prerendering.
  await connection();
  const db = getDb();
  const actor = await getCurrentActor(db);
  const [counts, documents] = await Promise.all([
    getQueueCounts(db, actor.organizationId),
    listQueueDocuments(db, actor.organizationId, filter),
  ]);

  return (
    <div className="flex flex-col gap-4">
      {/* Poll on the counts, not the visible rows: a document finishing in another tab still moves the numbers. */}
      <RefreshWhileProcessing active={counts.in_progress > 0} />
      <QueueTabs counts={counts} current={filter} />
      {documents.length === 0 ? (
        <p className="text-sm text-zinc-500">{EMPTY_MESSAGES[filter]}</p>
      ) : (
        <DocumentTable documents={documents} />
      )}
    </div>
  );
}

function QueueTabs({ counts, current }: { counts: QueueCounts; current: QueueFilter }) {
  return (
    <nav aria-label="Document queues" className="flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const active = tab === current;
        const urgent = tab === "failed" && counts.failed > 0;
        return (
          <Link
            key={tab}
            href={queueHref(tab)}
            aria-current={active ? "page" : undefined}
            className={`flex items-baseline gap-2 rounded-md border px-3 py-1.5 text-sm ${
              active
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
            }`}
          >
            {QUEUE_LABELS[tab]}
            <span
              className={`tabular-nums text-xs ${
                urgent && !active ? "font-semibold text-red-600 dark:text-red-400" : "opacity-70"
              }`}
            >
              {counts[tab]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function DocumentTable({ documents }: { documents: QueueDocument[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="py-2 pr-4 font-medium">File</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Fields reviewed</th>
            <th className="py-2 pr-4 font-medium">Open issues</th>
            <th className="py-2 font-medium">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
              <td className="py-2 pr-4 font-medium break-all">
                <Link href={`/documents/${doc.id}`} className="underline-offset-2 hover:underline">
                  {doc.filename}
                </Link>
                {doc.pageCount !== null && (
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
                  </span>
                )}
              </td>
              <td className="py-2 pr-4">
                <DocumentStatus doc={doc} /> <ReviewStatus status={doc.reviewStatus} />
              </td>
              <td className="py-2 pr-4 tabular-nums">
                {doc.fieldsTotal === 0 ? "–" : `${doc.fieldsReviewed} / ${doc.fieldsTotal}`}
              </td>
              <td className="py-2 pr-4">
                <OpenIssues critical={doc.openCriticalIssues} warning={doc.openWarningIssues} />
              </td>
              <td className="py-2 whitespace-nowrap text-zinc-500">
                <time dateTime={doc.createdAt.toISOString()}>{formatTimestamp(doc.createdAt)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Open issues that block approval. Info issues never block, so they are not counted. */
function OpenIssues({ critical, warning }: { critical: number; warning: number }) {
  if (critical === 0 && warning === 0) return <span className="text-zinc-400">–</span>;
  return (
    <span className="flex flex-wrap gap-1 text-xs font-medium">
      {critical > 0 && (
        <span className="rounded bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-300">
          {critical} critical
        </span>
      )}
      {warning > 0 && (
        <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {warning} {warning === 1 ? "warning" : "warnings"}
        </span>
      )}
    </span>
  );
}
