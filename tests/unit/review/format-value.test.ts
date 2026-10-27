import { describe, expect, it } from "vitest";
import { formatFieldValue, sameJsonValue } from "@/lib/review/format-value";

describe("formatFieldValue", () => {
  it("returns null for a missing value so the caller can say why", () => {
    expect(formatFieldValue("business.legalName", null)).toBeNull();
    expect(formatFieldValue("business.legalName", undefined)).toBeNull();
  });

  it("shows ownership as a percentage and other numbers as-is", () => {
    expect(formatFieldValue("people[0].ownershipPercentage", 25)).toBe("25%");
    expect(formatFieldValue("people[0].ownershipPercentage", 12.5)).toBe("12.5%");
  });

  it("joins lists and names an explicitly empty DBA list", () => {
    expect(formatFieldValue("business.dbaNames", ["Harbor Pay", "HL Remit"])).toBe("Harbor Pay; HL Remit");
    expect(formatFieldValue("business.dbaNames", [])).toBe("None declared");
  });

  it("puts an address on one line, with the unit when there is one", () => {
    const address = { street: "1 Main St", unit: null, city: "Dover", state: "DE", postalCode: "19901" };
    expect(formatFieldValue("business.registeredAddress", address)).toBe("1 Main St, Dover, DE 19901");
    expect(formatFieldValue("business.registeredAddress", { ...address, unit: "Suite 4" })).toBe(
      "1 Main St, Suite 4, Dover, DE 19901",
    );
  });

  it("falls back to JSON for a shape it does not recognize", () => {
    expect(formatFieldValue("business.legalName", { unexpected: true })).toBe('{"unexpected":true}');
  });
});

describe("sameJsonValue", () => {
  it("compares JSON values structurally, ignoring key order", () => {
    expect(sameJsonValue({ a: 1, b: [1, "x"] }, { b: [1, "x"], a: 1 })).toBe(true);
    expect(sameJsonValue({ state: "Delaware" }, { state: "DE" })).toBe(false);
    expect(sameJsonValue("07/19/2019", "2019-07-19")).toBe(false);
    expect(sameJsonValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameJsonValue(null, {})).toBe(false);
  });
});
