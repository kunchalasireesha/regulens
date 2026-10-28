// Splits a page's text into runs so verified evidence can be highlighted in place.
// Evidence offsets point into the original page text (see src/server/evidence), so the
// page is rendered exactly as extracted and the highlights land on the cited words.

export type HighlightRange = { id: string; start: number; end: number };

export type TextSegment = {
  text: string;
  /** Offset of this run in the page text. */
  start: number;
  /** Every range covering this run, in input order; empty for plain text. */
  ids: string[];
};

/**
 * Cuts the text at every range boundary. Overlapping ranges are allowed (two fields can
 * cite the same words): a run covered by both carries both ids. Ranges that are empty or
 * fall outside the text are ignored rather than trusted, since a page's text could in
 * principle change after evidence was verified against it.
 */
export function segmentText(text: string, ranges: readonly HighlightRange[]): TextSegment[] {
  const valid = ranges.filter(
    (range) =>
      Number.isInteger(range.start) &&
      Number.isInteger(range.end) &&
      range.start >= 0 &&
      range.end <= text.length &&
      range.start < range.end,
  );

  const cuts = [...new Set([0, text.length, ...valid.flatMap((range) => [range.start, range.end])])].sort(
    (a, b) => a - b,
  );

  const segments: TextSegment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    const ids = valid.filter((range) => range.start <= start && range.end >= end).map((range) => range.id);
    segments.push({ text: text.slice(start, end), start, ids });
  }
  return segments;
}
