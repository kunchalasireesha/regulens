// The boundary between ReguLens and an AI model. A provider turns page text into raw
// response text in the shape of providerResponseJsonSchema; it does not parse or trust
// that text. Parsing and validation happen once, in runExtraction, for every provider.

export type ExtractionRequest = {
  /** Text per page; index 0 is page 1. */
  pages: string[];
  signal?: AbortSignal;
};

export type TokenUsage = {
  inputTokens: number;
  /** Includes thinking tokens, which are billed as output. */
  outputTokens: number;
};

export type ProviderResponse = {
  text: string;
  /** null when the provider did not report usage. */
  usage: TokenUsage | null;
};

export interface ExtractionProvider {
  /** Stored on extraction_runs.provider, e.g. "gemini" or "mock". */
  readonly name: string;
  readonly model: string;
  /** Stored on extraction_runs.prompt_version; providers that use no prompt say so. */
  readonly promptVersion: string;
  /** Throws ExtractionProviderError for failures it can classify. */
  generate(request: ExtractionRequest): Promise<ProviderResponse>;
}
