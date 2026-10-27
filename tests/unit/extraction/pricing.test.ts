import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "@/server/extraction/pricing";

const usage = { inputTokens: 2_000_000, outputTokens: 1_000_000 };

describe("estimateCostUsd", () => {
  it("uses the price in effect on the run date", () => {
    expect(estimateCostUsd("gemini-3.8-flash", usage, new Date("2026-12-31T23:00:00Z"))).toBe(5.25);
    expect(estimateCostUsd("gemini-3.8-flash", usage, new Date("2027-01-01T00:00:00Z"))).toBe(10.5);
  });

  it("rounds to the database's six decimal places", () => {
    const tiny = { inputTokens: 1, outputTokens: 1 };
    expect(estimateCostUsd("gemini-3.8-flash", tiny, new Date("2026-10-25"))).toBe(0.000005);
  });

  it("returns null when the price or usage is unknown", () => {
    expect(estimateCostUsd("mock-form-mtl-1", usage)).toBeNull();
    expect(estimateCostUsd("gemini-3.8-flash", null)).toBeNull();
  });
});
