import { describe, expect, it } from "vitest";
import { ConfigError, parseEnv } from "@/server/env";

const DATABASE_URL = "postgres://regulens:regulens@localhost:5432/regulens";

describe("parseEnv", () => {
  it("falls back to mock extraction when no Gemini key is configured", () => {
    expect(parseEnv({ DATABASE_URL }).ai).toEqual({ kind: "mock" });
  });

  it("treats empty values copied from .env.example as unset", () => {
    const env = parseEnv({ DATABASE_URL, AI_PROVIDER: "", GEMINI_API_KEY: "" });
    expect(env.ai).toEqual({ kind: "mock" });
  });

  it("uses Gemini with the default model when a key is present", () => {
    expect(parseEnv({ DATABASE_URL, GEMINI_API_KEY: "test-key" }).ai).toEqual({
      kind: "gemini",
      apiKey: "test-key",
      model: "gemini-3.8-flash",
    });
  });

  it("lets AI_PROVIDER=mock override a configured key", () => {
    const env = parseEnv({ DATABASE_URL, AI_PROVIDER: "mock", GEMINI_API_KEY: "test-key" });
    expect(env.ai).toEqual({ kind: "mock" });
  });

  it("fails when Gemini is requested without a key", () => {
    expect(() => parseEnv({ DATABASE_URL, AI_PROVIDER: "gemini" })).toThrow(ConfigError);
  });

  it("names invalid variables without echoing their values", () => {
    const secret = "sk-should-not-appear";
    try {
      parseEnv({ DATABASE_URL: secret, MAX_PAGES: "-1" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("MAX_PAGES");
      expect(message).not.toContain(secret);
    }
  });

  it("rejects non-Postgres database URLs", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://localhost/db" })).toThrow(ConfigError);
  });

  it("coerces numeric limits", () => {
    const env = parseEnv({ DATABASE_URL, MAX_UPLOAD_BYTES: "2048", MAX_PAGES: "5" });
    expect(env.maxUploadBytes).toBe(2048);
    expect(env.maxPages).toBe(5);
  });
});
