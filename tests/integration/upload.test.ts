import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/client";
import { documentPages, documents, processingEvents } from "@/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "@/server/db/seed-data";
import { LocalFileStorage } from "@/server/ingestion/storage";
import { uploadDocument, type UploadDeps, type UploadInput } from "@/server/ingestion/upload";
import { buildApplicationPdf, buildScannedPdf } from "../../scripts/samples/build";
import { cobaltPeak, harborline } from "../../scripts/samples/fixtures";
import { OTHER_ORGANIZATION, OTHER_USER, connectTestDb, resetDatabase } from "./test-db";

let db: Database;
let storageRoot: string;
let deps: UploadDeps;
let harborlinePdf: Uint8Array;

const demoUpload = (bytes: Uint8Array, filename = "application.pdf"): UploadInput => ({
  organizationId: DEMO_ORGANIZATION.id,
  uploadedBy: DEMO_ANALYST.id,
  filename,
  bytes,
});

beforeAll(async () => {
  db = connectTestDb();
  harborlinePdf = await buildApplicationPdf(harborline);
});

afterAll(async () => {
  await db.$client.end();
});

beforeEach(async () => {
  await resetDatabase(db);
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  storageRoot = await mkdtemp(join(tmpdir(), "regulens-upload-"));
  deps = {
    db,
    storage: new LocalFileStorage(storageRoot),
    limits: { maxUploadBytes: 10 * 1024 * 1024, maxPages: 30 },
  };
});

async function storedFiles(organizationId: string): Promise<string[]> {
  return readdir(join(storageRoot, organizationId)).catch(() => []);
}

describe("uploadDocument", () => {
  it("stores the file and records the document, its pages, and a parse event", async () => {
    const result = await uploadDocument(deps, demoUpload(harborlinePdf, "Harborline.pdf"));

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.document).toMatchObject({
      filename: "Harborline.pdf",
      sizeBytes: harborlinePdf.length,
      pageCount: 4,
      processingStatus: "queued",
      failureCode: null,
    });

    const [row] = await db.select().from(documents).where(eq(documents.id, result.document.id));
    expect(row?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.storageKey).toBe(`${DEMO_ORGANIZATION.id}/${row?.contentHash}.pdf`);
    expect(await deps.storage.get(row!.storageKey)).toEqual(harborlinePdf);

    const pages = await db
      .select()
      .from(documentPages)
      .where(eq(documentPages.documentId, result.document.id))
      .orderBy(asc(documentPages.pageNumber));
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4]);
    expect(pages[0]?.text).toContain("Harborline Payments, Inc.");
    expect(pages.every((p) => p.organizationId === DEMO_ORGANIZATION.id)).toBe(true);

    const events = await db
      .select()
      .from(processingEvents)
      .where(eq(processingEvents.documentId, result.document.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ stage: "parse", outcome: "succeeded", errorCode: null });
  });

  it("returns the existing document for a duplicate upload", async () => {
    const first = await uploadDocument(deps, demoUpload(harborlinePdf, "first.pdf"));
    const second = await uploadDocument(deps, demoUpload(harborlinePdf, "renamed copy.pdf"));

    expect(second.kind).toBe("duplicate");
    if (first.kind !== "created" || second.kind !== "duplicate") return;
    expect(second.document.id).toBe(first.document.id);
    expect(second.document.filename).toBe("first.pdf");
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it("creates exactly one document when the same file is uploaded concurrently", async () => {
    // Hold every upload at storage.put() until all of them have passed the duplicate
    // pre-check, so the race is guaranteed and only the database constraint can stop it.
    const uploads = 5;
    let arrived = 0;
    let release!: () => void;
    const allArrived = new Promise<void>((resolve) => (release = resolve));
    const racingDeps: UploadDeps = {
      ...deps,
      storage: {
        get: (key) => deps.storage.get(key),
        put: async (key, bytes) => {
          if (++arrived === uploads) release();
          await allArrived;
          await deps.storage.put(key, bytes);
        },
      },
    };

    const results = await Promise.all(
      Array.from({ length: uploads }, () => uploadDocument(racingDeps, demoUpload(harborlinePdf))),
    );

    expect(results.filter((r) => r.kind === "created")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "duplicate")).toHaveLength(4);
    expect(await db.select().from(documents)).toHaveLength(1);
    expect(await db.select().from(documentPages)).toHaveLength(4);
    expect(await storedFiles(DEMO_ORGANIZATION.id)).toHaveLength(1);
  });

  it("treats the same file in another organization as a separate document", async () => {
    await uploadDocument(deps, demoUpload(harborlinePdf));
    const other = await uploadDocument(deps, {
      organizationId: OTHER_ORGANIZATION.id,
      uploadedBy: OTHER_USER.id,
      filename: "application.pdf",
      bytes: harborlinePdf,
    });

    expect(other.kind).toBe("created");
    expect(await db.select().from(documents)).toHaveLength(2);
  });

  it("keeps a document without a text layer, marked failed with a reason", async () => {
    const result = await uploadDocument(deps, demoUpload(await buildScannedPdf(2), "scan.pdf"));

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.document).toMatchObject({
      pageCount: 2,
      processingStatus: "failed",
      failureCode: "no_text_layer",
    });
    expect(await db.select().from(documentPages)).toHaveLength(0);
    const [event] = await db.select().from(processingEvents);
    expect(event).toMatchObject({ stage: "parse", outcome: "failed", errorCode: "no_text_layer" });
  });

  it.each([
    ["not_a_pdf", () => new TextEncoder().encode("hello, not a pdf")],
    ["invalid_pdf", () => new TextEncoder().encode("%PDF-1.7\nbroken")],
    ["empty_file", () => new Uint8Array()],
  ] as const)("rejects %s without writing anything", async (code, makeBytes) => {
    const result = await uploadDocument(deps, demoUpload(makeBytes()));

    expect(result).toEqual({ kind: "rejected", code });
    expect(await db.select().from(documents)).toHaveLength(0);
    expect(await storedFiles(DEMO_ORGANIZATION.id)).toHaveLength(0);
  });

  it("enforces the configured size and page limits", async () => {
    const cobaltPdf = await buildApplicationPdf(cobaltPeak);
    const tooLarge = await uploadDocument(
      { ...deps, limits: { ...deps.limits, maxUploadBytes: cobaltPdf.length - 1 } },
      demoUpload(cobaltPdf),
    );
    const tooLong = await uploadDocument(
      { ...deps, limits: { ...deps.limits, maxPages: 3 } },
      demoUpload(cobaltPdf),
    );

    expect(tooLarge).toEqual({ kind: "rejected", code: "file_too_large" });
    expect(tooLong).toEqual({ kind: "rejected", code: "too_many_pages" });
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it("caps documents per organization but still opens duplicates when full", async () => {
    const capped = { ...deps, limits: { ...deps.limits, maxDocuments: 1 } };
    await uploadDocument(capped, demoUpload(harborlinePdf));

    const cobaltPdf = await buildApplicationPdf(cobaltPeak);
    expect(await uploadDocument(capped, demoUpload(cobaltPdf))).toEqual({
      kind: "rejected",
      code: "document_limit_reached",
    });
    expect((await uploadDocument(capped, demoUpload(harborlinePdf))).kind).toBe("duplicate");
    expect(await storedFiles(DEMO_ORGANIZATION.id)).toHaveLength(1);

    // The cap counts each organization's documents separately.
    const other = await uploadDocument(capped, {
      organizationId: OTHER_ORGANIZATION.id,
      uploadedBy: OTHER_USER.id,
      filename: "application.pdf",
      bytes: cobaltPdf,
    });
    expect(other.kind).toBe("created");
  });
});
