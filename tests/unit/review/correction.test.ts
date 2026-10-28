import { describe, expect, it } from "vitest";
import { prepareCorrection } from "@/server/review/correction";

const address = { street: "455 Market Street", unit: null, city: "San Francisco", state: "California", postalCode: "94105" };

describe("prepareCorrection", () => {
  it("stores values in the same normalized form as extracted ones", () => {
    expect(prepareCorrection("business.formationDate", "March 3, 2021")).toEqual({ ok: true, value: "2021-03-03" });
    expect(prepareCorrection("business.formationJurisdiction", "Delaware")).toEqual({ ok: true, value: "DE" });
    expect(prepareCorrection("business.principalAddress", address)).toEqual({
      ok: true,
      value: { ...address, state: "CA" },
    });
    expect(prepareCorrection("business.legalName", "  Harborline Payments, Inc. ")).toEqual({
      ok: true,
      value: "Harborline Payments, Inc.",
    });
  });

  it("accepts null as 'not stated in the document'", () => {
    expect(prepareCorrection("licensing.licenseNumber", null)).toEqual({ ok: true, value: null });
  });

  it("rejects values without the field's shape", () => {
    expect(prepareCorrection("business.legalName", "")).toEqual({ ok: false });
    expect(prepareCorrection("people[0].ownershipPercentage", undefined)).toEqual({ ok: false });
    expect(prepareCorrection("people[0].ownershipPercentage", Number.NaN)).toEqual({ ok: false });
    expect(prepareCorrection("people[0].ownershipPercentage", "25")).toEqual({ ok: false });
    expect(prepareCorrection("business.dbaNames", ["Harborline Pay", ""])).toEqual({ ok: false });
    expect(prepareCorrection("business.registeredAddress", { ...address, city: "" })).toEqual({ ok: false });
    expect(prepareCorrection("business.registeredAddress", { ...address, country: "US" })).toEqual({ ok: false });
  });

  it("rejects dates that do not parse", () => {
    expect(prepareCorrection("licensing.applicationDate", "2026-02-30")).toEqual({ ok: false });
    expect(prepareCorrection("licensing.applicationDate", "soon")).toEqual({ ok: false });
  });

  it("leaves business rules to validation", () => {
    // Out of range and an unknown state are reported as issues, not refused here.
    expect(prepareCorrection("people[0].ownershipPercentage", 150)).toEqual({ ok: true, value: 150 });
    expect(prepareCorrection("business.principalAddress", { ...address, state: "XX" })).toEqual({
      ok: true,
      value: { ...address, state: "XX" },
    });
  });
});
