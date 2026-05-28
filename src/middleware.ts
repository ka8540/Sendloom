import { NextResponse, type NextRequest } from "next/server";

import {
  CSRF_COOKIE,
  CSRF_COOKIE_MAX_AGE,
  CSRF_HEADER,
  csrfTokensMatch,
  generateCsrfToken,
  isValidCsrfToken
} from "@/lib/csrf";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Endpoints that are unsafe-method but cannot present a CSRF cookie token
// (third-party callbacks, server-to-server cron, signed webhooks). Google
// OAuth endpoints are GET-only redirects, so they don't appear here — they
// are protected by the OAuth `state` cookie validated in their callbacks.
const CSRF_EXEMPT_PREFIXES = [
  "/api/cron",
  "/api/webhooks"
];

function isCsrfExempt(pathname: string) {
  return CSRF_EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function applyCsrfCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CSRF_COOKIE_MAX_AGE
  });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();
  const existingToken = request.cookies.get(CSRF_COOKIE)?.value;
  const tokenIsValid = isValidCsrfToken(existingToken);

  if (SAFE_METHODS.has(method)) {
    const response = NextResponse.next();
    if (!tokenIsValid && !isCsrfExempt(pathname)) {
      applyCsrfCookie(response, generateCsrfToken());
    }
    return response;
  }

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (isCsrfExempt(pathname)) {
    return NextResponse.next();
  }

  const headerToken = request.headers.get(CSRF_HEADER);
  if (!tokenIsValid || !csrfTokensMatch(existingToken, headerToken)) {
    return NextResponse.json({ error: "Invalid CSRF token." }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/data|favicon.ico|apple-icon|icon).*)"]
};
