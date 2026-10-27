import type { ExtractionResult } from "@/lib/schemas/extraction";
import { ExtractionProviderError, type ExtractionErrorCode } from "./errors";
import { estimateCostUsd } from "./pricing";
import type { ExtractionProvider, TokenUsage } from "./provider";
import { parseProviderResponse } from "./response-schema";

export type ExtractionOutcome = {
  provider: string;
  model: string;
  latencyMs: number;
  usage: TokenUsage | null;
  estimatedCostUsd: number | null;
} & (
  | { status: "succeeded"; result: ExtractionResult }
  | {
      status: "failed";
      errorCode: ExtractionErrorCode;
      /** Paths of fields that failed validation (schema_mismatch only). Never values. */
      issuePaths: string[];
    }
);

/**
 * Calls a provider and turns its response into a validated ExtractionResult, or a
 * classified failure. Never throws for provider or response problems, so the caller
 * can always record the attempt. No database access: also used by `pnpm extract`.
 */
export async function runExtraction(
  provider: ExtractionProvider,
  pages: string[],
  options: { signal?: AbortSignal; now?: () => Date } = {},
): Promise<ExtractionOutcome> {
  const base = { provider: provider.name, model: provider.model };
  if (pages.every((page) => page.trim() === "")) {
    return failed(base, 0, null, "no_pages");
  }

  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  let response;
  try {
    response = await provider.generate({ pages, signal: options.signal });
  } catch (error) {
    if (!(error instanceof ExtractionProviderError)) {
      // Unclassified: keep the details server-side only.
      console.error("extraction provider failed", error);
    }
    const code = error instanceof ExtractionProviderError ? error.code : "unexpected";
    return failed(base, elapsed(), null, code);
  }

  const latencyMs = elapsed();
  const usage = response.usage;
  const estimatedCostUsd = estimateCostUsd(provider.model, usage, options.now?.());
  const parsed = parseProviderResponse(response.text);
  if (!parsed.ok) {
    return { ...base, latencyMs, usage, estimatedCostUsd, status: "failed", errorCode: parsed.code, issuePaths: parsed.issuePaths };
  }
  return { ...base, latencyMs, usage, estimatedCostUsd, status: "succeeded", result: parsed.result };
}

function failed(
  base: { provider: string; model: string },
  latencyMs: number,
  usage: TokenUsage | null,
  errorCode: ExtractionErrorCode,
): ExtractionOutcome {
  return { ...base, latencyMs, usage, estimatedCostUsd: null, status: "failed", errorCode, issuePaths: [] };
}
