import { describe, expect, it } from "vitest";
import { canApprove, checkApproval } from "@/lib/review/approval";

const reviewed = [
  { fieldPath: "business.legalName", reviewStatus: "accepted" as const },
  { fieldPath: "licensing.licenseNumber", reviewStatus: "corrected" as const },
];

describe("checkApproval", () => {
  it("allows approval when every field is reviewed and no blocking issue is open", () => {
    const check = checkApproval(reviewed, [
      { id: "a", severity: "critical", resolution: "corrected" },
      { id: "b", severity: "warning", resolution: "accepted_unresolved" },
      { id: "c", severity: "info", resolution: null },
    ]);
    expect(check).toEqual({ pendingFields: [], blockingIssues: [] });
    expect(canApprove(check)).toBe(true);
  });

  it("lists fields still pending review", () => {
    const check = checkApproval([...reviewed, { fieldPath: "people[0].name", reviewStatus: "pending" }], []);
    expect(check.pendingFields).toEqual(["people[0].name"]);
    expect(canApprove(check)).toBe(false);
  });

  it("blocks on open critical and warning issues, not info", () => {
    const check = checkApproval(reviewed, [
      { id: "a", severity: "critical", resolution: null },
      { id: "b", severity: "warning", resolution: null },
      { id: "c", severity: "info", resolution: null },
    ]);
    expect(check.blockingIssues).toEqual([
      { id: "a", severity: "critical" },
      { id: "b", severity: "warning" },
    ]);
    expect(canApprove(check)).toBe(false);
  });
});
