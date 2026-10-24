import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  extractionResultSchema,
  fieldValueSchema,
  type ExtractionResult,
  type FieldValue,
} from "@/lib/schemas/extraction";

const notFound = { status: "not_found" } as const;
const found = <T>(value: T, page = 1, quote = "quoted text") => ({
  status: "found" as const,
  value,
  evidence: [{ page, quote }],
});

function minimalResult(): ExtractionResult {
  return {
    business: {
      legalName: found("Harborline Payments, Inc.", 1, "Legal Name: Harborline Payments, Inc."),
      dbaNames: found([], 1, "DBA / Trade Names: None"),
      formationJurisdiction: found("DE"),
      formationDate: found("March 3, 2021"),
      registeredAddress: notFound,
      principalAddress: found({
        street: "455 Market Street",
        unit: "Suite 1200",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
      }),
    },
    licensing: {
      licenseType: found("Money Transmitter License"),
      licenseNumber: notFound,
      applicationDate: found("2026-09-14"),
      expirationDate: notFound,
    },
    people: [
      {
        name: found("Dana Okafor"),
        title: found("Chief Executive Officer"),
        ownershipPercentage: found(62.5),
        relationship: found("officer and beneficial owner"),
      },
    ],
  };
}

describe("fieldValueSchema", () => {
  const schema = fieldValueSchema(z.string().min(1));

  it("accepts found, not_found, and ambiguous values", () => {
    expect(schema.safeParse(found("Acme")).success).toBe(true);
    expect(schema.safeParse(notFound).success).toBe(true);
    expect(
      schema.safeParse({
        status: "ambiguous",
        candidates: [
          { value: "Acme LLC", evidence: [{ page: 1, quote: "Acme LLC" }] },
          { value: "Acme Inc.", evidence: [{ page: 4, quote: "Acme Inc." }] },
        ],
      }).success,
    ).toBe(true);
  });

  it("allows a found value with no evidence so verification can flag it", () => {
    expect(schema.safeParse({ status: "found", value: "Acme", evidence: [] }).success).toBe(true);
  });

  it("rejects an ambiguous value with fewer than two candidates", () => {
    const result = schema.safeParse({
      status: "ambiguous",
      candidates: [{ value: "Acme", evidence: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a not_found value that smuggles in a value", () => {
    expect(schema.safeParse({ status: "not_found", value: "guess" }).success).toBe(false);
  });

  it("rejects unknown statuses and missing discriminators", () => {
    expect(schema.safeParse({ status: "inferred", value: "Acme", evidence: [] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ value: "Acme", evidence: [] }).success).toBe(false);
  });

  it("rejects evidence with invalid page numbers or empty quotes", () => {
    expect(schema.safeParse(found("Acme", 0)).success).toBe(false);
    expect(schema.safeParse(found("Acme", 1.5)).success).toBe(false);
    expect(schema.safeParse(found("Acme", 1, "   ")).success).toBe(false);
  });

  it("infers the FieldValue type", () => {
    expectTypeOf<z.infer<typeof schema>>().toEqualTypeOf<FieldValue<string>>();
  });
});

describe("extractionResultSchema", () => {
  it("accepts a complete result with explicit missing values", () => {
    const result = extractionResultSchema.safeParse(minimalResult());
    expect(result.success).toBe(true);
  });

  it("accepts an application that lists no people", () => {
    expect(extractionResultSchema.safeParse({ ...minimalResult(), people: [] }).success).toBe(true);
  });

  it("leaves business rules to validation: out-of-range ownership still parses", () => {
    const input = minimalResult();
    input.people[0]!.ownershipPercentage = found(150);
    expect(extractionResultSchema.safeParse(input).success).toBe(true);
  });

  it("leaves business rules to validation: unrecognized state codes still parse", () => {
    const input = minimalResult();
    input.business.formationJurisdiction = found("XX");
    expect(extractionResultSchema.safeParse(input).success).toBe(true);
  });

  it("rejects a result with a missing section", () => {
    const input: Partial<ExtractionResult> = minimalResult();
    delete input.licensing;
    expect(extractionResultSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a field omitted instead of marked not_found", () => {
    const input = minimalResult() as unknown as { business: Record<string, unknown> };
    delete input.business.formationDate;
    expect(extractionResultSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unexpected keys so schema drift is caught", () => {
    const input = { ...minimalResult(), confidence: 0.9 };
    expect(extractionResultSchema.safeParse(input).success).toBe(false);
  });

  it("rejects wrongly typed values", () => {
    const input = minimalResult() as unknown as { people: { ownershipPercentage: unknown }[] };
    input.people[0]!.ownershipPercentage = found("62.5%");
    expect(extractionResultSchema.safeParse(input).success).toBe(false);
  });

  it("rejects addresses missing required parts", () => {
    const input = minimalResult() as unknown as { business: { principalAddress: unknown } };
    input.business.principalAddress = found({ street: "455 Market Street", city: "San Francisco" });
    expect(extractionResultSchema.safeParse(input).success).toBe(false);
  });
});
