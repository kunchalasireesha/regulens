import { describe, expect, it } from "vitest";
import { StorageRequestError, SupabaseFileStorage } from "@/server/ingestion/supabase-storage";

// Only the network is replaced: requests are captured and answered by a stub fetch.

type Captured = { url: string; method: string; headers: Record<string, string>; body: unknown };

function storageWith(respond: (call: Captured) => Response, secretKey = "sb_secret_test") {
  const calls: Captured[] = [];
  const fetchStub = async (url: string | URL | Request, init?: RequestInit) => {
    const call = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string>,
      body: init?.body,
    };
    calls.push(call);
    return respond(call);
  };
  const storage = new SupabaseFileStorage(
    "https://abc.supabase.co/",
    secretKey,
    "documents",
    fetchStub as typeof fetch,
  );
  return { storage, calls };
}

const KEY = `org-1/${"a".repeat(64)}.pdf`;
const OBJECT_URL = `https://abc.supabase.co/storage/v1/object/documents/${KEY}`;
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("SupabaseFileStorage", () => {
  it("uploads the bytes as a PDF without overwriting, authenticated by the secret key", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { storage, calls } = storageWith(() => json({ Key: `documents/${KEY}` }, 200));
    await storage.put(KEY, bytes);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: OBJECT_URL,
      method: "POST",
      headers: { apikey: "sb_secret_test", "content-type": "application/pdf", "x-upsert": "false" },
      body: bytes,
    });
  });

  it("also sends a legacy service_role JWT as a bearer token", async () => {
    const { storage, calls } = storageWith(() => json({}, 200), "eyJhbGciOi.legacy.jwt");
    await storage.put(KEY, new Uint8Array([1]));
    expect(calls[0]?.headers).toMatchObject({
      apikey: "eyJhbGciOi.legacy.jwt",
      authorization: "Bearer eyJhbGciOi.legacy.jwt",
    });
  });

  it.each([
    ["HTTP 409", () => json({ error: "Duplicate" }, 409)],
    ["HTTP 400 with a 409 body", () => json({ statusCode: "409", error: "Duplicate" }, 400)],
  ])("treats an existing object (%s) as already stored", async (_label, respond) => {
    const { storage } = storageWith(respond);
    await expect(storage.put(KEY, new Uint8Array([1]))).resolves.toBeUndefined();
  });

  it("fails other errors with the status only, never the key", async () => {
    const { storage } = storageWith(() => json({ statusCode: "403", error: "Unauthorized" }, 400));
    const error = await storage.put(KEY, new Uint8Array([1])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageRequestError);
    expect((error as Error).message).toBe("Storage upload failed with HTTP 400");
    expect((error as Error).message).not.toContain("sb_secret");
  });

  it("downloads an object's bytes", async () => {
    const { storage, calls } = storageWith(() => new Response(new Uint8Array([4, 5, 6])));
    expect(await storage.get(KEY)).toEqual(new Uint8Array([4, 5, 6]));
    expect(calls[0]).toMatchObject({ url: OBJECT_URL, method: "GET" });
  });

  it("fails a download that is not found", async () => {
    const { storage } = storageWith(() => json({ error: "not_found" }, 404));
    await expect(storage.get(KEY)).rejects.toThrow("Storage download failed with HTTP 404");
  });

  it("rejects keys with empty or relative segments", async () => {
    const { storage, calls } = storageWith(() => json({}, 200));
    await expect(storage.put("../outside.pdf", new Uint8Array([1]))).rejects.toThrow(
      "Invalid storage key",
    );
    await expect(storage.get("/etc/passwd")).rejects.toThrow("Invalid storage key");
    expect(calls).toHaveLength(0);
  });
});
