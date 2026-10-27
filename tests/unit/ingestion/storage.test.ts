import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStorage, storageKeyFor } from "@/server/ingestion/storage";

describe("LocalFileStorage", () => {
  let root: string;
  let storage: LocalFileStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "regulens-storage-"));
    storage = new LocalFileStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores and reads back bytes", async () => {
    const key = storageKeyFor("org-1", "a".repeat(64));
    await storage.put(key, new Uint8Array([1, 2, 3]));
    expect(await storage.get(key)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("treats writing an existing key as a no-op and leaves no temp files", async () => {
    const key = storageKeyFor("org-1", "b".repeat(64));
    await storage.put(key, new Uint8Array([1]));
    await storage.put(key, new Uint8Array([1]));
    expect(await readdir(join(root, "org-1"))).toEqual([`${"b".repeat(64)}.pdf`]);
  });

  it("rejects keys that escape the storage root", async () => {
    await expect(storage.put("../outside.pdf", new Uint8Array([1]))).rejects.toThrow(
      "Invalid storage key",
    );
    await expect(storage.get("/etc/passwd")).rejects.toThrow("Invalid storage key");
  });
});
