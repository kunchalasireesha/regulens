// Text normalization for quote matching.
//
// A model "copying verbatim" still drifts in ways that do not change what the text says:
// it joins wrapped lines with a space, types straight quotes for curly ones, or changes
// case. Both the quote and the page are normalized the same way before searching, so
// those differences do not cause false "not found" results. Anything beyond that (a
// changed word, a reordered phrase) is a real mismatch and is reported as one.
//
// Normalization keeps a map back to the original text, so a match can be stored as
// offsets into the page text the analyst sees, not into the normalized copy.

export type NormalizedText = {
  text: string;
  /** For each character of `text`, where it starts in the original string. */
  starts: number[];
  /** For each character of `text`, where it ends (exclusive) in the original string. */
  ends: number[];
};

const PUNCTUATION: Record<string, string> = {
  "‘": "'", // left single quote
  "’": "'", // right single quote / apostrophe
  "‚": "'",
  "‛": "'",
  "′": "'", // prime
  "“": '"',
  "”": '"',
  "„": '"',
  "″": '"', // double prime
  "‐": "-", // hyphen
  "‑": "-", // non-breaking hyphen
  "‒": "-", // figure dash
  "–": "-", // en dash
  "—": "-", // em dash
  "―": "-",
  "−": "-", // minus sign
};

/** Characters with no visible content that PDFs and models insert or drop freely. */
const INVISIBLE = /[­​-‍⁠﻿]/u;
const COMBINING_MARK = /\p{M}/gu;
const WHITESPACE = /\s/u;

/**
 * Compatibility-decomposes (ligatures, full-width forms, non-breaking spaces), drops
 * accents and invisible characters, unifies quotes and dashes, lowercases, and collapses
 * every run of whitespace to one space, with none at either end.
 */
export function normalizeForMatch(source: string): NormalizedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpaceAt: number | null = null;

  for (let i = 0; i < source.length; ) {
    const char = String.fromCodePoint(source.codePointAt(i)!);
    const end = i + char.length;
    for (const out of fold(char)) {
      if (WHITESPACE.test(out)) {
        if (text.length > 0 && pendingSpaceAt === null) pendingSpaceAt = i;
        continue;
      }
      if (pendingSpaceAt !== null) {
        text += " ";
        starts.push(pendingSpaceAt);
        ends.push(i);
        pendingSpaceAt = null;
      }
      text += out;
      starts.push(i);
      ends.push(end);
    }
    i = end;
  }
  return { text, starts, ends };
}

/** Normalized text only, for comparing two strings rather than locating one in another. */
export function normalizedTextOf(source: string): string {
  return normalizeForMatch(source).text;
}

function fold(char: string): string {
  if (INVISIBLE.test(char)) return "";
  const punctuation = PUNCTUATION[char];
  if (punctuation) return punctuation;
  return char.normalize("NFKD").toLowerCase().replace(COMBINING_MARK, "");
}
