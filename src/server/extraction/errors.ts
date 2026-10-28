// Why an extraction run failed. Stored on extraction_runs.error_code and safe to show
// to users: codes describe the failure class, never provider messages or document text.

export const EXTRACTION_ERROR_MESSAGES = {
  rate_limited: "The AI provider's rate limit or quota was reached. Try again later.",
  provider_unavailable: "The AI provider is temporarily unavailable. Try again later.",
  provider_rejected_request: "The AI provider rejected the request (check the API key and model).",
  timeout: "The AI provider did not respond in time.",
  blocked: "The AI provider declined to process this document.",
  truncated: "The AI response was cut off before it was complete.",
  invalid_json: "The AI response was not valid JSON.",
  schema_mismatch: "The AI response did not match the expected structure.",
  no_pages: "The document has no extracted page text.",
  unexpected: "Extraction failed unexpectedly.",
} as const;

export type ExtractionErrorCode = keyof typeof EXTRACTION_ERROR_MESSAGES;

/** Thrown by providers. Carries a code only; the original error stays in `cause` for logs. */
export class ExtractionProviderError extends Error {
  override name = "ExtractionProviderError";

  constructor(
    readonly code: ExtractionErrorCode,
    options?: { cause?: unknown },
  ) {
    super(`extraction provider error: ${code}`, options);
  }
}
