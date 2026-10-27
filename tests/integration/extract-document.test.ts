import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/schemas/extraction";
import type { Database } from "@/server/db/client";
import { documents, extractionRuns } from "@/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "@/server/db/seed-data";
import { ExtractionProviderError } from "@/server/extraction/errors";
import { extractDocument } from "@/server/extraction/extract-document";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import type { ExtractionProvider } from "@/server/extraction/provider";
import { LocalFileStorage } from "@/server/ingestion/storage";
import { uploadDocument } from "@/server/ingestion/upload";
import { buildApplicationPdf, buildScannedPdf } from "../../scripts/samples/build";
import { harborline } from "../../scripts/samples/fixtures";
import { OTHER_ORGANIZATION, connectTestDb, resetDatabase } from "./test-db";

let db: Database;
let storageRoot: string;

const demo = { organizationId: DEMO_ORGANIZATION.id };

beforeAll(async () => {
  db = connectTestDb();
});

afterAll(async () => {
  await db.$client.end();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase(db);
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  storageRoot = await mkdtemp(join(tmpdir(), "regulens-extract-"));
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

const runsFor = (documentId: string) =>
  db.select().from(extractionRuns).where(eq(extractionRuns.documentId, documentId));

describe("extractDocument", () => {
  it("records a successful run with its validated result", async () => {
    const documentId = await upload(await buildApplicationPdf(harborline));
    const outcome = await extractDocument(
      { db, provider: new MockExtractionProvider() },
      { ...demo, documentId },
    );

    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") return;
    expect(outcome.result.business.legalName).toMatchObject({ value: harborline.business.legalName });

    const [run] = await runsFor(documentId);
    expect(run).toMatchObject({
      id: outcome.runId,
      organizationId: DEMO_ORGANIZATION.id,
      provider: "mock",
      model: "mock-form-mtl-1",
      promptVersion: "none",
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      status: "succeeded",
      inputTokens: null,
      estimatedCostUsd: null,
      errorCode: null,
    });
    // Stored JSON round-trips to exactly what the service returned.
    expect(run!.result).toEqual(outcome.result);
  });

  it("records a failed run with its error code, tokens, and cost", async () => {
    const documentId = await upload(await buildApplicationPdf(harborline));
    const provider: ExtractionProvider = {
      name: "gemini",
      model: "gemini-3.8-flash",
      promptVersion: "test",
      generate: async () => ({ text: "not json", usage: { inputTokens: 4000, outputTokens: 800 } }),
    };
    const outcome = await extractDocument(
      { db, provider, now: () => new Date("2026-10-25T00:00:00Z") },
      { ...demo, documentId },
    );

    expect(outcome).toMatchObject({ kind: "failed", errorCode: "invalid_json" });
    const [run] = await runsFor(documentId);
    expect(run).toMatchObject({
      status: "failed",
      errorCode: "invalid_json",
      inputTokens: 4000,
      outputTokens: 800,
      estimatedCostUsd: "0.006000",
      result: null,
    });
  });

  it("keeps every attempt, so retries are visible", async () => {
    const documentId = await upload(await buildApplicationPdf(harborline));
    let calls = 0;
    const flaky: ExtractionProvider = {
      name: "mock",
      model: "mock-form-mtl-1",
      promptVersion: "none",
      generate: async (request) => {
        if (calls++ === 0) throw new ExtractionProviderError("rate_limited");
        return new MockExtractionProvider().generate(request);
      },
    };
    await extractDocument({ db, provider: flaky }, { ...demo, documentId });
    await extractDocument({ db, provider: flaky }, { ...demo, documentId });

    const runs = await runsFor(documentId);
    expect(runs.map((run) => run.status).sort()).toEqual(["failed", "succeeded"]);
  });

  it("fails without calling the provider when the document has no text", async () => {
    const documentId = await upload(await buildScannedPdf(1));
    const outcome = await extractDocument(
      { db, provider: new MockExtractionProvider() },
      { ...demo, documentId },
    );
    expect(outcome).toMatchObject({ kind: "failed", errorCode: "no_pages" });
  });

  it("does not extract another organization's document", async () => {
    const documentId = await upload(await buildApplicationPdf(harborline));
    const outcome = await extractDocument(
      { db, provider: new MockExtractionProvider() },
      { organizationId: OTHER_ORGANIZATION.id, documentId },
    );
    expect(outcome).toEqual({ kind: "not_found" });
    expect(await runsFor(documentId)).toEqual([]);
  });

  it("leaves the document's processing status to the pipeline", async () => {
    const documentId = await upload(await buildApplicationPdf(harborline));
    await extractDocument({ db, provider: new MockExtractionProvider() }, { ...demo, documentId });
    const [document] = await db
      .select({ processingStatus: documents.processingStatus })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(document?.processingStatus).toBe("queued");
  });
});
