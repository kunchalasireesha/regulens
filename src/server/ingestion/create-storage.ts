import "server-only";
import type { StorageConfig } from "@/server/env";
import { LocalFileStorage, type FileStorage } from "./storage";
import { SupabaseFileStorage } from "./supabase-storage";

export function createFileStorage(config: StorageConfig): FileStorage {
  switch (config.kind) {
    case "local":
      return new LocalFileStorage(config.dir);
    case "supabase":
      return new SupabaseFileStorage(config.url, config.secretKey, config.bucket);
  }
}
