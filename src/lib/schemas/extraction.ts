import { z } from "zod";

// Domain contract for an extracted licensing application.
//
// These schemas check *shape*, not business rules. An ownership percentage of 150
// or a state code of "XX" parses successfully here on purpose: rejecting it would
// discard what the document actually says. Range and format rules live in
// src/server/validation and are reported as reviewable issues instead.

export const EXTRACTION_SCHEMA_VERSION = "2026-10-24.1";

export const evidenceSchema = z.strictObject({
  /** 1-based page number as cited by the model. Verified against page text later. */
  page: z.number().int().min(1),
  /** Verbatim text the value was read from. */
  quote: z.string().trim().min(1).max(1000),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * A value read from the document, or an explicit statement that it was not found
 * or is ambiguous. Missing information is never represented by an invented value.
 *
 * `found` may carry empty evidence; evidence verification flags such fields for review.
 */
export function fieldValueSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("found"),
      value,
      evidence: z.array(evidenceSchema),
    }),
    z.strictObject({
      status: z.literal("not_found"),
    }),
    z.strictObject({
      status: z.literal("ambiguous"),
      candidates: z
        .array(z.strictObject({ value, evidence: z.array(evidenceSchema) }))
        .min(2, "an ambiguous field needs at least two candidates"),
    }),
  ]);
}
export type FieldValue<T> =
  | { status: "found"; value: T; evidence: Evidence[] }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: { value: T; evidence: Evidence[] }[] };

const text = z.string().trim().min(1);

export const addressSchema = z.strictObject({
  street: text,
  unit: text.nullable(),
  city: text,
  /** As written in the document ("DE", "Delaware"); normalized during validation. */
  state: text,
  postalCode: text,
});
export type Address = z.infer<typeof addressSchema>;

export const personSchema = z.strictObject({
  name: fieldValueSchema(text),
  title: fieldValueSchema(text),
  /** Only when the document states it explicitly. Not range-checked here. */
  ownershipPercentage: fieldValueSchema(z.number()),
  /** e.g. "officer", "director", "beneficial owner", as described in the document. */
  relationship: fieldValueSchema(text),
});
export type Person = z.infer<typeof personSchema>;

export const extractionResultSchema = z.strictObject({
  business: z.strictObject({
    legalName: fieldValueSchema(text),
    /** `found` with an empty list means the document explicitly declares no DBAs. */
    dbaNames: fieldValueSchema(z.array(text)),
    formationJurisdiction: fieldValueSchema(text),
    /** Date strings are kept as written; normalization is deterministic and separate. */
    formationDate: fieldValueSchema(text),
    registeredAddress: fieldValueSchema(addressSchema),
    principalAddress: fieldValueSchema(addressSchema),
  }),
  licensing: z.strictObject({
    licenseType: fieldValueSchema(text),
    licenseNumber: fieldValueSchema(text),
    applicationDate: fieldValueSchema(text),
    expirationDate: fieldValueSchema(text),
  }),
  people: z.array(personSchema),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
