import { describe, expect, it } from "vitest";
import { extractionResultSchema, type ExtractionResult } from "@/lib/schemas/extraction";
import { compareField, sameValue, scoreDocument, summarize } from "@/server/eval/score";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import { runExtraction } from "@/server/extraction/run";
import { readPdfText } from "@/server/ingestion/pdf-text";
import { buildApplicationPdf } from "../../../scripts/samples/build";
import { harborline, SAMPLE_APPLICATIONS, type SampleApplication } from "../../../scripts/samples/fixtures";
import { groundTruthOf } from "../../../scripts/samples/ground-truth";

async function pagesOf(app: SampleApplication): Promise<string[]> {
  const parsed = await readPdfText(await buildApplicationPdf(app), { maxPages: 30 });
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.pages;
}

async function mockResult(pages: string[]): Promise<ExtractionResult> {
  const outcome = await runExtraction(new MockExtractionProvider(), pages);
  if (outcome.status !== "succeeded") throw new Error(outcome.errorCode);
  return outcome.result;
}

const found = <T>(value: T, evidence: { page: number; quote: string }[] = []) =>
  ({ status: "found" as const, value, evidence });
const notFound = { status: "not_found" } as const;

const address = { street: "1209 Orange Street", unit: null, city: "Wilmington", state: "DE", postalCode: "19801" };

describe("sameValue", () => {
  it("compares dates and states after normalization", () => {
    expect(sameValue("business.formationDate", "07/19/2019", "2019-07-19")).toBe(true);
    expect(sameValue("business.formationDate", "Sept. 5, 2018", "September 5, 2018")).toBe(true);
    expect(sameValue("business.formationDate", "07/19/2019", "07/20/2019")).toBe(false);
    expect(sameValue("business.formationJurisdiction", "Delaware", "DE")).toBe(true);
    expect(sameValue("business.formationJurisdiction", "Delaware", "Maryland")).toBe(false);
  });

  it("falls back to the text when a value does not normalize", () => {
    expect(sameValue("business.formationDate", "02/30/2020", "02/30/2020")).toBe(true);
    expect(sameValue("business.formationDate", "02/30/2020", "2020-02-30")).toBe(false);
  });

  it("ignores whitespace and compatibility forms but not case or punctuation", () => {
    expect(sameValue("business.legalName", "Harborline  Payments,\nInc.", "Harborline Payments, Inc.")).toBe(true);
    expect(sameValue("business.legalName", "Harborline Payments, Inc.", "Harborline Payments Inc.")).toBe(false);
    expect(sameValue("business.legalName", "Harborline Payments, Inc.", "harborline payments, inc.")).toBe(false);
  });

  it("compares numbers exactly and lists without order", () => {
    expect(sameValue("people[0].ownershipPercentage", 62.5, 62.5)).toBe(true);
    expect(sameValue("people[0].ownershipPercentage", 62.5, 62)).toBe(false);
    expect(sameValue("business.dbaNames", ["A", "B"], ["B", "A"])).toBe(true);
    expect(sameValue("business.dbaNames", ["A", "B"], ["A"])).toBe(false);
    expect(sameValue("business.dbaNames", [], [])).toBe(true);
  });

  it("compares addresses part by part, with the state normalized", () => {
    const path = "business.registeredAddress";
    expect(sameValue(path, address, { ...address, state: "Delaware" })).toBe(true);
    expect(sameValue(path, address, { ...address, unit: "Suite 1" })).toBe(false);
    expect(sameValue(path, address, { ...address, postalCode: "19802" })).toBe(false);
  });
});

describe("compareField", () => {
  const path = "business.legalName";
  it.each([
    [found("X"), found("X"), "correct"],
    [notFound, notFound, "correct_absent"],
    [null, null, "correct_absent"],
    [found("X"), found("Y"), "wrong_value"],
    [found("X"), notFound, "missed"],
    [found("X"), null, "missed"],
    [notFound, found("X"), "invented"],
    [null, found("X"), "invented"],
    [found("X"), { status: "ambiguous" as const, candidates: [{ value: "X", evidence: [] }, { value: "Y", evidence: [] }] }, "ambiguous"],
  ])("%j vs %j is %s", (expected, actual, outcome) => {
    expect(compareField(path, expected, actual)).toBe(outcome);
  });
});

describe("groundTruthOf", () => {
  it.each(SAMPLE_APPLICATIONS)("is a valid extraction result for $slug", (app) => {
    expect(extractionResultSchema.parse(groundTruthOf(app))).toEqual(groundTruthOf(app));
  });

  it("marks placeholders as not found and 'None' as an empty DBA list", () => {
    const truth = groundTruthOf(SAMPLE_APPLICATIONS[1]);
    expect(truth.licensing.licenseNumber).toEqual(notFound);
    expect(truth.business.dbaNames).toEqual(found([]));
    expect(groundTruthOf(harborline).people[1]!.ownershipPercentage).toEqual(notFound);
  });
});

describe("scoreDocument", () => {
  it.each(SAMPLE_APPLICATIONS)("scores the mock on $slug as fully correct", async (app) => {
    const pages = await pagesOf(app);
    const score = scoreDocument(pages, groundTruthOf(app), await mockResult(pages));
    expect(score.fields.filter((f) => f.outcome !== "correct" && f.outcome !== "correct_absent")).toEqual([]);
    expect(score.fields.every((f) => f.evidenceStatus === null || f.evidenceStatus === "verified")).toBe(true);
    expect(score.issues.missed).toEqual([]);
    expect(score.issues.extra).toEqual([]);
    expect(score.issues.matched).toEqual(score.issues.expected);
  });

  it("flags a wrong value whose quote does not contain it", async () => {
    const pages = await pagesOf(harborline);
    const actual = await mockResult(pages);
    const legalName = actual.business.legalName;
    if (legalName.status !== "found") throw new Error("expected legal name");
    actual.business.legalName = { ...legalName, value: "Harborline Payments LLC" };

    const field = scoreDocument(pages, groundTruthOf(harborline), actual).fields.find((f) => f.path === "business.legalName")!;
    expect(field).toMatchObject({ outcome: "wrong_value", evidenceStatus: "verified", flagged: true });
  });

  it("does not flag a wrong value that is supported by real text elsewhere in the document", async () => {
    // Person 1's title replaced with person 3's, citing person 3's line: the quote is real
    // and contains the value, so nothing in the app can tell. This is what the eval is for.
    const pages = await pagesOf(harborline);
    const actual = await mockResult(pages);
    actual.people[0]!.title = found("Director", [{ page: 3, quote: "Title: Director" }]);

    const score = scoreDocument(pages, groundTruthOf(harborline), actual);
    expect(score.fields.find((f) => f.path === "people[0].title")).toMatchObject({
      outcome: "wrong_value",
      evidenceStatus: "verified",
      flagged: false,
    });
    expect(summarize([score]).errors).toEqual({ total: 1, flagged: 0 });
  });

  it("reports missed and extra issues when an extraction error changes what validation sees", async () => {
    const app = SAMPLE_APPLICATIONS[1]; // Cobalt Peak: 150% + 20% ownership
    const pages = await pagesOf(app);
    const actual = await mockResult(pages);
    actual.people[1]!.ownershipPercentage = notFound;

    const { fields, issues } = scoreDocument(pages, groundTruthOf(app), actual);
    expect(fields.find((f) => f.path === "people[1].ownershipPercentage")).toMatchObject({ outcome: "missed", flagged: true });
    expect(issues.missed).toEqual(["ownership.total_exceeds_100 people[0].ownershipPercentage,people[1].ownershipPercentage"]);
    expect(issues.extra).toEqual([
      "ownership.owner_without_percentage people[1].ownershipPercentage,people[1].relationship",
      "ownership.total_exceeds_100 people[0].ownershipPercentage",
    ]);
  });

  it("scores an invented person and a dropped person", async () => {
    const pages = await pagesOf(harborline);
    const truth = groundTruthOf(harborline);

    const extra = await mockResult(pages);
    extra.people.push({ ...extra.people[0]!, ownershipPercentage: notFound });
    const extraFields = scoreDocument(pages, truth, extra).fields.filter((f) => f.path.startsWith("people[3]"));
    expect(extraFields.map((f) => f.outcome)).toEqual(["invented", "invented", "correct_absent", "invented"]);

    const dropped = await mockResult(pages);
    dropped.people.pop();
    const droppedFields = scoreDocument(pages, truth, dropped).fields.filter((f) => f.path.startsWith("people[2]"));
    expect(droppedFields.map((f) => f.outcome)).toEqual(["missed", "missed", "missed", "missed"]);
  });

  it("scores a failed extraction as no result, with every expected issue missed", async () => {
    const app = SAMPLE_APPLICATIONS[1];
    const score = scoreDocument(await pagesOf(app), groundTruthOf(app), null);
    expect(new Set(score.fields.map((f) => f.outcome))).toEqual(new Set(["no_result"]));
    expect(score.issues.missed).toEqual(score.issues.expected);
    expect(score.issues.expected).toHaveLength(5);
  });
});

describe("summarize", () => {
  it("totals outcomes, per-field accuracy, evidence, and issues across documents", async () => {
    const pages = await pagesOf(harborline);
    const truth = groundTruthOf(harborline);
    const wrong = await mockResult(pages);
    wrong.people[0]!.title = found("Director", [{ page: 3, quote: "Title: Director" }]);
    wrong.people[2]!.title = found("Chair", [{ page: 3, quote: "Title: Chair" }]);

    const summary = summarize([
      scoreDocument(pages, truth, await mockResult(pages)),
      scoreDocument(pages, truth, wrong),
      scoreDocument(pages, truth, null),
    ]);

    expect(summary).toMatchObject({ documents: 3, fields: 66, correct: 42 });
    expect(summary.accuracy).toBeCloseTo(42 / 66);
    expect(summary.byOutcome).toMatchObject({ wrong_value: 2, no_result: 22 });
    expect(summary.byField.find((f) => f.key === "people[].title")).toEqual({ key: "people[].title", fields: 9, correct: 4 });
    // "Chair" cites text that is not in the document, so it is caught.
    expect(summary.errors).toEqual({ total: 2, flagged: 1 });
    // 21 found fields per extracted document (22 minus one unstated ownership).
    expect(summary.evidence).toEqual({ cited: 2 * 21, located: 2 * 21 - 1 });
  });
});
