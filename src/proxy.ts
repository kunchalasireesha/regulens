import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/navigation";

/**
 * Sends visitors without a session cookie to the login page before anything renders,
 * remembering where they were going. This only checks that the cookie exists; whether
 * it is a valid session is decided against the database by getCurrentActor, which every
 * page, action, and route handler calls.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  // Server action POSTs pass through: the action's own session check redirects them in
  // a way the client router understands.
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login page itself and static assets.
  matcher: ["/((?!login|_next/static|_next/image|favicon\\.ico).*)"],
};
