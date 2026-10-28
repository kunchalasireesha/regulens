import { describe, expect, it } from "vitest";
import { readCorrectionInput } from "@/lib/review/correction-input";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("readCorrectionInput", () => {
  it("reads text and dates as trimmed strings", () => {
    expect(readCorrectionInput("text", form({ value: "  Harborline Payments, Inc. " }))).toBe("Harborline Payments, Inc.");
    expect(readCorrectionInput("date", form({ value: "2026-09-14" }))).toBe("2026-09-14");
    expect(readCorrectionInput("text", form({}))).toBe("");
  });

  it("reads numbers, keeping an empty input distinct from zero", () => {
    expect(readCorrectionInput("number", form({ value: "62.5" }))).toBe(62.5);
    expect(readCorrectionInput("number", form({ value: "0" }))).toBe(0);
    expect(readCorrectionInput("number", form({ value: "" }))).toBeUndefined();
    expect(readCorrectionInput("number", form({ value: "abc" }))).toBeNaN();
  });

  it("reads a list as one entry per non-empty line", () => {
    expect(readCorrectionInput("text_list", form({ value: "Harborline Pay\r\n\n  HLP  \n" }))).toEqual([
      "Harborline Pay",
      "HLP",
    ]);
    expect(readCorrectionInput("text_list", form({ value: "" }))).toEqual([]);
  });

  it("reads an address from its parts, with an empty unit as null", () => {
    expect(
      readCorrectionInput(
        "address",
        form({ street: "455 Market Street", unit: " ", city: "San Francisco", state: "CA", postalCode: "94105" }),
      ),
    ).toEqual({ street: "455 Market Street", unit: null, city: "San Francisco", state: "CA", postalCode: "94105" });
  });
});
