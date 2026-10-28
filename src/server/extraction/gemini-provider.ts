import "server-only";
import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type HttpOptions,
} from "@google/genai";
import { ExtractionProviderError, type ExtractionErrorCode } from "./errors";
import { PROMPT_VERSION, SYSTEM_INSTRUCTION, buildUserPrompt } from "./prompt";
import type { ExtractionProvider, ExtractionRequest, ProviderResponse } from "./provider";
import { providerResponseJsonSchema } from "./response-schema";

// Retries cover transient failures only (408, 429, 5xx, the SDK's default set). On the free
// tier a 429 can also mean the daily quota is spent, which no retry fixes, so attempts are
// few and the delay is capped. The timeout applies to each attempt.
const REQUEST_TIMEOUT_MS = 120_000;
const RETRY = { attempts: 3, initialDelay: 2, maxDelay: 20 };

/** Finish reasons that mean the model stopped for policy reasons rather than finishing. */
const BLOCKED_FINISH_REASONS = new Set<FinishReason | undefined>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

export class GeminiExtractionProvider implements ExtractionProvider {
  readonly name = "gemini";
  readonly promptVersion = PROMPT_VERSION;
  private readonly client: GoogleGenAI;

  /** `httpOptions` overrides exist for tests (a stub `fetch`, no retry delays). */
  constructor(
    apiKey: string,
    readonly model: string,
    httpOptions: HttpOptions = {},
  ) {
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: RETRY, ...httpOptions },
    });
  }

  async generate({ pages, signal }: ExtractionRequest): Promise<ProviderResponse> {
    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: buildUserPrompt(pages),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: providerResponseJsonSchema,
          // Extraction is reading, not reasoning; low thinking keeps latency and tokens down.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: signal,
        },
      });
    } catch (error) {
      throw new ExtractionProviderError(classifyError(error), { cause: error });
    }

    if (response.promptFeedback?.blockReason) throw new ExtractionProviderError("blocked");
    const finishReason = response.candidates?.[0]?.finishReason;
    if (BLOCKED_FINISH_REASONS.has(finishReason)) throw new ExtractionProviderError("blocked");
    if (finishReason === FinishReason.MAX_TOKENS) throw new ExtractionProviderError("truncated");

    const text = response.text;
    if (!text) throw new ExtractionProviderError("invalid_json");

    const usage = response.usageMetadata;
    return {
      text,
      usage:
        usage?.promptTokenCount === undefined
          ? null
          : {
              inputTokens: usage.promptTokenCount,
              outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
            },
    };
  }
}

export function classifyError(error: unknown): ExtractionErrorCode {
  if (error instanceof ApiError) {
    if (error.status === 429) return "rate_limited";
    if (error.status === 408 || error.status === 504) return "timeout";
    if (error.status >= 500) return "provider_unavailable";
    if (error.status >= 400) return "provider_rejected_request";
  }
  // fetch rejects with an AbortError when the per-attempt timeout fires.
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "timeout";
  }
  // Network failures (DNS, connection reset) surface as a TypeError from fetch.
  if (error instanceof TypeError) return "provider_unavailable";
  return "unexpected";
}
