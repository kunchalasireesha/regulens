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
  STORAGE_DIR: z.string().trim().min(1).default(".data/uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * MB),
  MAX_PAGES: z.coerce.number().int().positive().default(30),
});

export type AiProviderConfig =
  | { kind: "gemini"; apiKey: string; model: string }
  | { kind: "mock" };

export type ServerEnv = {
  databaseUrl: string;
  ai: AiProviderConfig;
  storageDir: string;
  maxUploadBytes: number;
  maxPages: number;
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Parses server configuration. Exported separately from `getEnv` so it can be
 * tested without touching `process.env`.
 *
 * AI provider selection: an explicit AI_PROVIDER wins; otherwise Gemini is used
 * when GEMINI_API_KEY is set, and mock extraction when it is not.
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

  return {
    databaseUrl: raw.DATABASE_URL,
    ai,
    storageDir: raw.STORAGE_DIR,
    maxUploadBytes: raw.MAX_UPLOAD_BYTES,
    maxPages: raw.MAX_PAGES,
  };
}

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
