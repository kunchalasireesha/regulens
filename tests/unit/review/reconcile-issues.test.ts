import { describe, expect, it } from "vitest";
import { reconcileIssues, type StoredIssue } from "@/server/review/reconcile-issues";
import type { ValidationIssue } from "@/server/validation/validate";

const outOfRange: ValidationIssue = {
  ruleId: "ownership.out_of_range",
  severity: "critical",
  fieldPaths: ["people[0].ownershipPercentage"],
  message: "Control person 1 ownership percentage is 150%, outside 0–100%.",
};
const total = (percent: number): ValidationIssue => ({
  ruleId: "ownership.total_exceeds_100",
  severity: "critical",
  fieldPaths: ["people[0].ownershipPercentage", "people[1].ownershipPercentage"],
  message: `Stated ownership adds up to ${percent}%, more than 100%.`,
});
const valueMismatch: ValidationIssue = {
  ruleId: "evidence.value_mismatch",
  severity: "warning",
  fieldPaths: ["business.legalName"],
  message: "The extracted legal name does not appear in the text cited for it.",
};

let nextId = 0;
const stored = (issue: ValidationIssue, resolution: StoredIssue["resolution"] = null): StoredIssue => ({
  id: `issue-${nextId++}`,
  ...issue,
  resolution,
});

const changed = new Set(["people[0].ownershipPercentage"]);

describe("reconcileIssues", () => {
  it("resolves open issues that the correction fixed", () => {
    const a = stored(outOfRange);
    const b = stored(total(170));
    expect(reconcileIssues([a, b], [], changed)).toEqual({ resolve: [a.id, b.id], insert: [] });
  });

  it("keeps issues that still apply unchanged", () => {
    const a = stored(outOfRange);
    expect(reconcileIssues([a], [outOfRange], changed)).toEqual({ resolve: [], insert: [] });
  });

  it("replaces an issue whose message changed with the new numbers", () => {
    const old = stored(total(170));
    expect(reconcileIssues([old], [total(110)], changed)).toEqual({ resolve: [old.id], insert: [total(110)] });
  });

  it("raises problems the correction introduced", () => {
    expect(reconcileIssues([], [outOfRange], changed)).toEqual({ resolve: [], insert: [outOfRange] });
  });

  it("leaves issues about unchanged fields alone, even when the re-run cannot reproduce them", () => {
    // The evidence check needs the model's evidence, which the re-run does not have.
    const mismatch = stored(valueMismatch);
    expect(reconcileIssues([mismatch], [], changed)).toEqual({ resolve: [], insert: [] });
    // And an issue about another field is not raised by this correction.
    expect(reconcileIssues([], [valueMismatch], changed)).toEqual({ resolve: [], insert: [] });
  });

  it("does not raise again what the analyst already confirmed or accepted", () => {
    const confirmed = stored(outOfRange, "confirmed");
    const accepted = stored(total(170), "accepted_unresolved");
    expect(reconcileIssues([confirmed, accepted], [outOfRange, total(170)], changed)).toEqual({ resolve: [], insert: [] });
  });

  it("raises a problem again when a later correction brings it back", () => {
    const fixedEarlier = stored(outOfRange, "corrected");
    expect(reconcileIssues([fixedEarlier], [outOfRange], changed)).toEqual({ resolve: [], insert: [outOfRange] });
  });

  it("matches field lists regardless of order", () => {
    const reordered = stored({ ...total(170), fieldPaths: [...total(170).fieldPaths].reverse() });
    expect(reconcileIssues([reordered], [total(170)], changed)).toEqual({ resolve: [], insert: [] });
  });
});
