import type { ExtractionResult, FieldValue } from "./extraction";

// The unit of review is a field, addressed by a dotted path into ExtractionResult:
// "business.legalName", "licensing.applicationDate", "people[0].ownershipPercentage".
// People are indexed from 0, in document order. An address is one field: it is cited,
// verified, and corrected as a whole.

export type FieldEntry = { path: string; field: FieldValue<unknown> };

/** Every field of a result, in a stable order: business, licensing, then each person. */
export function listFields(result: ExtractionResult): FieldEntry[] {
  return [
    ...section("business", result.business),
    ...section("licensing", result.licensing),
    ...result.people.flatMap((person, i) => section(`people[${i}]`, person)),
  ];
}

const LABELS: Record<string, string> = {
  legalName: "Legal name",
  dbaNames: "DBA / trade names",
  formationJurisdiction: "Jurisdiction of formation",
  formationDate: "Date of formation",
  registeredAddress: "Registered office address",
  principalAddress: "Principal place of business",
  licenseType: "License type",
  licenseNumber: "License number",
  applicationDate: "Application date",
  expirationDate: "Requested expiration date",
  name: "name",
  title: "title",
  ownershipPercentage: "ownership percentage",
  relationship: "relationship",
};

/** "business.legalName" → "Legal name"; "people[1].title" → "Control person 2 title". */
export function fieldLabel(path: string): string {
  const person = /^people\[(\d+)\]\.(\w+)$/.exec(path);
  if (person) return `Control person ${Number(person[1]) + 1} ${LABELS[person[2]!] ?? person[2]}`;
  const key = path.split(".").at(-1) ?? path;
  return LABELS[key] ?? path;
}

function section(prefix: string, fields: Record<string, FieldValue<unknown>>): FieldEntry[] {
  return Object.entries(fields).map(([key, field]) => ({ path: `${prefix}.${key}`, field }));
}

export type FieldGroup = { id: string; label: string };

/** The section a field is reviewed under: "business", "licensing", or one person. */
export function fieldGroup(path: string): FieldGroup {
  const person = /^people\[(\d+)\]\./.exec(path);
  if (person) return { id: `people[${person[1]}]`, label: `Control person ${Number(person[1]) + 1}` };
  const section = path.split(".")[0] ?? path;
  return { id: section, label: section === "business" ? "Business" : section === "licensing" ? "Licensing" : section };
}

/** The label within its group: "people[1].title" → "Title". */
export function fieldShortLabel(path: string): string {
  const key = path.split(".").at(-1) ?? path;
  const label = LABELS[key] ?? key;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The shape of a field's value, which decides how it is edited and validated. */
export type FieldKind = "text" | "date" | "number" | "address" | "text_list";

const KINDS: Record<string, FieldKind> = {
  dbaNames: "text_list",
  formationDate: "date",
  applicationDate: "date",
  expirationDate: "date",
  registeredAddress: "address",
  principalAddress: "address",
  ownershipPercentage: "number",
};

export function fieldKind(path: string): FieldKind {
  return KINDS[path.split(".").at(-1) ?? ""] ?? "text";
}

// Labels are declared in schema order, so they double as the order within a group.
const KEY_ORDER = Object.keys(LABELS);

/**
 * Orders paths the way listFields does (business, licensing, then each person in
 * document order), for rows read back from the database, which have no order of their own.
 */
export function compareFieldPaths(a: string, b: string): number {
  const rank = (path: string): [number, number] => {
    const person = /^people\[(\d+)\]\./.exec(path);
    const section = person ? 2 + Number(person[1]) : path.startsWith("business.") ? 0 : 1;
    const key = KEY_ORDER.indexOf(path.split(".").at(-1) ?? "");
    return [section, key === -1 ? KEY_ORDER.length : key];
  };
  const [sectionA, keyA] = rank(a);
  const [sectionB, keyB] = rank(b);
  return sectionA - sectionB || keyA - keyB || a.localeCompare(b);
}
