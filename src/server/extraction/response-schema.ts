import { z } from "zod";
import { extractionResultSchema, type ExtractionResult } from "@/lib/schemas/extraction";

// The schema the model is asked to fill, and the conversion back to the domain contract.
//
// The domain schema (src/lib/schemas/extraction.ts) is a discriminated union per field.
// Gemini's structured output supports only a subset of JSON Schema (no `const`, which
// literal discriminators compile to) and does not enforce keywords such as `minLength`.
// So the model fills a flat shape where every key is always present, and the response is
// converted and re-validated with the strict domain schema. Anything the flat shape allows
// but the domain does not (a not_found field with a value, one ambiguous candidate) is
// rejected there, not silently repaired.

// Page numbers are plain numbers: `.int()` would emit safe-integer bounds, and wide
// numeric bounds are a documented cause of schema rejection. The domain schema checks them.
const providerEvidence = z.object({
  page: z.number().describe("1-based page number, from the <page number=\"…\"> tag"),
  quote: z.string().describe("Text copied verbatim from that page"),
});

function providerField<T extends z.ZodType>(value: T) {
  return z.object({
    status: z.enum(["found", "not_found", "ambiguous"]),
    value: value.nullable().describe("The value when status is found; otherwise null"),
    evidence: z.array(providerEvidence).describe("Supports value; empty unless status is found"),
    candidates: z
      .array(z.object({ value, evidence: z.array(providerEvidence) }))
      .describe("Two or more conflicting values when status is ambiguous; otherwise empty"),
  });
}

const providerText = z.string();

const providerAddress = z.object({
  street: providerText,
  unit: providerText.nullable(),
  city: providerText,
  state: providerText.describe("As written in the document"),
  postalCode: providerText,
});

const providerPerson = z.object({
  name: providerField(providerText),
  title: providerField(providerText),
  ownershipPercentage: providerField(
    z.number().describe("Percentage as a number, e.g. 62.5 for 62.5%"),
  ),
  relationship: providerField(providerText),
});

export const providerResultSchema = z.object({
  business: z.object({
    legalName: providerField(providerText),
    dbaNames: providerField(
      z.array(providerText).describe("Empty list when the document says there are none"),
    ),
    formationJurisdiction: providerField(providerText),
    formationDate: providerField(providerText.describe("As written in the document")),
    registeredAddress: providerField(providerAddress),
    principalAddress: providerField(providerAddress),
  }),
  licensing: z.object({
    licenseType: providerField(providerText),
    licenseNumber: providerField(providerText),
    applicationDate: providerField(providerText.describe("As written in the document")),
    expirationDate: providerField(providerText.describe("As written in the document")),
  }),
  people: z.array(providerPerson),
});
export type ProviderResult = z.infer<typeof providerResultSchema>;
export type ProviderField<T> = {
  status: "found" | "not_found" | "ambiguous";
  value: T | null;
  evidence: { page: number; quote: string }[];
  candidates: { value: T; evidence: { page: number; quote: string }[] }[];
};

/** JSON Schema sent to the provider as the required response format. */
export const providerResponseJsonSchema: Record<string, unknown> = (() => {
  const schema: Record<string, unknown> = z.toJSONSchema(providerResultSchema, {
    target: "draft-2020-12",
  });
  // A dialect URI, not a schema keyword; not in the provider's supported list.
  delete schema.$schema;
  return schema;
})();

export type ParseResponseResult =
  | { ok: true; result: ExtractionResult }
  | { ok: false; code: "invalid_json" | "schema_mismatch"; issuePaths: string[] };

/**
 * Parses provider output text into a domain ExtractionResult. Returns the paths of
 * failing fields (never their values) so failures can be diagnosed without logging
 * document content.
 */
export function parseProviderResponse(text: string): ParseResponseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: "invalid_json", issuePaths: [] };
  }
  const result = extractionResultSchema.safeParse(toDomainShape(json));
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join(".") || "(root)");
    return { ok: false, code: "schema_mismatch", issuePaths: [...new Set(paths)] };
  }
  return { ok: true, result: result.data };
}

/**
 * Converts the flat provider shape to the domain union shape. Keys that do not belong
 * to a field's status are kept only when they carry something (a non-null value, a
 * non-empty list), so contradictions reach the strict domain schema and fail there.
 * Input that is not shaped like a provider result is passed through unchanged for the
 * same reason.
 */
function toDomainShape(json: unknown): unknown {
  if (!isRecord(json)) return json;
  const { business, licensing, people } = json;
  return {
    ...json,
    business: mapFields(business),
    licensing: mapFields(licensing),
    people: Array.isArray(people) ? people.map(mapFields) : people,
  };
}

function mapFields(section: unknown): unknown {
  if (!isRecord(section)) return section;
  return Object.fromEntries(
    Object.entries(section).map(([key, field]) => [key, unflattenField(field)]),
  );
}

function unflattenField(field: unknown): unknown {
  if (!isRecord(field) || typeof field.status !== "string") return field;
  const { status, value, evidence, candidates, ...rest } = field;
  return {
    ...rest,
    status,
    ...(value !== null && value !== undefined && { value }),
    ...((status === "found" || hasContent(evidence)) && { evidence }),
    ...((status === "ambiguous" || hasContent(candidates)) && { candidates }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Anything except undefined or an empty list; malformed values count, so they fail validation. */
function hasContent(value: unknown): boolean {
  return value !== undefined && (!Array.isArray(value) || value.length > 0);
}
