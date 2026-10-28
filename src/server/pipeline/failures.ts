import { EXTRACTION_ERROR_MESSAGES, type ExtractionErrorCode } from "@/server/extraction/errors";
import { DOCUMENT_FAILURE_MESSAGES, type DocumentFailureCode } from "@/server/ingestion/errors";

// Every code that can end up on documents.failure_code, with a message safe to show users.

export const PIPELINE_FAILURE_MESSAGES = {
  ...DOCUMENT_FAILURE_MESSAGES,
  ...EXTRACTION_ERROR_MESSAGES,
  processing_error: "Processing failed unexpectedly.",
} as const;

export type PipelineFailureCode = DocumentFailureCode | ExtractionErrorCode | "processing_error";

/**
 * Failures that cannot change on a retry: the stored text is what it is. Everything else
 * (rate limits, outages, a malformed response, a fixed API key, a bug fix) may succeed
 * on another attempt.
 */
const PERMANENT: ReadonlySet<string> = new Set<PipelineFailureCode>(["no_text_layer", "no_pages"]);

export function isRetryableFailure(code: string | null): boolean {
  return code !== null && code in PIPELINE_FAILURE_MESSAGES && !PERMANENT.has(code);
}

export function failureMessage(code: string | null): string | null {
  if (code === null) return null;
  return code in PIPELINE_FAILURE_MESSAGES
    ? PIPELINE_FAILURE_MESSAGES[code as PipelineFailureCode]
    : PIPELINE_FAILURE_MESSAGES.processing_error;
}
