import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { ExtractionProviderError } from "@/server/extraction/errors";
import { GeminiExtractionProvider, classifyError } from "@/server/extraction/gemini-provider";
import { PROMPT_VERSION, SYSTEM_INSTRUCTION } from "@/server/extraction/prompt";
import { providerResponseJsonSchema } from "@/server/extraction/response-schema";

// The SDK is exercised for real; only the network is replaced by a stub fetch.

type Captured = { url: string; body: Record<string, unknown> };

function providerWith(respond: () => Response) {
  const calls: Captured[] = [];
  const fetchStub = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return respond();
  };
  const provider = new GeminiExtractionProvider("test-key", "gemini-3.8-flash", {
    fetch: fetchStub as typeof fetch,
    retryOptions: { attempts: 1 },
  });
  return { provider, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const answer = (text: string, finishReason = "STOP", usageMetadata?: object) =>
  json({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }],
    usageMetadata,
  });

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ExtractionProviderError);
  return (error as ExtractionProviderError).code;
}

describe("GeminiExtractionProvider", () => {
  it("sends the prompt, page-tagged text, and response schema", async () => {
    const { provider, calls } = providerWith(() => answer("{}"));
    await provider.generate({ pages: ["first page", "second page"] });

    expect(provider.promptVersion).toBe(PROMPT_VERSION);
    expect(calls).toHaveLength(1);
    const { url, body } = calls[0]!;
    expect(url).toContain("models/gemini-3.8-flash:generateContent");
    expect(JSON.stringify(body.systemInstruction)).toContain(JSON.stringify(SYSTEM_INSTRUCTION).slice(1, 60));
    const prompt = JSON.stringify(body.contents);
    expect(prompt).toContain('<page number=\\"1\\">\\nfirst page');
    expect(prompt).toContain('<page number=\\"2\\">\\nsecond page');
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: providerResponseJsonSchema,
    });
  });

  it("returns the response text and counts thinking tokens as output", async () => {
    const { provider } = providerWith(() =>
      answer('{"ok":true}', "STOP", {
        promptTokenCount: 1200,
        candidatesTokenCount: 300,
        thoughtsTokenCount: 50,
      }),
    );
    expect(await provider.generate({ pages: ["text"] })).toEqual({
      text: '{"ok":true}',
      usage: { inputTokens: 1200, outputTokens: 350 },
    });
  });

  it("reports missing usage as null rather than zero", async () => {
    const { provider } = providerWith(() => answer("{}"));
    expect((await provider.generate({ pages: ["text"] })).usage).toBeNull();
  });

  it("treats a response cut off at the token limit as truncated", async () => {
    const { provider } = providerWith(() => answer('{"business": {', "MAX_TOKENS"));
    expect(await codeOf(provider.generate({ pages: ["text"] }))).toBe("truncated");
  });

  it("treats safety stops and blocked prompts as blocked", async () => {
    const stopped = providerWith(() => answer("", "SAFETY")).provider;
    expect(await codeOf(stopped.generate({ pages: ["text"] }))).toBe("blocked");

    const blocked = providerWith(() =>
      json({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }),
    ).provider;
    expect(await codeOf(blocked.generate({ pages: ["text"] }))).toBe("blocked");
  });

  it("classifies HTTP errors from the API", async () => {
    const error = (status: number) => json({ error: { code: status, message: "x" } }, status);
    for (const [status, code] of [
      [429, "rate_limited"],
      [503, "provider_unavailable"],
      [400, "provider_rejected_request"],
      [403, "provider_rejected_request"],
    ] as const) {
      const { provider } = providerWith(() => error(status));
      expect(await codeOf(provider.generate({ pages: ["text"] }))).toBe(code);
    }
  });
});

describe("classifyError", () => {
  it("classifies timeouts and network failures", () => {
    expect(classifyError(new ApiError({ message: "x", status: 504 }))).toBe("timeout");
    expect(classifyError(new DOMException("aborted", "AbortError"))).toBe("timeout");
    expect(classifyError(new TypeError("fetch failed"))).toBe("provider_unavailable");
    expect(classifyError("something else")).toBe("unexpected");
  });
});
