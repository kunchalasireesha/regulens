import { describe, expect, it } from "vitest";
import {
  parseProviderResponse,
  providerResponseJsonSchema,
  providerResultSchema,
  type ProviderResult,
} from "@/server/extraction/response-schema";

// Keywords Gemini documents for structured output (responseJsonSchema).
const SUPPORTED_KEYWORDS = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum",
  "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf",
  "properties", "additionalProperties", "required", "propertyOrdering",
]);

function keywordsOf(schema: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) schema.forEach((item) => keywordsOf(item, found));
  else if (schema && typeof schema === "object") {
    for (const [key, value] of Object.entries(schema)) {
      found.add(key);
      // Property names are data, not keywords.
      if (key === "properties") Object.values(value as object).forEach((v) => keywordsOf(v, found));
      else keywordsOf(value, found);
    }
  }
  return found;
}

const empty = { evidence: [], candidates: [] };
const notFound = { status: "not_found" as const, value: null, ...empty };
const found = <T>(value: T, quote = "quoted") => ({
  status: "found" as const,
  value,
  evidence: [{ page: 1, quote }],
  candidates: [],
});

function providerResult(): ProviderResult {
  return {
    business: {
      legalName: found("Harborline Payments, Inc."),
      dbaNames: found([]),
      formationJurisdiction: found("DE"),
      formationDate: notFound,
      registeredAddress: notFound,
      principalAddress: found({
        street: "455 Market Street",
        unit: null,
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
        ownershipPercentage: {
          status: "ambiguous",
          value: null,
          evidence: [],
          candidates: [
            { value: 62.5, evidence: [{ page: 3, quote: "62.5%" }] },
            { value: 60, evidence: [{ page: 4, quote: "60%" }] },
          ],
        },
        relationship: notFound,
      },
    ],
  };
}

const parse = (value: unknown) => parseProviderResponse(JSON.stringify(value));

describe("providerResponseJsonSchema", () => {
  it("uses only JSON Schema keywords the provider supports", () => {
    const unsupported = [...keywordsOf(providerResponseJsonSchema)].filter(
      (key) => !SUPPORTED_KEYWORDS.has(key),
    );
    expect(unsupported).toEqual([]);
  });

  it("has no numeric bounds, which can make the provider reject a schema", () => {
    const text = JSON.stringify(providerResponseJsonSchema);
    expect(text).not.toContain("minimum");
    expect(text).not.toContain("maximum");
  });

  it("requires every key, so the model cannot omit a field", () => {
    const business = (providerResponseJsonSchema.properties as Record<string, { required: string[] }>)
      .business!;
    expect(business.required).toEqual(Object.keys(providerResult().business));
  });

  it("describes the same shape the parser accepts", () => {
    expect(providerResultSchema.safeParse(providerResult()).success).toBe(true);
  });
});

describe("parseProviderResponse", () => {
  it("converts flat provider fields into the domain union shape", () => {
    const parsed = parse(providerResult());
    if (!parsed.ok) throw new Error(`unexpected ${parsed.code}: ${parsed.issuePaths}`);

    expect(parsed.result.business.legalName).toEqual({
      status: "found",
      value: "Harborline Payments, Inc.",
      evidence: [{ page: 1, quote: "quoted" }],
    });
    expect(parsed.result.business.formationDate).toEqual({ status: "not_found" });
    expect(parsed.result.business.dbaNames).toMatchObject({ status: "found", value: [] });
    expect(parsed.result.people[0]!.ownershipPercentage).toEqual({
      status: "ambiguous",
      candidates: [
        { value: 62.5, evidence: [{ page: 3, quote: "62.5%" }] },
        { value: 60, evidence: [{ page: 4, quote: "60%" }] },
      ],
    });
  });

  it("rejects text that is not JSON", () => {
    expect(parseProviderResponse("```json\n{}")).toEqual({
      ok: false,
      code: "invalid_json",
      issuePaths: [],
    });
  });

  it("rejects a found field without a value instead of guessing", () => {
    const input = providerResult();
    input.business.legalName = { status: "found", value: null, evidence: [], candidates: [] };
    expect(parse(input)).toEqual({
      ok: false,
      code: "schema_mismatch",
      issuePaths: ["business.legalName.value"],
    });
  });

  it("rejects a not_found field that carries a value", () => {
    const input = providerResult();
    input.licensing.licenseNumber = { ...notFound, value: "MTL-1" };
    expect(parse(input)).toMatchObject({ ok: false, code: "schema_mismatch" });
  });

  it("rejects a not_found field that cites evidence", () => {
    const input = providerResult();
    input.licensing.licenseNumber = { ...notFound, evidence: [{ page: 2, quote: "MTL-1" }] };
    expect(parse(input)).toMatchObject({ ok: false, code: "schema_mismatch" });
  });

  it("rejects an ambiguous field with a single candidate", () => {
    const input = providerResult();
    input.business.formationJurisdiction = {
      status: "ambiguous",
      value: null,
      evidence: [],
      candidates: [{ value: "DE", evidence: [] }],
    };
    expect(parse(input)).toMatchObject({
      ok: false,
      issuePaths: ["business.formationJurisdiction.candidates"],
    });
  });

  it("applies domain rules the provider does not enforce", () => {
    const input = providerResult();
    input.business.legalName = found("   ");
    input.licensing.licenseType = { ...found("MTL"), evidence: [{ page: 0, quote: "MTL" }] };
    expect(parse(input)).toMatchObject({
      ok: false,
      issuePaths: ["business.legalName.value", "licensing.licenseType.evidence.0.page"],
    });
  });

  it("rejects missing sections and unexpected keys", () => {
    const withoutLicensing: Partial<ProviderResult> = providerResult();
    delete withoutLicensing.licensing;
    expect(parse(withoutLicensing)).toMatchObject({ ok: false, code: "schema_mismatch" });
    expect(parse({ ...providerResult(), confidence: 0.9 })).toMatchObject({
      ok: false,
      code: "schema_mismatch",
    });
    expect(parse([])).toMatchObject({ ok: false, code: "schema_mismatch" });
  });

  it("reports field paths without echoing document values", () => {
    const input = providerResult();
    input.people[0]!.name = { ...found("Dana Okafor"), status: "guessed" as "found" };
    const parsed = parse(input);
    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("Dana Okafor");
  });
});
