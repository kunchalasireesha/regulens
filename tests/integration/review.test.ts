import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { extractionResultSchema } from "@/lib/schemas/extraction";
import type { Database } from "@/server/db/client";
import { getDocumentReview } from "@/server/db/queries/review";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "@/server/db/seed-data";
import { normalizedTextOf } from "@/server/evidence/normalize-text";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import { LocalFileStorage } from "@/server/ingestion/storage";
import { uploadDocument } from "@/server/ingestion/upload";
import { runPipeline } from "@/server/pipeline/run-pipeline";
import { buildApplicationPdf } from "../../scripts/samples/build";
import { cobaltPeak, harborline } from "../../scripts/samples/fixtures";
import { OTHER_ORGANIZATION, connectTestDb, resetDatabase } from "./test-db";

let db: Database;
let storageRoot: string;

const demo = { organizationId: DEMO_ORGANIZATION.id };

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
  storageRoot = await mkdtemp(join(tmpdir(), "regulens-review-"));
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

async function processed(sample: typeof harborline): Promise<string> {
  const documentId = await upload(await buildApplicationPdf(sample));
  const outcome = await runPipeline({ db, provider: new MockExtractionProvider() }, { ...demo, documentId });
  if (outcome.kind !== "ready_for_review") throw new Error(`pipeline ${outcome.kind}`);
  return documentId;
}

describe("getDocumentReview", () => {
  it("returns pages, fields in schema order with their evidence, and the extraction run", async () => {
    const documentId = await processed(harborline);
    const review = await getDocumentReview(db, demo.organizationId, documentId);
    if (!review) throw new Error("review not found");

    expect(review.document).toMatchObject({ id: documentId, processingStatus: "ready_for_review" });
    expect(review.pages.map((p) => p.pageNumber)).toEqual(
      Array.from({ length: review.document.pageCount! }, (_, i) => i + 1),
    );
    expect(review.extractionRun).toMatchObject({ provider: "mock" });

    // Schema order, not the stored result's: jsonb does not keep object key order.
    const keys = (shape: object, prefix: string) => Object.keys(shape).map((key) => `${prefix}.${key}`);
    const { business, licensing, people } = extractionResultSchema.shape;
    expect(review.fields.map((f) => f.fieldPath)).toEqual([
      ...keys(business.shape, "business"),
      ...keys(licensing.shape, "licensing"),
      ...harborline.people.flatMap((_, i) => keys(people.element.shape, `people[${i}]`)),
    ]);

    // Every stored offset points at the quoted words in the page text the analyst sees.
    const located = review.fields.flatMap((f) => f.evidence).filter((e) => e.matchedPage !== null);
    expect(located.length).toBeGreaterThan(0);
    for (const evidence of located) {
      const page = review.pages.find((p) => p.pageNumber === evidence.matchedPage)!;
      const slice = page.text.slice(evidence.matchStart!, evidence.matchEnd!);
      expect(normalizedTextOf(slice)).toBe(normalizedTextOf(evidence.quote));
    }
  });

  it("orders issues most severe first", async () => {
    const documentId = await processed(cobaltPeak);
    const review = await getDocumentReview(db, demo.organizationId, documentId);

    const severities = review!.issues.map((i) => i.severity);
    expect(severities).toHaveLength(5);
    const rank = { critical: 0, warning: 1, info: 2 };
    expect(severities).toEqual([...severities].sort((a, b) => rank[a] - rank[b]));
    expect(severities.at(-1)).toBe("info");
  });

  it("returns a queued document with no fields before the pipeline runs", async () => {
    const documentId = await upload(await buildApplicationPdf(harborline));
    const review = await getDocumentReview(db, demo.organizationId, documentId);
    expect(review).toMatchObject({ fields: [], issues: [], extractionRun: null });
    expect(review!.document.processingStatus).toBe("queued");
  });

  it("does not reveal another organization's document or fail on a malformed id", async () => {
    const documentId = await processed(harborline);
    expect(await getDocumentReview(db, OTHER_ORGANIZATION.id, documentId)).toBeUndefined();
    expect(await getDocumentReview(db, demo.organizationId, "not-a-uuid")).toBeUndefined();
    expect(await getDocumentReview(db, demo.organizationId, "00000000-0000-4000-8000-0000000000ff")).toBeUndefined();
  });
});
