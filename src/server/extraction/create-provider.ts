import "server-only";
import type { AiProviderConfig } from "@/server/env";
import { GeminiExtractionProvider } from "./gemini-provider";
import { MockExtractionProvider } from "./mock-provider";
import type { ExtractionProvider } from "./provider";

export function createExtractionProvider(config: AiProviderConfig): ExtractionProvider {
  switch (config.kind) {
    case "gemini":
      return new GeminiExtractionProvider(config.apiKey, config.model);
    case "mock":
      return new MockExtractionProvider();
  }
}
