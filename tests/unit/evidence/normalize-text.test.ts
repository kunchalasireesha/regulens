import { describe, expect, it } from "vitest";
import { normalizeForMatch, normalizedTextOf } from "@/server/evidence/normalize-text";

describe("normalizeForMatch", () => {
  it("collapses whitespace, including line breaks, and trims", () => {
    expect(normalizedTextOf("  Registered Office Address: 1209 Orange Street\nWilmington,\t DE  ")).toBe(
      "registered office address: 1209 orange street wilmington, de",
    );
  });

  it("unifies quotes and dashes and drops invisible characters", () => {
    expect(normalizedTextOf("O’Brien “Quick” Pay — MTL–2026")).toBe(
      "o'brien \"quick\" pay - mtl-2026",
    );
    expect(normalizedTextOf("Har­bor​line")).toBe("harborline");
  });

  it("decomposes ligatures, full-width forms, non-breaking spaces, and accents", () => {
    expect(normalizedTextOf("Oﬃce")).toBe("office");
    expect(normalizedTextOf("ＤＥ 19801")).toBe("de 19801");
    expect(normalizedTextOf("José Peña")).toBe("jose pena");
  });

  it("maps every normalized character back to its span in the original text", () => {
    const source = "Date:\n  Oﬃce";
    const { text, starts, ends } = normalizeForMatch(source);
    expect(text).toBe("date: office");
    expect(starts).toHaveLength(text.length);
    // The collapsed space covers the whole whitespace run.
    expect(source.slice(starts[5], ends[5])).toBe("\n  ");
    // The ligature expands to three characters that all map to the one source character.
    expect([7, 8, 9].map((i) => source.slice(starts[i], ends[i]))).toEqual(["ﬃ", "ﬃ", "ﬃ"]);
  });

  it("keeps characters outside the Basic Multilingual Plane intact", () => {
    const { text, starts, ends } = normalizeForMatch("a \u{1D400} b");
    expect(text).toBe("a a b"); // mathematical bold A decomposes to "A"
    expect([starts[2], ends[2]]).toEqual([2, 4]);
  });
});
