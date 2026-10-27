// Deterministic normalization of extracted values. The model keeps values as written
// ("07/19/2019", "Delaware"); these functions produce the comparable form
// ("2019-07-19", "DE"), or null when the input is not recognized. A null is reported by
// a validation rule, never guessed around.

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
  // Territories with their own licensing regulators.
  AS: "American Samoa", GU: "Guam", MP: "Northern Mariana Islands", PR: "Puerto Rico",
  VI: "U.S. Virgin Islands",
};

const STATE_CODE_BY_NAME = new Map(
  Object.entries(US_STATES).map(([code, name]) => [simplify(name), code]),
);

/** "DE", "de", "Delaware", "State of Delaware" → "DE". Anything else → null. */
export function normalizeStateCode(input: string): string | null {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && upper in US_STATES) return upper;
  const name = simplify(trimmed).replace(/^(the )?state of /, "");
  return STATE_CODE_BY_NAME.get(name) ?? null;
}

export function stateName(code: string): string | undefined {
  return US_STATES[code];
}

function simplify(text: string): string {
  return text.toLowerCase().replaceAll(".", "").replace(/\s+/g, " ").trim();
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Parses the date formats found on US licensing forms into ISO 8601 ("YYYY-MM-DD"):
 * "2026-08-02", "07/19/2019" or "7-19-2019" (month first, as on US forms), and
 * "September 14, 2026" / "Sept. 14 2026" / "14 September 2026". Two-digit years and
 * impossible dates (February 30) return null rather than a guess.
 */
export function normalizeDate(input: string): string | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return isoDate(+match[1]!, +match[2]!, +match[3]!);

  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (match) return isoDate(+match[3]!, +match[1]!, +match[2]!);

  match = /^([a-z]+)\.? (\d{1,2}),? (\d{4})$/.exec(text);
  if (match) return isoDate(+match[3]!, monthNumber(match[1]!), +match[2]!);

  match = /^(\d{1,2}) ([a-z]+)\.?,? (\d{4})$/.exec(text);
  if (match) return isoDate(+match[3]!, monthNumber(match[2]!), +match[1]!);

  return null;
}

/** Full name or an abbreviation of at least three letters ("Sep", "Sept"); 0 if unknown. */
function monthNumber(word: string): number {
  if (word.length < 3) return 0;
  return MONTHS.findIndex((month) => month.startsWith(word)) + 1;
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    month >= 1 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!valid) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** US ZIP or ZIP+4. */
export function isUsPostalCode(input: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(input.trim());
}
