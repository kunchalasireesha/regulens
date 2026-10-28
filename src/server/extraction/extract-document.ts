import "server-only";
import type { ExtractionResult } from "@/lib/schemas/extraction";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/schemas/extraction";
import type { Database } from "@/server/db/client";
import { getDocumentPages } from "@/server/db/queries/documents";
import { extractionRuns } from "@/server/db/schema";
import type { ExtractionErrorCode } from "./errors";
import type { ExtractionProvider } from "./provider";
import { runExtraction } from "./run";

export type ExtractDocumentDeps = {
  db: Database;
  provider: ExtractionProvider;
  now?: () => Date;
};

export type ExtractDocumentResult =
  | { kind: "not_found" }
  | { kind: "succeeded"; runId: string; result: ExtractionResult; pages: string[] }
  | { kind: "failed"; runId: string; errorCode: ExtractionErrorCode };

/**
 * Runs AI extraction over a document's stored page text and records the attempt in
 * extraction_runs, whether it succeeded or failed, with tokens, latency, and cost.
 *
 * This is one stage. It does not change the document's processing status or create
 * reviewable fields; the pipeline (src/server/pipeline) does both. The page text is
 * returned so later stages can verify evidence against exactly what the model saw.
 */
export async function extractDocument(
  deps: ExtractDocumentDeps,
  input: { organizationId: string; documentId: string },
): Promise<ExtractDocumentResult> {
  const { db, provider } = deps;
  const { organizationId, documentId } = input;

  const pages = await getDocumentPages(db, organizationId, documentId);
  if (!pages) return { kind: "not_found" };

  const outcome = await runExtraction(provider, pages, { now: deps.now });
  if (outcome.status === "failed" && outcome.issuePaths.length > 0) {
    // Field paths only, never values: enough to see which part of the schema drifted.
    console.warn("extraction response failed validation", {
      documentId,
      errorCode: outcome.errorCode,
      issuePaths: outcome.issuePaths,
    });
  }

  const [run] = await db
    .insert(extractionRuns)
    .values({
      organizationId,
      documentId,
      provider: outcome.provider,
      model: outcome.model,
      promptVersion: provider.promptVersion,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      status: outcome.status,
      inputTokens: outcome.usage?.inputTokens,
      outputTokens: outcome.usage?.outputTokens,
      latencyMs: outcome.latencyMs,
      estimatedCostUsd: outcome.estimatedCostUsd?.toFixed(6),
      errorCode: outcome.status === "failed" ? outcome.errorCode : null,
      result: outcome.status === "succeeded" ? outcome.result : null,
    })
    .returning({ id: extractionRuns.id });
  if (!run) throw new Error("extraction run insert returned no row");

  return outcome.status === "succeeded"
    ? { kind: "succeeded", runId: run.id, result: outcome.result, pages }
    : { kind: "failed", runId: run.id, errorCode: outcome.errorCode };
}
