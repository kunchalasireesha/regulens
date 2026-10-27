import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/client";
import { listRecentDocuments } from "@/server/db/queries/documents";
import {
  documents,
  extractedFields,
  extractionRuns,
  fieldEvidence,
  processingEvents,
  validationIssues,
} from "@/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "@/server/db/seed-data";
import { ExtractionProviderError } from "@/server/extraction/errors";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import type { ExtractionProvider } from "@/server/extraction/provider";
import { LocalFileStorage } from "@/server/ingestion/storage";
import { uploadDocument } from "@/server/ingestion/upload";
import { runPipeline } from "@/server/pipeline/run-pipeline";
import { requeueDocument } from "@/server/pipeline/transitions";
import { buildApplicationPdf, buildScannedPdf } from "../../scripts/samples/build";
import { cobaltPeak, harborline } from "../../scripts/samples/fixtures";
import { OTHER_ORGANIZATION, connectTestDb, resetDatabase } from "./test-db";

let db: Database;
let storageRoot: string;
let harborlinePdf: Uint8Array;

const demo = { organizationId: DEMO_ORGANIZATION.id };
const mock = new MockExtractionProvider();

beforeAll(async () => {
  db = connectTestDb();
  harborlinePdf = await buildApplicationPdf(harborline);
});

afterAll(async () => {
  await db.$client.end();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase(db);
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  storageRoot = await mkdtemp(join(tmpdir(), "regulens-pipeline-"));
});

async function upload(bytes: Uint8Array): Promise<string> {
  const result = await uploadDocument(
    {
      db,
      storage: new LocalFileStorage(storageRoot),
      limits: { maxUploadBytes: 10 * 1024 * 1024, maxPages: 30 },
    },
    { ...demo, uploadedBy: DEMO_ANALYST.id, filename: "application.pdf", bytes },
  );
  if (result.kind !== "created") throw new Error(`upload ${result.kind}`);
  return result.document.id;
}

async function documentRow(documentId: string) {
  const [row] = await db.select().from(documents).where(eq(documents.id, documentId));
  return row!;
}

const fieldsOf = (documentId: string) =>
  db.select().from(extractedFields).where(eq(extractedFields.documentId, documentId));

const eventsOf = async (documentId: string) =>
  (
    await db
      .select()
      .from(processingEvents)
      .where(eq(processingEvents.documentId, documentId))
      // Events written in one transaction share a timestamp; stage order breaks the tie.
      .orderBy(asc(processingEvents.createdAt), asc(processingEvents.stage))
  ).map((e) => `${e.stage}:${e.outcome}${e.errorCode ? `:${e.errorCode}` : ""}`);

/** Backdates the document so its current attempt counts as stale. */
const makeStale = (documentId: string) =>
  db
    .update(documents)
    .set({ updatedAt: sql`now() - interval '1 hour'` })
    .where(eq(documents.id, documentId));

const failingWith = (code: ConstructorParameters<typeof ExtractionProviderError>[0]): ExtractionProvider => ({
  name: mock.name,
  model: mock.model,
  promptVersion: mock.promptVersion,
  generate: async () => {
    throw new ExtractionProviderError(code);
  },
});

/** A provider that blocks inside the model call until released. */
function hangingProvider() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let entered!: () => void;
  const inModelCall = new Promise<void>((resolve) => (entered = resolve));
  const provider: ExtractionProvider = {
    name: mock.name,
    model: mock.model,
    promptVersion: mock.promptVersion,
    generate: async (request) => {
      entered();
      await released;
      return mock.generate(request);
    },
  };
  return Object.assign(provider, { release, inModelCall });
}

describe("runPipeline", () => {
  it("takes a clean application to ready_for_review with fields, verified evidence, and no issues", async () => {
    const documentId = await upload(harborlinePdf);
    const outcome = await runPipeline({ db, provider: mock }, { ...demo, documentId });

    expect(outcome).toMatchObject({ kind: "ready_for_review", issueCount: 0 });
    if (outcome.kind !== "ready_for_review") return;

    expect(await documentRow(documentId)).toMatchObject({
      processingStatus: "ready_for_review",
      reviewStatus: "unreviewed",
      failureCode: null,
      processingAttempts: 1,
    });

    const fields = await fieldsOf(documentId);
    expect(fields).toHaveLength(outcome.fieldCount);
    expect(fields.every((f) => f.extractionRunId === outcome.extractionRunId)).toBe(true);
    expect(fields.every((f) => f.organizationId === DEMO_ORGANIZATION.id)).toBe(true);
    expect(fields.every((f) => f.reviewStatus === "pending")).toBe(true);

    const legalName = fields.find((f) => f.fieldPath === "business.legalName");
    expect(legalName).toMatchObject({
      extractedValue: harborline.business.legalName,
      currentValue: harborline.business.legalName,
      evidenceStatus: "verified",
      validationStatus: "valid",
    });

    const [evidence] = await db.select().from(fieldEvidence).where(eq(fieldEvidence.fieldId, legalName!.id));
    expect(evidence).toMatchObject({ citedPage: 1, matchedPage: 1, verification: "verified" });
    expect(evidence!.matchEnd! > evidence!.matchStart!).toBe(true);

    expect(await eventsOf(documentId)).toEqual([
      "parse:succeeded",
      "extract:succeeded",
      "verify_evidence:succeeded",
      "validate:succeeded",
    ]);
  });

  it("stores the validation issues of a problematic application", async () => {
    const documentId = await upload(await buildApplicationPdf(cobaltPeak));
    const outcome = await runPipeline({ db, provider: mock }, { ...demo, documentId });

    expect(outcome).toMatchObject({ kind: "ready_for_review", issueCount: 5 });
    const issues = await db.select().from(validationIssues).where(eq(validationIssues.documentId, documentId));
    expect(issues.map((i) => i.ruleId).sort()).toEqual([
      "address.invalid_state",
      "date.expiration_not_after_application",
      "license.number_not_assigned",
      "ownership.out_of_range",
      "ownership.total_exceeds_100",
    ]);
    expect(issues.every((i) => i.resolution === null)).toBe(true);

    const expiration = (await fieldsOf(documentId)).find((f) => f.fieldPath === "licensing.expirationDate");
    expect(expiration).toMatchObject({ extractedValue: "2026-06-30", validationStatus: "error" });
  });

  it("processes a document once when it is triggered concurrently", async () => {
    const documentId = await upload(harborlinePdf);
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => runPipeline({ db, provider: mock }, { ...demo, documentId })),
    );

    expect(outcomes.filter((o) => o.kind === "ready_for_review")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "not_claimed")).toHaveLength(4);
    expect(await db.select().from(extractionRuns)).toHaveLength(1);
  });

  it("does nothing for a document that has already been processed", async () => {
    const documentId = await upload(harborlinePdf);
    await runPipeline({ db, provider: mock }, { ...demo, documentId });
    const fieldCount = (await fieldsOf(documentId)).length;

    expect(await runPipeline({ db, provider: mock }, { ...demo, documentId })).toEqual({ kind: "not_claimed" });
    expect(await fieldsOf(documentId)).toHaveLength(fieldCount);
    expect(await db.select().from(extractionRuns)).toHaveLength(1);
  });

  it("marks an extraction failure on the document and keeps no fields", async () => {
    const documentId = await upload(harborlinePdf);
    const outcome = await runPipeline({ db, provider: failingWith("rate_limited") }, { ...demo, documentId });

    expect(outcome).toEqual({ kind: "failed", failureCode: "rate_limited" });
    expect(await documentRow(documentId)).toMatchObject({ processingStatus: "failed", failureCode: "rate_limited" });
    expect(await fieldsOf(documentId)).toEqual([]);
    expect(await eventsOf(documentId)).toEqual(["parse:succeeded", "extract:failed:rate_limited"]);
  });

  it("succeeds on retry after a retryable failure, keeping both runs", async () => {
    const documentId = await upload(harborlinePdf);
    await runPipeline({ db, provider: failingWith("provider_unavailable") }, { ...demo, documentId });

    expect(await requeueDocument(db, { ...demo, documentId })).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({ processingStatus: "queued", failureCode: null });

    const outcome = await runPipeline({ db, provider: mock }, { ...demo, documentId });
    expect(outcome.kind).toBe("ready_for_review");
    expect(await documentRow(documentId)).toMatchObject({ processingAttempts: 2 });
    const runs = await db.select().from(extractionRuns).where(eq(extractionRuns.documentId, documentId));
    expect(runs.map((r) => r.status).sort()).toEqual(["failed", "succeeded"]);
  });

  it("refuses to requeue a scanned document or one that is ready for review", async () => {
    const scanned = await upload(await buildScannedPdf(1));
    const ready = await upload(harborlinePdf);
    await runPipeline({ db, provider: mock }, { ...demo, documentId: ready });

    expect(await requeueDocument(db, { ...demo, documentId: scanned })).toBe(false);
    expect(await requeueDocument(db, { ...demo, documentId: ready })).toBe(false);
    expect(await runPipeline({ db, provider: mock }, { ...demo, documentId: scanned })).toEqual({ kind: "not_claimed" });
    expect(await documentRow(scanned)).toMatchObject({ processingStatus: "failed", failureCode: "no_text_layer" });
  });

  it("does not touch another organization's document", async () => {
    const documentId = await upload(harborlinePdf);
    const other = { organizationId: OTHER_ORGANIZATION.id, documentId };

    expect(await runPipeline({ db, provider: mock }, other)).toEqual({ kind: "not_claimed" });
    expect(await requeueDocument(db, other)).toBe(false);
    expect(await documentRow(documentId)).toMatchObject({ processingStatus: "queued", processingAttempts: 0 });
  });

  it("lets a stale attempt be reclaimed, and discards the stale attempt's work when it finishes", async () => {
    const documentId = await upload(harborlinePdf);
    const first = hangingProvider();
    const firstRun = runPipeline({ db, provider: first }, { ...demo, documentId });
    await first.inModelCall;

    // A live attempt is not reclaimed…
    expect(await runPipeline({ db, provider: mock }, { ...demo, documentId })).toEqual({ kind: "not_claimed" });
    // …a stale one is.
    await makeStale(documentId);
    const second = await runPipeline({ db, provider: mock }, { ...demo, documentId });
    expect(second.kind).toBe("ready_for_review");

    first.release();
    expect(await firstRun).toEqual({ kind: "superseded" });
    expect(await documentRow(documentId)).toMatchObject({ processingStatus: "ready_for_review", processingAttempts: 2 });
    const fields = await fieldsOf(documentId);
    expect(new Set(fields.map((f) => f.extractionRunId))).toEqual(
      new Set([second.kind === "ready_for_review" ? second.extractionRunId : ""]),
    );
  });

  it("does not let a stale attempt finish while the attempt that replaced it is still running", async () => {
    // The case the attempt number exists for: both attempts see `processing`, so only the
    // attempt number tells the stale one that it no longer owns the document.
    const documentId = await upload(harborlinePdf);
    const first = hangingProvider();
    const firstRun = runPipeline({ db, provider: first }, { ...demo, documentId });
    await first.inModelCall;

    await makeStale(documentId);
    const second = hangingProvider();
    const secondRun = runPipeline({ db, provider: second }, { ...demo, documentId });
    await second.inModelCall;

    first.release();
    expect(await firstRun).toEqual({ kind: "superseded" });
    expect(await documentRow(documentId)).toMatchObject({ processingStatus: "processing", processingAttempts: 2 });
    expect(await fieldsOf(documentId)).toEqual([]);

    second.release();
    const outcome = await secondRun;
    expect(outcome.kind).toBe("ready_for_review");
    const fields = await fieldsOf(documentId);
    expect(new Set(fields.map((f) => f.extractionRunId))).toEqual(
      new Set([outcome.kind === "ready_for_review" ? outcome.extractionRunId : ""]),
    );
  });

  it("flags a stale attempt in the document list, and lets it be requeued", async () => {
    const documentId = await upload(harborlinePdf);
    await db.update(documents).set({ processingStatus: "processing" }).where(eq(documents.id, documentId));

    const live = await listRecentDocuments(db, DEMO_ORGANIZATION.id);
    expect(live[0]).toMatchObject({ processingStatus: "processing", processingStale: false });
    expect(await requeueDocument(db, { ...demo, documentId })).toBe(false);

    await makeStale(documentId);
    const stale = await listRecentDocuments(db, DEMO_ORGANIZATION.id);
    expect(stale[0]).toMatchObject({ processingStatus: "processing", processingStale: true });
    expect(await requeueDocument(db, { ...demo, documentId })).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({ processingStatus: "queued" });
  });
});
