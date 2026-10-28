import { describe, expect, it } from "vitest";
import { compareFieldPaths, fieldGroup, fieldKind, fieldShortLabel } from "@/lib/schemas/field-paths";

describe("compareFieldPaths", () => {
  it("restores listFields order from any permutation", () => {
    const paths = [
      "people[1].name",
      "licensing.expirationDate",
      "people[10].title",
      "business.principalAddress",
      "people[0].relationship",
      "business.legalName",
      "people[2].name",
      "licensing.licenseType",
      "people[0].name",
    ];
    expect([...paths].sort(compareFieldPaths)).toEqual([
      "business.legalName",
      "business.principalAddress",
      "licensing.licenseType",
      "licensing.expirationDate",
      "people[0].name",
      "people[0].relationship",
      "people[1].name",
      "people[2].name",
      "people[10].title",
    ]);
  });
});

describe("fieldGroup and fieldShortLabel", () => {
  it("groups people by index and labels fields within their group", () => {
    expect(fieldGroup("business.legalName")).toEqual({ id: "business", label: "Business" });
    expect(fieldGroup("licensing.licenseNumber")).toEqual({ id: "licensing", label: "Licensing" });
    expect(fieldGroup("people[1].title")).toEqual({ id: "people[1]", label: "Control person 2" });
    expect(fieldShortLabel("people[1].ownershipPercentage")).toBe("Ownership percentage");
    expect(fieldShortLabel("business.dbaNames")).toBe("DBA / trade names");
  });
});

describe("fieldKind", () => {
  it("classifies every field by how its value is edited", () => {
    expect(fieldKind("business.legalName")).toBe("text");
    expect(fieldKind("business.dbaNames")).toBe("text_list");
    expect(fieldKind("business.formationDate")).toBe("date");
    expect(fieldKind("licensing.expirationDate")).toBe("date");
    expect(fieldKind("business.registeredAddress")).toBe("address");
    expect(fieldKind("people[3].ownershipPercentage")).toBe("number");
    expect(fieldKind("people[0].relationship")).toBe("text");
  });
});
