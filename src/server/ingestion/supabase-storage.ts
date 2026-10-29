import "server-only";
import type { FileStorage } from "./storage";

const REQUEST_TIMEOUT_MS = 30_000;

export class StorageRequestError extends Error {
  override name = "StorageRequestError";
}

/**
 * Supabase Storage over its REST API, with plain fetch instead of the SDK: two calls
 * are all the app needs. The bucket must be private; the secret key bypasses row-level
 * security, so it is only ever used server-side and never sent anywhere but `baseUrl`.
 */
export class SupabaseFileStorage implements FileStorage {
  private readonly objectUrl: string;

  constructor(
    baseUrl: string,
    private readonly secretKey: string,
    bucket: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.objectUrl = `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}`;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const response = await this.request("POST", key, {
      // Content-addressed keys: an existing object already holds these bytes, so it
      // is never overwritten (x-upsert: false) and the conflict counts as success.
      headers: { "content-type": "application/pdf", "x-upsert": "false" },
      // A copy: fetch accepts only ArrayBuffer-backed views, and the type allows a shared one.
      body: new Uint8Array(bytes),
    });
    if (response.ok || (await isDuplicate(response))) return;
    throw new StorageRequestError(`Storage upload failed with HTTP ${response.status}`);
  }

  async get(key: string): Promise<Uint8Array> {
    const response = await this.request("GET", key);
    if (!response.ok) {
      throw new StorageRequestError(`Storage download failed with HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private request(
    method: "GET" | "POST",
    key: string,
    init: { headers?: Record<string, string>; body?: Uint8Array<ArrayBuffer> } = {},
  ): Promise<Response> {
    return this.fetchImpl(`${this.objectUrl}/${encodeKey(key)}`, {
      method,
      headers: { ...authHeaders(this.secretKey), ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}

/**
 * Secret keys (`sb_secret_…`) are not JWTs and go in the `apikey` header only. The
 * legacy `service_role` key is a JWT, which Storage also expects as a bearer token.
 */
function authHeaders(secretKey: string): Record<string, string> {
  return secretKey.startsWith("sb_secret_")
    ? { apikey: secretKey }
    : { apikey: secretKey, authorization: `Bearer ${secretKey}` };
}

/** Keys are `{org}/{hash}.pdf`; each segment is encoded, the slashes are kept. */
function encodeKey(key: string): string {
  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Invalid storage key");
  }
  return segments.map(encodeURIComponent).join("/");
}

/** Storage reports an existing object as HTTP 409, or (older versions) as 400 with a 409 body. */
async function isDuplicate(response: Response): Promise<boolean> {
  if (response.status === 409) return true;
  if (response.status !== 400) return false;
  try {
    const body = (await response.json()) as { statusCode?: unknown; error?: unknown };
    return String(body.statusCode) === "409" || body.error === "Duplicate";
  } catch {
    return false;
  }
}
