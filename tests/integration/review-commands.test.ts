import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/current-actor";
import type { Database } from "@/server/db/client";
import { getDocumentReview } from "@/server/db/queries/review";
import { documents, reviewEvents } from "@/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "@/server/db/seed-data";
import { buildExport } from "@/server/export/build-export";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import { LocalFileStorage } from "@/server/ingestion/storage";
import { uploadDocument } from "@/server/ingestion/upload";
import { runPipeline } from "@/server/pipeline/run-pipeline";
import {
  acceptField,
  approveDocument,
  correctField,
  rejectDocument,
  resolveIssue,
} from "@/server/review/commands";
import { buildApplicationPdf } from "../../scripts/samples/build";
import { cobaltPeak, harborline } from "../../scripts/samples/fixtures";
import { OTHER_USER, connectTestDb, resetDatabase } from "./test-db";

let db: Database;
let storageRoot: string;

const analyst: Actor = { userId: DEMO_ANALYST.id, organizationId: DEMO_ORGANIZATION.id };
const outsider: Actor = { userId: OTHER_USER.id, organizationId: OTHER_USER.organizationId };

beforeAll(() => {
  db = connectTestDb();
});

afterAll(async () => {
  await db.$client.end();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase(db);
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  storageRoot = await mkdtemp(join(tmpdir(), "regulens-review-commands-"));
});

async function upload(sample: typeof harborline): Promise<string> {
  const result = await uploadDocument(
    { db, storage: new LocalFileStorage(storageRoot), limits: { maxUploadBytes: 10 * 1024 * 1024, maxPages: 30 } },
    {
      organizationId: analyst.organizationId,
      uploadedBy: analyst.userId,
      filename: "application.pdf",
      bytes: await buildApplicationPdf(sample),
    },
  );
  if (result.kind !== "created") throw new Error(`upload ${result.kind}`);
  return result.document.id;
}

async function processed(sample: typeof harborline): Promise<string> {
  const documentId = await upload(sample);
  const ref = { organizationId: analyst.organizationId, documentId };
  const outcome = await runPipeline({ db, provider: new MockExtractionProvider() }, ref);
  if (outcome.kind !== "ready_for_review") throw new Error(`pipeline ${outcome.kind}`);
  return documentId;
}

async function load(documentId: string) {
  const review = await getDocumentReview(db, analyst.organizationId, documentId);
  if (!review) throw new Error("review not found");
  return review;
}

const fieldOf = async (documentId: string, path: string) =>
  (await load(documentId)).fields.find((field) => field.fieldPath === path)!;
const issuesOf = async (documentId: string, ruleId: string) =>
  (await load(documentId)).issues.filter((issue) => issue.ruleId === ruleId);
const eventTypes = async (documentId: string) => (await load(documentId)).events.map((event) => event.eventType);

async function acceptAllPending(documentId: string) {
  for (const field of (await load(documentId)).fields) {
    if (field.reviewStatus !== "pending") continue;
    expect(await acceptField(db, analyst, { documentId, fieldPath: field.fieldPath })).toEqual({ ok: true });
  }
}

describe("acceptField", () => {
  it("accepts a field, starts the review, and logs both", async () => {
    const documentId = await processed(harborline);
    expect(await acceptField(db, analyst, { documentId, fieldPath: "business.legalName" })).toEqual({ ok: true });

    const review = await load(documentId);
    expect(review.document.reviewStatus).toBe("in_review");
    expect(review.fields.find((f) => f.fieldPath === "business.legalName")!.reviewStatus).toBe("accepted");
    expect(review.events.map((e) => [e.eventType, e.fieldPath, e.actorName])).toEqual([
      ["review_started", null, DEMO_ANALYST.name],
      ["field_accepted", "business.legalName", DEMO_ANALYST.name],
    ]);
    expect(review.events[1]!.newValue).toBe(harborline.business.legalName);

    // Accepting again changes nothing and logs nothing.
    expect(await acceptField(db, analyst, { documentId, fieldPath: "business.legalName" })).toEqual({ ok: true });
    expect(await eventTypes(documentId)).toHaveLength(2);
  });

  it("lets the analyst confirm a field the document does not state", async () => {
    const documentId = await processed(cobaltPeak);
    expect(await acceptField(db, analyst, { documentId, fieldPath: "licensing.licenseNumber" })).toEqual({ ok: true });
    expect(await fieldOf(documentId, "licensing.licenseNumber")).toMatchObject({ currentValue: null, reviewStatus: "accepted" });
  });

  it("refuses an unknown field without writing anything, not even review_started", async () => {
    const documentId = await processed(harborline);
    expect(await acceptField(db, analyst, { documentId, fieldPath: "business.motto" })).toEqual({
      ok: false,
      code: "field_not_found",
    });
    const review = await load(documentId);
    expect(review.document.reviewStatus).toBe("unreviewed");
    expect(review.events).toEqual([]);
  });
});

describe("correctField", () => {
  it("stores the normalized correction, keeps the extracted value, and resolves the issues it fixes", async () => {
    const documentId = await processed(cobaltPeak);
    const before = await fieldOf(documentId, "licensing.expirationDate");
    const [dateIssue] = await issuesOf(documentId, "date.expiration_not_after_application");
    expect(dateIssue!.resolution).toBeNull();

    const result = await correctField(db, analyst, {
      documentId,
      fieldPath: "licensing.expirationDate",
      correction: { value: "June 30, 2027" },
      note: "Typo on the form",
    });
    expect(result).toEqual({ ok: true });

    const after = await fieldOf(documentId, "licensing.expirationDate");
    expect(after).toMatchObject({
      currentValue: "2027-06-30",
      extractedValue: before.extractedValue,
      reviewStatus: "corrected",
      validationStatus: "valid",
    });
    // The other field the issue named is no longer in error either.
    expect((await fieldOf(documentId, "licensing.applicationDate")).validationStatus).toBe("valid");
    expect(await issuesOf(documentId, "date.expiration_not_after_application")).toMatchObject([
      { id: dateIssue!.id, resolution: "corrected" },
    ]);

    const events = (await load(documentId)).events;
    expect(events.map((e) => e.eventType)).toEqual(["review_started", "field_corrected", "issue_resolved"]);
    expect(events[1]).toMatchObject({
      fieldPath: "licensing.expirationDate",
      previousValue: before.currentValue,
      newValue: "2027-06-30",
      note: "Typo on the form",
    });
    expect(events[2]).toMatchObject({ issueId: dateIssue!.id, newValue: { resolution: "corrected" } });
  });

  it("raises an issue for a problem the correction introduces, and resolves it when fixed", async () => {
    const documentId = await processed(harborline);
    const path = "people[0].ownershipPercentage";
    expect((await load(documentId)).issues).toEqual([]);

    await correctField(db, analyst, { documentId, fieldPath: path, correction: { value: 150 } });
    const [raised] = await issuesOf(documentId, "ownership.out_of_range");
    expect(raised).toMatchObject({ severity: "critical", fieldPaths: [path], resolution: null });
    expect((await fieldOf(documentId, path)).validationStatus).toBe("error");

    await correctField(db, analyst, { documentId, fieldPath: path, correction: { value: 50 } });
    expect(await issuesOf(documentId, "ownership.out_of_range")).toMatchObject([{ id: raised!.id, resolution: "corrected" }]);
    expect((await fieldOf(documentId, path)).validationStatus).toBe("valid");
  });

  it("replaces an issue whose numbers changed instead of leaving a stale message open", async () => {
    const documentId = await processed(cobaltPeak);
    const [total] = await issuesOf(documentId, "ownership.total_exceeds_100");
    expect(total!.message).toContain("170%");

    await correctField(db, analyst, { documentId, fieldPath: "people[0].ownershipPercentage", correction: { value: 90 } });

    const totals = await issuesOf(documentId, "ownership.total_exceeds_100");
    expect(totals.map((issue) => [issue.resolution, issue.message.match(/\d+%/)?.[0]])).toEqual([
      ["corrected", "170%"],
      [null, "110%"],
    ]);
    expect(await issuesOf(documentId, "ownership.out_of_range")).toMatchObject([{ resolution: "corrected" }]);
  });

  it("marks a value as not stated, which can raise a required-field issue", async () => {
    const documentId = await processed(harborline);
    await correctField(db, analyst, { documentId, fieldPath: "business.legalName", correction: { value: null } });
    expect(await fieldOf(documentId, "business.legalName")).toMatchObject({ currentValue: null, reviewStatus: "corrected" });
    expect(await issuesOf(documentId, "required.missing")).toMatchObject([
      { severity: "critical", fieldPaths: ["business.legalName"], resolution: null },
    ]);
  });

  it("refuses invalid, unchanged, and out-of-range candidate corrections without writing anything", async () => {
    const documentId = await processed(harborline);
    const correct = (fieldPath: string, correction: Parameters<typeof correctField>[2]["correction"]) =>
      correctField(db, analyst, { documentId, fieldPath, correction });

    expect(await correct("licensing.applicationDate", { value: "next week" })).toEqual({ ok: false, code: "invalid_value" });
    expect(await correct("people[0].ownershipPercentage", { value: "25" })).toEqual({ ok: false, code: "invalid_value" });
    expect(await correct("business.legalName", { value: harborline.business.legalName })).toEqual({
      ok: false,
      code: "unchanged",
    });
    expect(await correct("business.legalName", { candidateIndex: 0 })).toEqual({ ok: false, code: "invalid_candidate" });

    expect((await load(documentId)).document.reviewStatus).toBe("unreviewed");
    expect(await eventTypes(documentId)).toEqual([]);
  });
});

describe("resolveIssue", () => {
  it("requires a note to accept a known issue or overrule a critical one", async () => {
    const documentId = await processed(cobaltPeak);
    const [critical] = await issuesOf(documentId, "address.invalid_state");
    const [info] = await issuesOf(documentId, "license.number_not_assigned");

    expect(await resolveIssue(db, analyst, { documentId, issueId: critical!.id, resolution: "confirmed", note: "  " })).toEqual({
      ok: false,
      code: "note_required",
    });
    expect(await resolveIssue(db, analyst, { documentId, issueId: info!.id, resolution: "accepted_unresolved" })).toEqual({
      ok: false,
      code: "note_required",
    });
    expect(await resolveIssue(db, analyst, { documentId, issueId: info!.id, resolution: "confirmed" })).toEqual({ ok: true });

    const result = await resolveIssue(db, analyst, {
      documentId,
      issueId: critical!.id,
      resolution: "accepted_unresolved",
      note: "Applicant to supply corrected address",
    });
    expect(result).toEqual({ ok: true });
    expect(await issuesOf(documentId, "address.invalid_state")).toMatchObject([
      { resolution: "accepted_unresolved", resolutionNote: "Applicant to supply corrected address" },
    ]);
    expect(await resolveIssue(db, analyst, { documentId, issueId: critical!.id, resolution: "confirmed", note: "x" })).toEqual({
      ok: false,
      code: "issue_already_resolved",
    });
    expect(await eventTypes(documentId)).toEqual(["review_started", "issue_resolved", "issue_resolved"]);
  });
});

describe("approval", () => {
  it("is blocked until every field is reviewed and no blocking issue is open", async () => {
    const documentId = await processed(cobaltPeak);
    expect(await approveDocument(db, analyst, { documentId })).toEqual({ ok: false, code: "approval_blocked" });

    await acceptAllPending(documentId);
    // Fields are all reviewed, but four critical issues are still open.
    expect(await approveDocument(db, analyst, { documentId })).toEqual({ ok: false, code: "approval_blocked" });

    for (const issue of (await load(documentId)).issues.filter((i) => i.severity !== "info")) {
      await resolveIssue(db, analyst, { documentId, issueId: issue.id, resolution: "accepted_unresolved", note: "Known" });
    }
    // The info issue (no license number yet) stays open and does not block.
    expect(await approveDocument(db, analyst, { documentId, note: "Looks good" })).toEqual({ ok: true });

    const review = await load(documentId);
    expect(review.document).toMatchObject({ reviewStatus: "approved", reviewedBy: DEMO_ANALYST.name });
    expect(review.document.reviewedAt).toBeInstanceOf(Date);
    expect(review.events.at(-1)).toMatchObject({ eventType: "document_approved", note: "Looks good" });

    const exported = buildExport(review);
    expect(exported.issues.filter((issue) => issue.resolution === "accepted_unresolved")).toHaveLength(4);
    expect(exported.record.people).toHaveLength(cobaltPeak.people.length);
  });

  it("freezes the document once approved", async () => {
    const documentId = await processed(harborline);
    await acceptAllPending(documentId);
    expect(await approveDocument(db, analyst, { documentId })).toEqual({ ok: true });

    const refused = { ok: false, code: "not_reviewable" };
    expect(await approveDocument(db, analyst, { documentId })).toEqual(refused);
    expect(await rejectDocument(db, analyst, { documentId, note: "Changed my mind" })).toEqual(refused);
    expect(
      await correctField(db, analyst, { documentId, fieldPath: "business.legalName", correction: { value: "Other" } }),
    ).toEqual(refused);
  });

  it("approves exactly once when two approvals race", async () => {
    const documentId = await processed(harborline);
    await acceptAllPending(documentId);
    const results = await Promise.all([
      approveDocument(db, analyst, { documentId }),
      approveDocument(db, analyst, { documentId }),
    ]);
    expect(results).toContainEqual({ ok: true });
    expect(results).toContainEqual({ ok: false, code: "not_reviewable" });
    expect((await eventTypes(documentId)).filter((type) => type === "document_approved")).toHaveLength(1);
  });

  it("keeps every correction when several race on the same document", async () => {
    const documentId = await processed(cobaltPeak);
    const paths = ["people[0].ownershipPercentage", "people[1].ownershipPercentage"];
    await Promise.all(
      paths.map((fieldPath) => correctField(db, analyst, { documentId, fieldPath, correction: { value: 10 } })),
    );
    for (const path of paths) expect((await fieldOf(documentId, path)).currentValue).toBe(10);
    // Each correction re-validated against the other's committed value: no ownership issue is left open.
    const ownership = (await load(documentId)).issues.filter((i) => i.ruleId.startsWith("ownership."));
    expect(ownership.every((issue) => issue.resolution === "corrected")).toBe(true);
    expect((await eventTypes(documentId)).filter((type) => type === "review_started")).toHaveLength(1);
  });
});

describe("rejectDocument", () => {
  it("requires a reason and is final", async () => {
    const documentId = await processed(cobaltPeak);
    expect(await rejectDocument(db, analyst, { documentId, note: " " })).toEqual({ ok: false, code: "note_required" });
    expect(await rejectDocument(db, analyst, { documentId, note: "Incomplete application" })).toEqual({ ok: true });

    const review = await load(documentId);
    expect(review.document.reviewStatus).toBe("rejected");
    expect(review.events.map((e) => [e.eventType, e.note])).toEqual([
      ["review_started", null],
      ["document_rejected", "Incomplete application"],
    ]);
    expect(await acceptField(db, analyst, { documentId, fieldPath: "business.legalName" })).toEqual({
      ok: false,
      code: "not_reviewable",
    });
  });
});

describe("scope and preconditions", () => {
  it("treats another organization's document as missing", async () => {
    const documentId = await processed(harborline);
    expect(await acceptField(db, outsider, { documentId, fieldPath: "business.legalName" })).toEqual({
      ok: false,
      code: "document_not_found",
    });
  });

  it("refuses review before processing has finished", async () => {
    const documentId = await upload(harborline);
    expect(await rejectDocument(db, analyst, { documentId, note: "Too early" })).toEqual({
      ok: false,
      code: "not_reviewable",
    });
  });

  it("keeps the audit log append-only", async () => {
    const documentId = await processed(harborline);
    await acceptField(db, analyst, { documentId, fieldPath: "business.legalName" });
    await expect(db.update(reviewEvents).set({ note: "rewritten" })).rejects.toThrow();
    await expect(db.delete(reviewEvents)).rejects.toThrow();
    // So is the document it belongs to: the cascade would delete audited events.
    await expect(db.delete(documents).where(eq(documents.id, documentId))).rejects.toThrow();
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(reviewEvents)).toEqual([{ n: 2 }]);
  });
});
