import type { IssueSeverity } from "@/lib/domain/statuses";
import type { Address, ExtractionResult, FieldValue } from "@/lib/schemas/extraction";
import { fieldLabel, type FieldEntry } from "@/lib/schemas/field-paths";
import type { FieldEvidenceResult } from "@/server/evidence/verify";
import { normalizedTextOf } from "@/server/evidence/normalize-text";
import { isUsPostalCode, normalizeStateCode, stateName } from "./normalize";

// Business rules over an extracted application. Each rule is a pure function that reports
// issues; none of them changes a value.
//
// Severity is what the issue means for approval (enforced in Phase 7):
//   critical  the record is wrong or incomplete as extracted; it must be corrected or
//             explicitly accepted before approval
//   warning   something an analyst should look at: weak evidence, an unusual value
//   info      expected but worth noting

export type ValidationIssue = {
  ruleId: string;
  severity: IssueSeverity;
  fieldPaths: string[];
  message: string;
};

export type RuleContext = {
  result: ExtractionResult;
  fields: FieldEntry[];
  /** Normalized value of a found field (ISO date, state code), null when not normalizable. */
  normalized: ReadonlyMap<string, unknown>;
  /** Absent when evidence was not verified, e.g. for values an analyst typed in. */
  evidence?: ReadonlyMap<string, Pick<FieldEvidenceResult, "evidenceStatus" | "valueSupported">>;
};

type Rule = (ctx: RuleContext) => ValidationIssue[];

const REQUIRED = [
  "business.legalName",
  "business.formationJurisdiction",
  "business.formationDate",
  "business.registeredAddress",
  "business.principalAddress",
  "licensing.licenseType",
  "licensing.applicationDate",
];
const DATES = ["business.formationDate", "licensing.applicationDate", "licensing.expirationDate"];
const ADDRESSES = ["business.registeredAddress", "business.principalAddress"];

const requiredFields: Rule = ({ fields }) =>
  fields
    .filter(({ path, field }) => REQUIRED.includes(path) && field.status === "not_found")
    .map(({ path }) =>
      issue("required.missing", "critical", [path], `${fieldLabel(path)} is required but was not found in the document.`),
    );

const ambiguousFields: Rule = ({ fields }) =>
  fields
    .filter(({ field }) => field.status === "ambiguous")
    .map(({ path }) =>
      issue("field.ambiguous", "warning", [path], `${fieldLabel(path)} has conflicting values in the document; choose the correct one.`),
    );

const evidence: Rule = ({ fields, evidence }) => {
  if (!evidence) return [];
  return fields.flatMap(({ path, field }) => {
    const result = evidence.get(path);
    if (!result || field.status === "not_found") return [];
    const label = fieldLabel(path);
    const issues: ValidationIssue[] = [];
    if (result.evidenceStatus === "none") {
      issues.push(issue("evidence.missing", "warning", [path], `${label} has no cited evidence.`));
    }
    if (result.evidenceStatus === "unverified") {
      issues.push(issue("evidence.unverified", "warning", [path], `The text cited for ${lower(label)} was not found in the document.`));
    }
    if (result.valueSupported === false) {
      issues.push(issue("evidence.value_mismatch", "warning", [path], `The extracted ${lower(label)} does not appear in the text cited for it.`));
    }
    return issues;
  });
};

const dates: Rule = ({ result, normalized }) => {
  const issues: ValidationIssue[] = [];
  for (const path of DATES) {
    const value = foundValue(fieldAt(result, path));
    if (typeof value === "string" && normalized.get(path) == null) {
      issues.push(issue("date.unparseable", "warning", [path], `${fieldLabel(path)} "${value}" is not a recognized date.`));
    }
  }

  const iso = (path: string) => normalized.get(path) as string | null | undefined;
  const formation = iso("business.formationDate");
  const application = iso("licensing.applicationDate");
  const expiration = iso("licensing.expirationDate");
  if (application && expiration && expiration <= application) {
    issues.push(
      issue(
        "date.expiration_not_after_application",
        "critical",
        ["licensing.expirationDate", "licensing.applicationDate"],
        `Requested expiration date (${expiration}) is not after the application date (${application}).`,
      ),
    );
  }
  if (formation && application && formation > application) {
    issues.push(
      issue(
        "date.formation_after_application",
        "critical",
        ["business.formationDate", "licensing.applicationDate"],
        `Date of formation (${formation}) is after the application date (${application}).`,
      ),
    );
  }
  return issues;
};

const jurisdiction: Rule = ({ result, normalized }) => {
  const path = "business.formationJurisdiction";
  const value = foundValue(result.business.formationJurisdiction);
  if (value === undefined) return [];
  const code = normalized.get(path) as string | null;
  if (!code) {
    return [issue("jurisdiction.unrecognized", "warning", [path], `Jurisdiction of formation "${value}" is not a recognized US state or territory; confirm it.`)];
  }
  const registered = normalized.get("business.registeredAddress") as Address | null | undefined;
  if (registered && stateName(registered.state) && registered.state !== code) {
    return [
      issue(
        "jurisdiction.registered_office_mismatch",
        "warning",
        [path, "business.registeredAddress"],
        `The registered office is in ${registered.state}, but the business was formed in ${code}; a registered office is normally in the state of formation.`,
      ),
    ];
  }
  return [];
};

const addresses: Rule = ({ result }) =>
  ADDRESSES.flatMap((path) => {
    const address = foundValue(fieldAt(result, path)) as Address | undefined;
    if (!address) return [];
    const label = fieldLabel(path);
    const issues: ValidationIssue[] = [];
    if (!normalizeStateCode(address.state)) {
      issues.push(issue("address.invalid_state", "critical", [path], `${label} has state "${address.state}", which is not a US state or territory.`));
    }
    if (!isUsPostalCode(address.postalCode)) {
      issues.push(issue("address.invalid_postal_code", "warning", [path], `${label} has postal code "${address.postalCode}", which is not a US ZIP code.`));
    }
    return issues;
  });

const people: Rule = ({ result }) => {
  if (result.people.length === 0) {
    return [issue("people.none_listed", "critical", ["people"], "No control persons were found; an application must list its officers, directors, and owners.")];
  }
  const issues: ValidationIssue[] = [];
  result.people.forEach((person, i) => {
    const at = (key: string) => `people[${i}].${key}`;
    if (person.name.status === "not_found") {
      issues.push(issue("person.name_missing", "critical", [at("name")], `${fieldLabel(at("name"))} was not found.`));
    }
    const relationship = foundValue(person.relationship);
    if (relationship && /\bowner\b/i.test(relationship) && person.ownershipPercentage.status === "not_found") {
      issues.push(
        issue(
          "ownership.owner_without_percentage",
          "warning",
          [at("ownershipPercentage"), at("relationship")],
          `Control person ${i + 1} is described as an owner, but no ownership percentage is stated.`,
        ),
      );
    }
  });

  const byName = new Map<string, string[]>();
  result.people.forEach((person, i) => {
    const name = foundValue(person.name);
    if (!name) return;
    const key = normalizedTextOf(name);
    byName.set(key, [...(byName.get(key) ?? []), `people[${i}].name`]);
  });
  for (const paths of byName.values()) {
    if (paths.length > 1) {
      issues.push(issue("people.duplicate_name", "warning", paths, "The same person is listed more than once."));
    }
  }
  return issues;
};

const ownership: Rule = ({ result }) => {
  const stated = result.people.flatMap((person, i) => {
    const value = foundValue(person.ownershipPercentage);
    return value === undefined ? [] : [{ path: `people[${i}].ownershipPercentage`, value }];
  });
  const issues = stated
    .filter(({ value }) => value < 0 || value > 100)
    .map(({ path, value }) =>
      issue("ownership.out_of_range", "critical", [path], `${fieldLabel(path)} is ${value}%, outside 0–100%.`),
    );
  const total = stated.reduce((sum, { value }) => sum + value, 0);
  // Tolerance for decimal percentages such as 33.33 + 33.33 + 33.34.
  if (total > 100 + 1e-9) {
    issues.push(
      issue(
        "ownership.total_exceeds_100",
        "critical",
        stated.map(({ path }) => path),
        `Stated ownership adds up to ${Number(total.toFixed(4))}%, more than 100%.`,
      ),
    );
  }
  return issues;
};

const licenseNumber: Rule = ({ result }) =>
  result.licensing.licenseNumber.status === "not_found"
    ? [issue("license.number_not_assigned", "info", ["licensing.licenseNumber"], "No license number is assigned yet; expected for a new application.")]
    : [];

export const RULES: readonly Rule[] = [
  requiredFields,
  ambiguousFields,
  evidence,
  dates,
  jurisdiction,
  addresses,
  people,
  ownership,
  licenseNumber,
];

function issue(ruleId: string, severity: IssueSeverity, fieldPaths: string[], message: string): ValidationIssue {
  return { ruleId, severity, fieldPaths, message };
}

function foundValue<T>(field: FieldValue<T> | undefined): T | undefined {
  return field?.status === "found" ? field.value : undefined;
}

function fieldAt(result: ExtractionResult, path: string): FieldValue<unknown> | undefined {
  const [section, key] = path.split(".") as [keyof ExtractionResult, string];
  const fields = result[section] as Record<string, FieldValue<unknown>> | undefined;
  return fields?.[key];
}

function lower(label: string): string {
  return label.startsWith("Control person") || label.startsWith("DBA") ? label : label[0]!.toLowerCase() + label.slice(1);
}
