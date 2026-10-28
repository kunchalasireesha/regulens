// Shared by the proxy, which runs before rendering, and the login flow. No server-only
// import, so the proxy bundle stays free of database code.

export const SESSION_COOKIE = "regulens_session";

/**
 * The page to return to after signing in. Only same-site paths are allowed: anything
 * else ("https://evil.example", "//evil.example", "/\\evil.example") falls back to "/",
 * so the login form cannot be used as an open redirect.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  // Resolve against a placeholder origin: a path that leaves it was not a plain path.
  const url = new URL(value, "http://regulens.invalid");
  if (url.origin !== "http://regulens.invalid" || url.pathname.startsWith("/login")) return "/";
  return url.pathname + url.search;
}
