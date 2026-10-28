import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/navigation";

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/documents/123", "/documents/123"],
    ["/documents/123?tab=history", "/documents/123?tab=history"],
    ["/a/../documents", "/documents"],
  ])("keeps the same-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["absolute URL", "https://evil.example/phish"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["tab inside the slashes", "/\t/evil.example"],
    ["javascript URL", "javascript:alert(1)"],
    ["relative path", "documents/123"],
    ["empty string", ""],
    ["the login page itself", "/login?next=/login"],
    ["not a string", null],
  ])("falls back to / for %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/");
  });
});
