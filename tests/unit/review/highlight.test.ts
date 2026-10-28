import { describe, expect, it } from "vitest";
import { segmentText } from "@/lib/review/highlight";

const join = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

describe("segmentText", () => {
  it("returns the whole text as one plain run when there are no ranges", () => {
    expect(segmentText("Legal name: Harborline", [])).toEqual([
      { text: "Legal name: Harborline", start: 0, ids: [] },
    ]);
  });

  it("cuts out a highlighted range and keeps the text around it", () => {
    const segments = segmentText("Legal name: Harborline LLC", [{ id: "a", start: 12, end: 26 }]);
    expect(segments).toEqual([
      { text: "Legal name: ", start: 0, ids: [] },
      { text: "Harborline LLC", start: 12, ids: ["a"] },
    ]);
  });

  it("splits overlapping ranges so the shared words carry both ids", () => {
    //            0123456789
    const text = "abcdefghij";
    const segments = segmentText(text, [
      { id: "a", start: 1, end: 6 },
      { id: "b", start: 4, end: 9 },
    ]);
    expect(segments).toEqual([
      { text: "a", start: 0, ids: [] },
      { text: "bcd", start: 1, ids: ["a"] },
      { text: "ef", start: 4, ids: ["a", "b"] },
      { text: "ghi", start: 6, ids: ["b"] },
      { text: "j", start: 9, ids: [] },
    ]);
    expect(join(segments)).toBe(text);
  });

  it("handles a range nested inside another and identical ranges", () => {
    const segments = segmentText("0123456789", [
      { id: "outer", start: 0, end: 10 },
      { id: "inner", start: 3, end: 5 },
      { id: "twin", start: 3, end: 5 },
    ]);
    expect(segments.map((s) => [s.text, s.ids])).toEqual([
      ["012", ["outer"]],
      ["34", ["outer", "inner", "twin"]],
      ["56789", ["outer"]],
    ]);
  });

  it("ignores empty, inverted, fractional, and out-of-bounds ranges", () => {
    const text = "short";
    const segments = segmentText(text, [
      { id: "empty", start: 2, end: 2 },
      { id: "inverted", start: 4, end: 1 },
      { id: "negative", start: -1, end: 2 },
      { id: "past-end", start: 3, end: 99 },
      { id: "fraction", start: 0.5, end: 2 },
    ]);
    expect(segments).toEqual([{ text, start: 0, ids: [] }]);
  });

  it("returns nothing for empty text", () => {
    expect(segmentText("", [])).toEqual([]);
  });
});
