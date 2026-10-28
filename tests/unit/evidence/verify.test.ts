import { describe, expect, it } from "vitest";
import {
  indexPages,
  valueAppearsIn,
  verifyFieldEvidence,
  verifyQuote,
} from "@/server/evidence/verify";

const pages = [
  "Part 1. Business Information\nLegal Name of Applicant: Harborline Payments, Inc.\nDBA / Trade Names: None",
  "Part 2. Addresses\nRegistered Office Address: 1209 Orange Street\nWilmington, DE 19801",
  "Control Person 1\nFull Name: Dana Okafor\nOwnership Percentage: 62.5%",
];
const index = indexPages(pages);

describe("verifyQuote", () => {
  it("verifies a verbatim quote on the cited page and records its offsets", () => {
    const quote = "Legal Name of Applicant: Harborline Payments, Inc.";
    const check = verifyQuote(index, { page: 1, quote });
    expect(check).toMatchObject({ verification: "verified", matchedPage: 1 });
    expect(pages[0]!.slice(check.matchStart!, check.matchEnd!)).toBe(quote);
  });

  it("tolerates joined lines, case, and typographic differences", () => {
    const check = verifyQuote(index, {
      page: 2,
      quote: "registered office address: 1209 Orange Street   Wilmington, DE 19801",
    });
    expect(check.verification).toBe("verified");
    // Offsets cover the original text, line break included.
    expect(pages[1]!.slice(check.matchStart!, check.matchEnd!)).toBe(
      "Registered Office Address: 1209 Orange Street\nWilmington, DE 19801",
    );
  });

  it("corrects the page when the quote is on a different page", () => {
    expect(verifyQuote(index, { page: 1, quote: "Full Name: Dana Okafor" })).toMatchObject({
      verification: "page_corrected",
      citedPage: 1,
      matchedPage: 3,
    });
  });

  it("searches every page when the cited page does not exist", () => {
    expect(verifyQuote(index, { page: 9, quote: "Dana Okafor" })).toMatchObject({
      verification: "page_corrected",
      matchedPage: 3,
    });
  });

  it("reports a quote that is not in the document", () => {
    expect(verifyQuote(index, { page: 1, quote: "Legal Name of Applicant: Harborline Payments LLC" })).toEqual({
      candidateIndex: null,
      citedPage: 1,
      quote: "Legal Name of Applicant: Harborline Payments LLC",
      verification: "not_found",
      matchedPage: null,
      matchStart: null,
      matchEnd: null,
    });
  });

  it("does not match a quote with no visible content", () => {
    expect(verifyQuote(index, { page: 1, quote: "​" }).verification).toBe("not_found");
  });
});

describe("verifyFieldEvidence", () => {
  it("has nothing to verify for a field that was not found", () => {
    expect(verifyFieldEvidence(index, { status: "not_found" })).toEqual({
      evidenceStatus: "none",
      checks: [],
      valueSupported: null,
    });
  });

  it("reports a found field with no evidence as none", () => {
    const result = verifyFieldEvidence(index, { status: "found", value: "Dana Okafor", evidence: [] });
    expect(result).toMatchObject({ evidenceStatus: "none", valueSupported: null });
  });

  it("rolls up to the weakest citation", () => {
    const field = (quotes: [number, string][]) =>
      verifyFieldEvidence(index, {
        status: "found",
        value: "Dana Okafor",
        evidence: quotes.map(([page, quote]) => ({ page, quote })),
      }).evidenceStatus;

    expect(field([[3, "Full Name: Dana Okafor"]])).toBe("verified");
    expect(field([[3, "Full Name: Dana Okafor"], [1, "Dana Okafor"]])).toBe("page_corrected");
    expect(field([[3, "Full Name: Dana Okafor"], [3, "Dana Okafor, CEO"]])).toBe("unverified");
  });

  it("flags a real quote that does not contain the value", () => {
    const result = verifyFieldEvidence(index, {
      status: "found",
      value: "Harborline Pay",
      evidence: [{ page: 1, quote: "DBA / Trade Names: None" }],
    });
    expect(result).toMatchObject({ evidenceStatus: "verified", valueSupported: false });
  });

  it("checks each ambiguous candidate against its own evidence", () => {
    const result = verifyFieldEvidence(index, {
      status: "ambiguous",
      candidates: [
        { value: "Dana Okafor", evidence: [{ page: 3, quote: "Full Name: Dana Okafor" }] },
        { value: "Harborline Payments, Inc.", evidence: [{ page: 3, quote: "Full Name: Dana Okafor" }] },
      ],
    });
    expect(result.checks.map((c) => c.candidateIndex)).toEqual([0, 1]);
    expect(result.valueSupported).toBe(false);
  });
});

describe("valueAppearsIn", () => {
  it("compares numbers numerically", () => {
    expect(valueAppearsIn(62.5, ["Ownership Percentage: 62.50%"])).toBe(true);
    expect(valueAppearsIn(1000000, ["Net worth: $1,000,000"])).toBe(true);
    expect(valueAppearsIn(25, ["Ownership Percentage: 62.5%"])).toBe(false);
    // A digit inside a longer number is not a match.
    expect(valueAppearsIn(2, ["Ownership Percentage: 25%"])).toBe(false);
  });

  it("requires every address component", () => {
    const address = { street: "1209 Orange Street", unit: null, city: "Wilmington", state: "DE", postalCode: "19801" };
    expect(valueAppearsIn(address, ["Registered Office Address: 1209 Orange Street", "Wilmington, DE 19801"])).toBe(true);
    expect(valueAppearsIn({ ...address, postalCode: "19802" }, ["1209 Orange Street\nWilmington, DE 19801"])).toBe(false);
  });

  it("has nothing to check for an empty list or no quotes", () => {
    expect(valueAppearsIn([], ["DBA / Trade Names: None"])).toBeNull();
    expect(valueAppearsIn("Dana Okafor", [])).toBeNull();
  });
});
