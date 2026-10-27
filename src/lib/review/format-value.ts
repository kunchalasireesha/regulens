// Display text for stored field values. Values arrive as JSON from the database, so
// every branch checks the shape instead of trusting the field path.

/**
 * "people[0].ownershipPercentage", 25 → "25%"; an address → one line; an empty DBA list
 * → "None declared". Returns null when there is no value, so the caller decides how to
 * show absence (not found, ambiguous, awaiting an analyst).
 */
export function formatFieldValue(path: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const key = path.split(".").at(-1);

  if (typeof value === "number") return key === "ownershipPercentage" ? `${value}%` : String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "None declared";
    return value.map((item) => formatFieldValue(path, item) ?? "—").join("; ");
  }
  if (isAddress(value)) {
    const street = value.unit ? `${value.street}, ${value.unit}` : value.street;
    return `${street}, ${value.city}, ${value.state} ${value.postalCode}`;
  }
  return JSON.stringify(value);
}

type AddressLike = { street: string; unit?: string | null; city: string; state: string; postalCode: string };

function isAddress(value: unknown): value is AddressLike {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return ["street", "city", "state", "postalCode"].every((part) => typeof record[part] === "string");
}

/** Deep equality for JSON values, used to show "as written" only when it differs. */
export function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    sameJsonValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
