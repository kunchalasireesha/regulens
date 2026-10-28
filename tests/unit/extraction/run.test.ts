import { describe, expect, it, vi } from "vitest";
import { ExtractionProviderError } from "@/server/extraction/errors";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import type { ExtractionProvider, ProviderResponse } from "@/server/extraction/provider";
import { runExtraction } from "@/server/extraction/run";

const PAGES = ["Legal Name of Applicant: Acme Remit LLC"];

function stubProvider(generate: () => Promise<ProviderResponse>): ExtractionProvider {
  return { name: "stub", model: "gemini-3.8-flash", promptVersion: "test", generate };
}

/** A valid response, produced by the mock so the test does not restate the schema. */
async function validResponseText(): Promise<string> {
  return (await new MockExtractionProvider().generate({ pages: PAGES })).text;
}

describe("runExtraction", () => {
  it("returns the validated result with usage and estimated cost", async () => {
    const text = await validResponseText();
    const provider = stubProvider(async () => ({
      text,
      usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
    }));
    const outcome = await runExtraction(provider, PAGES, {
      now: () => new Date("2026-10-25T00:00:00Z"),
    });

    expect(outcome).toMatchObject({
      status: "succeeded",
      provider: "stub",
      model: "gemini-3.8-flash",
      usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
      estimatedCostUsd: 1.125,
    });
    if (outcome.status !== "succeeded") return;
    expect(outcome.result.business.legalName).toMatchObject({ value: "Acme Remit LLC" });
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("records a classified provider failure", async () => {
    const provider = stubProvider(async () => {
      throw new ExtractionProviderError("rate_limited");
    });
    expect(await runExtraction(provider, PAGES)).toMatchObject({
      status: "failed",
      errorCode: "rate_limited",
      usage: null,
      estimatedCostUsd: null,
    });
  });

  it("maps unclassified errors to 'unexpected' and logs them server-side", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = stubProvider(async () => {
      throw new Error("socket hang up");
    });
    expect(await runExtraction(provider, PAGES)).toMatchObject({
      status: "failed",
      errorCode: "unexpected",
    });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("keeps usage and cost when a paid response fails validation", async () => {
    const provider = stubProvider(async () => ({
      text: '{"business": {}}',
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    const outcome = await runExtraction(provider, PAGES);
    expect(outcome).toMatchObject({
      status: "failed",
      errorCode: "schema_mismatch",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(outcome.estimatedCostUsd).not.toBeNull();
  });

  it("reports invalid JSON", async () => {
    const provider = stubProvider(async () => ({ text: "Sure! Here is the data:", usage: null }));
    expect(await runExtraction(provider, PAGES)).toMatchObject({ errorCode: "invalid_json" });
  });

  it("does not call the provider when there is no page text", async () => {
    const generate = vi.fn<() => Promise<ProviderResponse>>();
    const outcome = await runExtraction(stubProvider(generate), ["", "  \n"]);
    expect(outcome).toMatchObject({ status: "failed", errorCode: "no_pages" });
    expect(generate).not.toHaveBeenCalled();
  });
});
