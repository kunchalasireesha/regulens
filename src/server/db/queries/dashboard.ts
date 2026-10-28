import "server-only";
import { and, asc, count, desc, eq, max, sql, type SQL } from "drizzle-orm";
import { DOCUMENT_QUEUES, type DocumentQueue, type QueueFilter } from "@/lib/dashboard/queues";
import { staleProcessing } from "@/server/pipeline/transitions";
import type { Database } from "../client";
import { documents, extractedFields, extractionRuns, validationIssues } from "../schema";
import { documentSummaryColumns } from "./documents";

// Read models for the home dashboard. Like every query module, scoped by organization.

/**
 * The work queue a document belongs to. Order matters: a stalled attempt counts as
 * failed (it needs a retry, not a wait), and review status only matters once
 * processing has finished.
 */
const documentQueue = sql<DocumentQueue>`case
  when ${documents.processingStatus} = 'failed' or ${staleProcessing()} then 'failed'
  when ${documents.processingStatus} in ('queued', 'processing') then 'in_progress'
  when ${documents.reviewStatus} = 'approved' then 'approved'
  when ${documents.reviewStatus} = 'rejected' then 'rejected'
  else 'needs_review'
end`;

export type QueueCounts = Record<DocumentQueue, number> & { all: number };

/** How many documents are in each queue. Every queue is present, zero when empty. */
export async function getQueueCounts(db: Database, organizationId: string): Promise<QueueCounts> {
  // Classify in a subquery, then group by its output column. Grouping by the expression
  // directly fails: its bound parameters are renumbered between SELECT and GROUP BY, so
  // Postgres no longer sees them as the same expression.
  const classified = db
    .select({ queue: documentQueue.as("queue") })
    .from(documents)
    .where(eq(documents.organizationId, organizationId))
    .as("classified");
  const rows = await db
    .select({ queue: classified.queue, count: count() })
    .from(classified)
    .groupBy(classified.queue);

  const counts = Object.fromEntries(DOCUMENT_QUEUES.map((queue) => [queue, 0])) as QueueCounts;
  counts.all = 0;
  for (const row of rows) {
    counts[row.queue] = row.count;
    counts.all += row.count;
  }
  return counts;
}

// The outer document's id, written out with its table. Drizzle leaves column names
// unqualified in a single-table select, so a bare ${documents.id} inside these
// subqueries would resolve to the subquery's own "id" column instead.
const outerDocumentId = sql`${documents}.${sql.identifier(documents.id.name)}`;

const openIssues = (severity: "critical" | "warning") =>
  sql<number>`(
    select count(*) from ${validationIssues}
    where ${validationIssues.documentId} = ${outerDocumentId}
      and ${validationIssues.resolution} is null
      and ${validationIssues.severity} = ${severity}
  )`.mapWith(Number);

const fieldCount = (where?: SQL) =>
  sql<number>`(
    select count(*) from ${extractedFields}
    where ${extractedFields.documentId} = ${outerDocumentId}${where ? sql` and ${where}` : sql``}
  )`.mapWith(Number);

export type QueueDocument = Awaited<ReturnType<typeof listQueueDocuments>>[number];

/**
 * Documents in a queue with their review progress. The review queue is oldest first, so
 * whatever has waited longest is at the top; every other view is newest first.
 */
export async function listQueueDocuments(
  db: Database,
  organizationId: string,
  filter: QueueFilter,
  limit = 50,
) {
  const inOrganization = eq(documents.organizationId, organizationId);
  return db
    .select({
      ...documentSummaryColumns,
      queue: documentQueue,
      openCriticalIssues: openIssues("critical"),
      openWarningIssues: openIssues("warning"),
      fieldsTotal: fieldCount(),
      fieldsReviewed: fieldCount(sql`${extractedFields.reviewStatus} <> 'pending'`),
    })
    .from(documents)
    .where(filter === "all" ? inOrganization : and(inOrganization, sql`${documentQueue} = ${filter}`))
    .orderBy(filter === "needs_review" ? asc(documents.createdAt) : desc(documents.createdAt))
    .limit(limit);
}

export type ExtractionStats = Awaited<ReturnType<typeof getExtractionStats>>[number];

/**
 * Extraction runs per provider and model, most recently used first. Latency is the
 * median of successful runs (failed runs often end early on a timeout or a refusal).
 * Cost is what the runs would cost at paid-tier list prices.
 */
export async function getExtractionStats(db: Database, organizationId: string) {
  const succeeded = sql`${extractionRuns.status} = 'succeeded'`;
  return db
    .select({
      provider: extractionRuns.provider,
      model: extractionRuns.model,
      runs: count(),
      succeeded: sql<number>`count(*) filter (where ${succeeded})`.mapWith(Number),
      medianLatencyMs: sql<number | null>`percentile_cont(0.5) within group (order by ${extractionRuns.latencyMs}) filter (where ${succeeded})`.mapWith(
        (value) => (value === null ? null : Math.round(Number(value))),
      ),
      inputTokens: sql<number>`coalesce(sum(${extractionRuns.inputTokens}), 0)`.mapWith(Number),
      outputTokens: sql<number>`coalesce(sum(${extractionRuns.outputTokens}), 0)`.mapWith(Number),
      /** Decimal string, as numeric arrives from Postgres; null when no run had a price. */
      estimatedCostUsd: sql<string | null>`sum(${extractionRuns.estimatedCostUsd})`,
      lastRunAt: max(extractionRuns.createdAt),
    })
    .from(extractionRuns)
    .where(eq(extractionRuns.organizationId, organizationId))
    .groupBy(extractionRuns.provider, extractionRuns.model)
    .orderBy(desc(max(extractionRuns.createdAt)));
}
