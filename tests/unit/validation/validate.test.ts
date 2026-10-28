import { describe, expect, it } from "vitest";
import type { ExtractionResult, Person } from "@/lib/schemas/extraction";
import { fieldLabel, listFields } from "@/lib/schemas/field-paths";
import { verifyResultEvidence } from "@/server/evidence/verify";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import { runExtraction } from "@/server/extraction/run";
import { readPdfText } from "@/server/ingestion/pdf-text";
import { validateExtraction } from "@/server/validation/validate";
import { buildApplicationPdf } from "../../../scripts/samples/build";
import { cobaltPeak, harborline, type SampleApplication } from "../../../scripts/samples/fixtures";

const notFound = { status: "not_found" } as const;
const found = <T>(value: T) => ({ status: "found" as const, value, evidence: [] });

function person(overrides: Partial<Person> = {}): Person {
  return {
    name: found("Dana Okafor"),
    title: found("Chief Executive Officer"),
    ownershipPercentage: found(62.5),
    relationship: found("Officer, Beneficial Owner"),
    ...overrides,
  };
}

/** A clean application; each test changes only what its rule looks at. */
function application(overrides: {
  business?: Partial<ExtractionResult["business"]>;
  licensing?: Partial<ExtractionResult["licensing"]>;
  people?: Person[];
} = {}): ExtractionResult {
  return {
    business: {
      legalName: found("Harborline Payments, Inc."),
      dbaNames: found([]),
      formationJurisdiction: found("DE"),
      formationDate: found("March 3, 2021"),
      registeredAddress: found({ street: "1209 Orange Street", unit: null, city: "Wilmington", state: "DE", postalCode: "19801" }),
      principalAddress: found({ street: "455 Market Street", unit: "Suite 1200", city: "San Francisco", state: "CA", postalCode: "94105" }),
      ...overrides.business,
    },
    licensing: {
      licenseType: found("Money Transmitter License"),
      licenseNumber: found("MTL-2026-004417"),
      applicationDate: found("September 14, 2026"),
      expirationDate: found("December 31, 2027"),
      ...overrides.licensing,
    },
    people: overrides.people ?? [person()],
  };
}

const ruleIds = (result: ExtractionResult) => validateExtraction(result).issues.map((i) => i.ruleId);

describe("validateExtraction", () => {
  it("reports nothing for a clean application and normalizes its values", () => {
    const report = validateExtraction(application());
    expect(report.issues).toEqual([]);
    expect(report.fields.get("business.formationDate")).toEqual({ normalizedValue: "2021-03-03", validationStatus: "valid" });
    expect(report.fields.get("licensing.licenseType")).toEqual({ normalizedValue: null, validationStatus: "valid" });
    expect([...report.fields.keys()]).toEqual(listFields(application()).map((f) => f.path));
  });

  it("requires core fields", () => {
    const report = validateExtraction(application({ business: { legalName: notFound }, licensing: { applicationDate: notFound } }));
    expect(report.issues.map((i) => [i.ruleId, i.severity, i.fieldPaths])).toEqual([
      ["required.missing", "critical", ["business.legalName"]],
      ["required.missing", "critical", ["licensing.applicationDate"]],
    ]);
    expect(report.fields.get("business.legalName")?.validationStatus).toBe("error");
  });

  it("asks the analyst to resolve ambiguous fields", () => {
    const ambiguous = {
      status: "ambiguous" as const,
      candidates: [{ value: "Harborline Payments, Inc.", evidence: [] }, { value: "Harborline Pay LLC", evidence: [] }],
    };
    expect(ruleIds(application({ business: { legalName: ambiguous } }))).toEqual(["field.ambiguous"]);
  });

  it("compares normalized dates, whatever format they were written in", () => {
    expect(ruleIds(application({ licensing: { applicationDate: found("2026-08-02"), expirationDate: found("06/30/2026") } }))).toEqual([
      "date.expiration_not_after_application",
    ]);
    expect(ruleIds(application({ licensing: { expirationDate: found("2026-09-14") } }))).toEqual([
      "date.expiration_not_after_application",
    ]);
    expect(ruleIds(application({ business: { formationDate: found("10/01/2026") } }))).toEqual([
      "date.formation_after_application",
    ]);
  });

  it("does not compare a date it cannot parse", () => {
    const report = validateExtraction(application({ licensing: { expirationDate: found("end of next year") } }));
    expect(report.issues.map((i) => [i.ruleId, i.severity])).toEqual([["date.unparseable", "warning"]]);
    expect(report.fields.get("licensing.expirationDate")).toEqual({ normalizedValue: null, validationStatus: "warning" });
  });

  it("checks address states and postal codes", () => {
    const report = validateExtraction(
      application({
        business: {
          principalAddress: found({ street: "2100 Ross Avenue", unit: null, city: "Dallas", state: "XX", postalCode: "752" }),
        },
      }),
    );
    expect(report.issues.map((i) => [i.ruleId, i.severity])).toEqual([
      ["address.invalid_state", "critical"],
      ["address.invalid_postal_code", "warning"],
    ]);
    expect(report.fields.get("business.principalAddress")).toEqual({ normalizedValue: null, validationStatus: "error" });
  });

  it("normalizes the jurisdiction and compares it with the registered office", () => {
    expect(ruleIds(application({ business: { formationJurisdiction: found("Delaware") } }))).toEqual([]);
    expect(ruleIds(application({ business: { formationJurisdiction: found("Nevada") } }))).toEqual([
      "jurisdiction.registered_office_mismatch",
    ]);
    expect(ruleIds(application({ business: { formationJurisdiction: found("Cayman Islands") } }))).toEqual([
      "jurisdiction.unrecognized",
    ]);
  });

  it("checks individual and total ownership", () => {
    expect(ruleIds(application({ people: [person({ ownershipPercentage: found(-5) })] }))).toEqual(["ownership.out_of_range"]);
    expect(ruleIds(application({ people: [person({ ownershipPercentage: found(0) })] }))).toEqual([]);

    const report = validateExtraction(
      application({ people: [person(), person({ name: found("Priya Raman"), ownershipPercentage: found(40) })] }),
    );
    expect(report.issues).toEqual([
      {
        ruleId: "ownership.total_exceeds_100",
        severity: "critical",
        fieldPaths: ["people[0].ownershipPercentage", "people[1].ownershipPercentage"],
        message: "Stated ownership adds up to 102.5%, more than 100%.",
      },
    ]);
  });

  it("allows decimal ownership that sums to exactly 100", () => {
    const thirds = [33.33, 33.33, 33.34].map((value, i) =>
      person({ name: found(`Owner ${i + 1}`), ownershipPercentage: found(value) }),
    );
    expect(ruleIds(application({ people: thirds }))).toEqual([]);
  });

  it("checks control persons", () => {
    expect(ruleIds(application({ people: [] }))).toEqual(["people.none_listed"]);
    expect(ruleIds(application({ people: [person({ name: notFound })] }))).toEqual(["person.name_missing"]);
    expect(ruleIds(application({ people: [person({ ownershipPercentage: notFound })] }))).toEqual([
      "ownership.owner_without_percentage",
    ]);
    expect(
      ruleIds(application({ people: [person({ ownershipPercentage: notFound, relationship: found("Officer") })] })),
    ).toEqual([]);
    expect(
      ruleIds(application({ people: [person({ ownershipPercentage: found(10) }), person({ name: found("DANA  OKAFOR"), ownershipPercentage: found(10) })] })),
    ).toEqual(["people.duplicate_name"]);
  });

  it("notes an unassigned license number without blocking", () => {
    const report = validateExtraction(application({ licensing: { licenseNumber: notFound } }));
    expect(report.issues.map((i) => [i.ruleId, i.severity])).toEqual([["license.number_not_assigned", "info"]]);
    expect(report.fields.get("licensing.licenseNumber")?.validationStatus).toBe("valid");
  });

  it("turns evidence problems into issues when evidence results are given", () => {
    const evidence = new Map([
      ["business.legalName", { evidenceStatus: "none" as const, valueSupported: null }],
      ["business.formationDate", { evidenceStatus: "unverified" as const, valueSupported: true }],
      ["licensing.licenseType", { evidenceStatus: "verified" as const, valueSupported: false }],
      ["licensing.licenseNumber", { evidenceStatus: "page_corrected" as const, valueSupported: true }],
    ]);
    const { issues } = validateExtraction(application(), evidence);
    expect(issues.map((i) => [i.ruleId, i.fieldPaths[0]])).toEqual([
      ["evidence.missing", "business.legalName"],
      ["evidence.unverified", "business.formationDate"],
      ["evidence.value_mismatch", "licensing.licenseType"],
    ]);
    // Without evidence results (e.g. analyst-entered values) there is nothing to check.
    expect(validateExtraction(application()).issues).toEqual([]);
  });
});

describe("fieldLabel", () => {
  it("names fields for analysts", () => {
    expect(fieldLabel("business.legalName")).toBe("Legal name");
    expect(fieldLabel("people[1].ownershipPercentage")).toBe("Control person 2 ownership percentage");
  });
});

async function assess(app: SampleApplication) {
  const parsed = await readPdfText(await buildApplicationPdf(app), { maxPages: 30 });
  if (!parsed.ok) throw new Error(parsed.code);
  const outcome = await runExtraction(new MockExtractionProvider(), parsed.pages);
  if (outcome.status !== "succeeded") throw new Error(outcome.errorCode);
  const evidence = verifyResultEvidence(parsed.pages, outcome.result);
  return { evidence, report: validateExtraction(outcome.result, evidence) };
}

describe("sample applications, end to end with the mock provider", () => {
  it("harborline-payments verifies every citation and validates cleanly", async () => {
    const { evidence, report } = await assess(harborline);
    expect(new Set([...evidence.values()].map((e) => e.evidenceStatus))).toEqual(new Set(["verified", "none"]));
    expect(report.issues).toEqual([]);
  });

  it("cobalt-peak-remit reports each deliberate problem", async () => {
    const { report } = await assess(cobaltPeak);
    expect(report.issues.map((i) => [i.ruleId, i.severity, i.fieldPaths])).toEqual([
      ["date.expiration_not_after_application", "critical", ["licensing.expirationDate", "licensing.applicationDate"]],
      ["address.invalid_state", "critical", ["business.principalAddress"]],
      ["ownership.out_of_range", "critical", ["people[0].ownershipPercentage"]],
      ["ownership.total_exceeds_100", "critical", ["people[0].ownershipPercentage", "people[1].ownershipPercentage"]],
      ["license.number_not_assigned", "info", ["licensing.licenseNumber"]],
    ]);
    // Mixed date formats and a spelled-out jurisdiction are normalized, not flagged.
    expect(report.fields.get("business.formationDate")?.normalizedValue).toBe("2019-07-19");
    expect(report.fields.get("licensing.applicationDate")?.normalizedValue).toBe("2026-08-02");
    expect(report.fields.get("business.formationJurisdiction")?.normalizedValue).toBe("DE");
  });
});
