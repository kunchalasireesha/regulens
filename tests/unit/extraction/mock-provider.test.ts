import { describe, expect, it } from "vitest";
import type { FieldValue } from "@/lib/schemas/extraction";
import { readPdfText } from "@/server/ingestion/pdf-text";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import { runExtraction } from "@/server/extraction/run";
import { buildApplicationPdf } from "../../../scripts/samples/build";
import { cobaltPeak, harborline, type SampleApplication } from "../../../scripts/samples/fixtures";

async function pagesOf(app: SampleApplication): Promise<string[]> {
  const parsed = await readPdfText(await buildApplicationPdf(app), { maxPages: 30 });
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.pages;
}

async function extract(pages: string[]) {
  const outcome = await runExtraction(new MockExtractionProvider(), pages);
  if (outcome.status !== "succeeded") throw new Error(outcome.errorCode);
  return outcome.result;
}

const valueOf = <T>(field: FieldValue<T>) => (field.status === "found" ? field.value : null);

describe.each([harborline, cobaltPeak])("MockExtractionProvider on $slug", (app) => {
  it("returns the values the sample was rendered from", async () => {
    const { business, licensing, people } = await extract(await pagesOf(app));

    expect(valueOf(business.legalName)).toBe(app.business.legalName);
    expect(valueOf(business.dbaNames)).toEqual(app.business.dbaNames);
    expect(valueOf(business.formationJurisdiction)).toBe(app.business.formationJurisdiction);
    expect(valueOf(business.formationDate)).toBe(app.business.formationDate);
    expect(valueOf(business.registeredAddress)).toEqual(app.business.registeredAddress);
    expect(valueOf(business.principalAddress)).toEqual(app.business.principalAddress);
    expect(valueOf(licensing.licenseType)).toBe(app.licensing.licenseType);
    expect(valueOf(licensing.licenseNumber)).toBe(app.licensing.licenseNumber);
    expect(valueOf(licensing.applicationDate)).toBe(app.licensing.applicationDate);
    expect(valueOf(licensing.expirationDate)).toBe(app.licensing.expirationDate);
    expect(
      people.map((p) => ({
        name: valueOf(p.name),
        title: valueOf(p.title),
        ownershipPercentage: valueOf(p.ownershipPercentage),
        relationship: valueOf(p.relationship),
      })),
    ).toEqual(app.people);
  });

  it("cites quotes that appear verbatim on the cited page", async () => {
    const pages = await pagesOf(app);
    const result = await extract(pages);
    const fields = [
      ...Object.values(result.business),
      ...Object.values(result.licensing),
      ...result.people.flatMap((person) => Object.values(person)),
    ];
    for (const field of fields) {
      if (field.status !== "found") continue;
      expect(field.evidence).toHaveLength(1);
      for (const { page, quote } of field.evidence) expect(pages[page - 1]).toContain(quote);
    }
  });
});

describe("MockExtractionProvider", () => {
  it("marks placeholder values as not found rather than extracting them", async () => {
    const { licensing, people } = await extract(await pagesOf(cobaltPeak));
    expect(licensing.licenseNumber).toEqual({ status: "not_found" });
    expect((await extract(await pagesOf(harborline))).people[1]!.ownershipPercentage).toEqual({
      status: "not_found",
    });
    expect(people).toHaveLength(2);
  });

  it("finds nothing in a document with a different layout", async () => {
    const { business, licensing, people } = await extract(["An unrelated letter.\nRegards"]);
    for (const field of [...Object.values(business), ...Object.values(licensing)]) {
      expect(field).toEqual({ status: "not_found" });
    }
    expect(people).toEqual([]);
  });
});
