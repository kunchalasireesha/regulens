import { describe, expect, it } from "vitest";
import { failureMessage, isRetryableFailure } from "@/server/pipeline/failures";

describe("isRetryableFailure", () => {
  it.each(["rate_limited", "provider_unavailable", "timeout", "schema_mismatch", "processing_error"])(
    "allows a retry after %s",
    (code) => expect(isRetryableFailure(code)).toBe(true),
  );

  it.each(["no_text_layer", "no_pages", "made_up_code"])("does not allow a retry after %s", (code) =>
    expect(isRetryableFailure(code)).toBe(false),
  );

  it("does not allow a retry without a failure", () => expect(isRetryableFailure(null)).toBe(false));
});

describe("failureMessage", () => {
  it("covers upload, extraction, and pipeline failures", () => {
    expect(failureMessage("no_text_layer")).toMatch(/No selectable text/);
    expect(failureMessage("rate_limited")).toMatch(/rate limit/);
    expect(failureMessage("processing_error")).toBe("Processing failed unexpectedly.");
  });

  it("never shows an unknown code as-is", () => {
    expect(failureMessage("something internal")).toBe("Processing failed unexpectedly.");
    expect(failureMessage(null)).toBeNull();
  });
});
