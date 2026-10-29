import "server-only";
import { z } from "zod";

// Server configuration, validated once at first use. Importing this module from
// client code fails the build ("server-only"), which keeps API keys out of the browser.

const MB = 1024 * 1024;

const rawEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  AI_PROVIDER: z.enum(["gemini", "mock"]).optional(),
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.8-flash"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  STORAGE_BACKEND: z.enum(["local", "supabase"]).optional(),
  STORAGE_DIR: z.string().trim().min(1).default(".data/uploads"),
  SUPABASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  SUPABASE_SECRET_KEY: z.string().trim().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().trim().min(1).default("documents"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * MB),
  MAX_PAGES: z.coerce.number().int().positive().default(30),
  MAX_DOCUMENTS: z.coerce.number().int().positive().optional(),
  PUBLIC_DEMO: z.enum(["true", "false"]).default("false"),
  DEMO_PASSWORD: z.string().trim().min(1).optional(),
});

export type AiProviderConfig =
  | { kind: "gemini"; apiKey: string; model: string }
  | { kind: "mock" };

export type StorageConfig =
  | { kind: "local"; dir: string }
  | { kind: "supabase"; url: string; secretKey: string; bucket: string };

export type ServerEnv = {
  databaseUrl: string;
  databasePoolMax: number;
  ai: AiProviderConfig;
  storage: StorageConfig;
  maxUploadBytes: number;
  maxPages: number;
  /** Documents an organization may hold; unlimited when unset. Caps a public demo. */
  maxDocuments: number | null;
  /** Credentials shown on the login page, for a public demo deployment only. */
  publicDemo: { password: string } | null;
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Parses server configuration. Exported separately from `getEnv` so it can be
 * tested without touching `process.env`.
 *
 * AI provider selection: an explicit AI_PROVIDER wins; otherwise Gemini is used
 * when GEMINI_API_KEY is set, and mock extraction when it is not. Storage follows the
 * same pattern: an explicit STORAGE_BACKEND wins; otherwise Supabase Storage when
 * SUPABASE_URL is set, and local disk when it is not.
 */
export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  // Treat empty strings (e.g. `GEMINI_API_KEY=` copied from .env.example) as unset.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );

  const result = rawEnvSchema.safeParse(cleaned);
  if (!result.success) {
    // Report variable names only; never echo values, which may be secrets.
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new ConfigError(`Invalid or missing environment variables: ${names.join(", ")}`);
  }
  const raw = result.data;

  const providerKind = raw.AI_PROVIDER ?? (raw.GEMINI_API_KEY ? "gemini" : "mock");
  let ai: AiProviderConfig;
  if (providerKind === "gemini") {
    if (!raw.GEMINI_API_KEY) {
      throw new ConfigError("AI_PROVIDER is 'gemini' but GEMINI_API_KEY is not set");
    }
    ai = { kind: "gemini", apiKey: raw.GEMINI_API_KEY, model: raw.GEMINI_MODEL };
  } else {
    ai = { kind: "mock" };
  }

  const storageKind = raw.STORAGE_BACKEND ?? (raw.SUPABASE_URL ? "supabase" : "local");
  let storage: StorageConfig;
  if (storageKind === "supabase") {
    if (!raw.SUPABASE_URL || !raw.SUPABASE_SECRET_KEY) {
      throw new ConfigError(
        "Supabase Storage needs both SUPABASE_URL and SUPABASE_SECRET_KEY",
      );
    }
    storage = {
      kind: "supabase",
      url: raw.SUPABASE_URL,
      secretKey: raw.SUPABASE_SECRET_KEY,
      bucket: raw.SUPABASE_STORAGE_BUCKET,
    };
  } else {
    storage = { kind: "local", dir: raw.STORAGE_DIR };
  }

  let publicDemo: ServerEnv["publicDemo"] = null;
  if (raw.PUBLIC_DEMO === "true") {
    // The page shows the password, so it must be the one the seed actually set.
    if (!raw.DEMO_PASSWORD) throw new ConfigError("PUBLIC_DEMO is 'true' but DEMO_PASSWORD is not set");
    publicDemo = { password: raw.DEMO_PASSWORD };
  }

  return {
    databaseUrl: raw.DATABASE_URL,
    databasePoolMax: raw.DATABASE_POOL_MAX,
    ai,
    storage,
    maxUploadBytes: raw.MAX_UPLOAD_BYTES,
    maxPages: raw.MAX_PAGES,
    maxDocuments: raw.MAX_DOCUMENTS ?? null,
    publicDemo,
  };
}

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
