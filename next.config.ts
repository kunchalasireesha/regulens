import type { NextConfig } from "next";

// Uploads go through a Server Action, whose request body is capped at 1 MB by default.
// Allow the configured upload limit plus headroom for multipart encoding overhead.
// Must match MAX_UPLOAD_BYTES in src/server/env.ts, which enforces the real limit.
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES) || 10 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      bodySizeLimit: maxUploadBytes + MULTIPART_OVERHEAD_BYTES,
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
