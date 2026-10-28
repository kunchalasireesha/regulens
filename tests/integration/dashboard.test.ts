import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/client";
import { getExtractionStats, getQueueCounts, listQueueDocuments } from "@/server/db/queries/dashboard";
import { documents, extractedFields, extractionRuns, validationIssues } from "@/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "@/server/db/seed-data";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import { LocalFileStorage } from "@/server/ingestion/storage";
import { uploadDocument } from "@/server/ingestion/upload";
import { runPipeline } from "@/server/pipeline/run-pipeline";
import { buildApplicationPdf } from "../../scripts/samples/build";
import { harborline } from "../../scripts/samples/fixtures";
import { OTHER_USER, connectTestDb, resetDatabase } from "./test-db";

let db: Database;
let storageRoot: string;

const org = DEMO_ORGANIZATION.id;

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
  storageRoot = await mkdtemp(join(tmpdir(), "regulens-dashboard-"));
});

let sequence = 0;

/** A bare document row in the given state. Classification only reads the status columns. */
async function insertDocument(
  state: Partial<typeof documents.$inferInsert>,
  owner: { organizationId: string; uploadedBy: string } = { organizationId: org, uploadedBy: DEMO_ANALYST.id },
): Promise<string> {
  sequence += 1;
  const [row] = await db
    .insert(documents)
    .values({
      ...owner,
      filename: `doc-${sequence}.pdf`,
      contentHash: sequence.toString(16).padStart(64, "0"),
      sizeBytes: 1000,
      storageKey: `test/${sequence}`,
      ...state,
    })
    .returning({ id: documents.id });
  return row!.id;
}

async function processedDocument(): Promise<string> {
  const result = await uploadDocument(
    {
      db,
      storage: new LocalFileStorage(storageRoot),
      limits: { maxUploadBytes: 10 * 1024 * 1024, maxPages: 30 },
    },
    {
      organizationId: org,
      uploadedBy: DEMO_ANALYST.id,
      filename: "harborline.pdf",
      bytes: await buildApplicationPdf(harborline),
    },
  );
  if (result.kind !== "created") throw new Error(`upload ${result.kind}`);
  const documentId = result.document.id;
  const outcome = await runPipeline({ db, provider: new MockExtractionProvider() }, { organizationId: org, documentId });
  if (outcome.kind !== "ready_for_review") throw new Error(`pipeline ${outcome.kind}`);
  return documentId;
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe("document queues", () => {
  it("puts every document in exactly one queue", async () => {
    const ids = {
      queued: await insertDocument({ processingStatus: "queued" }),
      processing: await insertDocument({ processingStatus: "processing" }),
      stale: await insertDocument({ processingStatus: "processing", updatedAt: minutesAgo(16) }),
      failed: await insertDocument({ processingStatus: "failed", failureCode: "no_text_layer" }),
      unreviewed: await insertDocument({ processingStatus: "ready_for_review" }),
      inReview: await insertDocument({ processingStatus: "ready_for_review", reviewStatus: "in_review" }),
      approved: await insertDocument({ processingStatus: "ready_for_review", reviewStatus: "approved" }),
      rejected: await insertDocument({ processingStatus: "ready_for_review", reviewStatus: "rejected" }),
    };
    // Another tenant's documents never show up.
    await insertDocument(
      { processingStatus: "failed" },
      { organizationId: OTHER_USER.organizationId, uploadedBy: OTHER_USER.id },
    );

    expect(await getQueueCounts(db, org)).toEqual({
      all: 8,
      needs_review: 2,
      in_progress: 2,
      failed: 2,
      approved: 1,
      rejected: 1,
    });

    const idsIn = async (filter: Parameters<typeof listQueueDocuments>[2]) =>
      new Set((await listQueueDocuments(db, org, filter)).map((doc) => doc.id));
    expect(await idsIn("needs_review")).toEqual(new Set([ids.unreviewed, ids.inReview]));
    expect(await idsIn("in_progress")).toEqual(new Set([ids.queued, ids.processing]));
    expect(await idsIn("failed")).toEqual(new Set([ids.failed, ids.stale]));
    expect(await idsIn("approved")).toEqual(new Set([ids.approved]));
    expect(await idsIn("rejected")).toEqual(new Set([ids.rejected]));
    expect(await idsIn("all")).toEqual(new Set(Object.values(ids)));
  });

  it("returns every queue with zero counts for an empty organization", async () => {
    expect(await getQueueCounts(db, org)).toEqual({
      all: 0,
      needs_review: 0,
      in_progress: 0,
      failed: 0,
      approved: 0,
      rejected: 0,
    });
  });

  it("lists the review queue oldest first and other views newest first", async () => {
    const older = await insertDocument({ processingStatus: "ready_for_review", createdAt: minutesAgo(30) });
    const newer = await insertDocument({ processingStatus: "ready_for_review", createdAt: minutesAgo(5) });

    expect((await listQueueDocuments(db, org, "needs_review")).map((doc) => doc.id)).toEqual([older, newer]);
    expect((await listQueueDocuments(db, org, "all")).map((doc) => doc.id)).toEqual([newer, older]);
  });

  it("reports review progress and open blocking issues per document", async () => {
    const documentId = await processedDocument();
    // Known issues on top of whatever the pipeline found, so the counts are never trivially zero.
    const issue = { organizationId: org, documentId, ruleId: "test", fieldPaths: [], message: "Test" };
    await db.insert(validationIssues).values([
      { ...issue, severity: "critical" },
      { ...issue, severity: "warning" },
      { ...issue, severity: "warning", resolution: "confirmed" },
      { ...issue, severity: "info" },
    ]);
    const fields = await db.select().from(extractedFields).where(eq(extractedFields.documentId, documentId));
    const issues = await db.select().from(validationIssues).where(eq(validationIssues.documentId, documentId));
    const openOf = (severity: string) => issues.filter((i) => i.severity === severity && i.resolution === null).length;
    expect(openOf("critical")).toBeGreaterThan(0);
    expect(fields.length).toBeGreaterThan(0);

    const [before] = await listQueueDocuments(db, org, "needs_review");
    expect(before).toMatchObject({
      id: documentId,
      queue: "needs_review",
      fieldsTotal: fields.length,
      fieldsReviewed: 0,
      openCriticalIssues: openOf("critical"),
      openWarningIssues: openOf("warning"),
    });

    await db
      .update(extractedFields)
      .set({ reviewStatus: "accepted" })
      .where(eq(extractedFields.id, fields[0]!.id));
    await db
      .update(validationIssues)
      .set({ resolution: "confirmed" })
      .where(eq(validationIssues.documentId, documentId));

    const [after] = await listQueueDocuments(db, org, "needs_review");
    expect(after).toMatchObject({ fieldsReviewed: 1, openCriticalIssues: 0, openWarningIssues: 0 });
  });
});

describe("getExtractionStats", () => {
  it("summarizes runs per provider and model", async () => {
    const documentId = await insertDocument({ processingStatus: "ready_for_review" });
    const run = { organizationId: org, documentId, promptVersion: "p1", schemaVersion: "s1" };
    await db.insert(extractionRuns).values([
      { ...run, provider: "gemini", model: "m", status: "succeeded", latencyMs: 1000, inputTokens: 100, outputTokens: 10, estimatedCostUsd: "0.001000" },
      { ...run, provider: "gemini", model: "m", status: "succeeded", latencyMs: 3000, inputTokens: 200, outputTokens: 20, estimatedCostUsd: "0.002500" },
      { ...run, provider: "gemini", model: "m", status: "failed", latencyMs: 30000, errorCode: "provider_timeout" },
      { ...run, provider: "mock", model: "mock-1", status: "succeeded", latencyMs: 5, createdAt: minutesAgo(60) },
    ]);
    const otherDocument = await insertDocument(
      { processingStatus: "ready_for_review" },
      { organizationId: OTHER_USER.organizationId, uploadedBy: OTHER_USER.id },
    );
    await db.insert(extractionRuns).values({
      ...run,
      organizationId: OTHER_USER.organizationId,
      documentId: otherDocument,
      provider: "gemini",
      model: "m",
      status: "succeeded",
    });

    const stats = await getExtractionStats(db, org);
    expect(stats).toMatchObject([
      {
        provider: "gemini",
        model: "m",
        runs: 3,
        succeeded: 2,
        // The failed run's 30 s timeout is left out of the median.
        medianLatencyMs: 2000,
        inputTokens: 300,
        outputTokens: 30,
        estimatedCostUsd: "0.003500",
      },
      { provider: "mock", model: "mock-1", runs: 1, succeeded: 1, medianLatencyMs: 5, inputTokens: 0, estimatedCostUsd: null },
    ]);
    expect(stats[0]?.lastRunAt).toBeInstanceOf(Date);
  });
});
