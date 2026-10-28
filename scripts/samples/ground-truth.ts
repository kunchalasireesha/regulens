import type { ExtractionResult, FieldValue } from "../../src/lib/schemas/extraction";
import type { SampleApplication } from "./fixtures";

// A fixture as the extraction result a perfect model would return: every value the PDF
// states is `found`, and every placeholder the renderer prints instead of a value
// ("Not yet assigned", "Not applicable", "Not stated") is `not_found`. "None" for DBA
// names is a statement, so it is `found` with an empty list.
//
// Evidence is left empty: scoring compares values, and quotes are checked against the
// page text instead (see src/server/eval/score.ts).

export function groundTruthOf(app: SampleApplication): ExtractionResult {
  const { business, licensing, people } = app;
  return {
    business: {
      legalName: found(business.legalName),
      dbaNames: found(business.dbaNames),
      formationJurisdiction: found(business.formationJurisdiction),
      formationDate: found(business.formationDate),
      registeredAddress: found(business.registeredAddress),
      principalAddress: found(business.principalAddress),
    },
    licensing: {
      licenseType: found(licensing.licenseType),
      licenseNumber: foundOrAbsent(licensing.licenseNumber),
      applicationDate: found(licensing.applicationDate),
      expirationDate: foundOrAbsent(licensing.expirationDate),
    },
    people: people.map((person) => ({
      name: found(person.name),
      title: found(person.title),
      ownershipPercentage: foundOrAbsent(person.ownershipPercentage),
      relationship: found(person.relationship),
    })),
  };
}

function found<T>(value: T): FieldValue<T> {
  return { status: "found", value, evidence: [] };
}

function foundOrAbsent<T>(value: T | null): FieldValue<T> {
  return value === null ? { status: "not_found" } : found(value);
}
