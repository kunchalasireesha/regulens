import { describe, expect, it } from "vitest";
import { isUsPostalCode, normalizeDate, normalizeStateCode } from "@/server/validation/normalize";

describe("normalizeDate", () => {
  it.each([
    ["2026-08-02", "2026-08-02"],
    ["2026-8-2", "2026-08-02"],
    ["07/19/2019", "2019-07-19"],
    ["7-19-2019", "2019-07-19"],
    ["September 14, 2026", "2026-09-14"],
    ["Sept. 14 2026", "2026-09-14"],
    ["sep 14, 2026", "2026-09-14"],
    ["14 September 2026", "2026-09-14"],
    ["  March   3,  2021 ", "2021-03-03"],
    ["February 29, 2024", "2024-02-29"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });

  it.each([
    "02/30/2026", // no such day
    "February 29, 2025", // not a leap year
    "13/01/2026", // day-first dates are not accepted as month-first
    "07/19/19", // two-digit year
    "Ma 3, 2021", // month abbreviation too short to be unambiguous
    "Smarch 3, 2021",
    "next Tuesday",
    "",
  ])("%s → null", (input) => {
    expect(normalizeDate(input)).toBeNull();
  });
});

describe("normalizeStateCode", () => {
  it.each([
    ["DE", "DE"],
    ["de", "DE"],
    ["Delaware", "DE"],
    ["State of Delaware", "DE"],
    ["new  york", "NY"],
    ["District of Columbia", "DC"],
    ["Puerto Rico", "PR"],
    ["U.S. Virgin Islands", "VI"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeStateCode(input)).toBe(expected);
  });

  it.each(["XX", "Delawar", "Ontario", "Cayman Islands", ""])("%s → null", (input) => {
    expect(normalizeStateCode(input)).toBeNull();
  });
});

describe("isUsPostalCode", () => {
  it("accepts ZIP and ZIP+4 only", () => {
    expect(isUsPostalCode("19801")).toBe(true);
    expect(isUsPostalCode("19801-1234")).toBe(true);
    expect(isUsPostalCode("1980")).toBe(false);
    expect(isUsPostalCode("M5V 2T6")).toBe(false);
  });
});
