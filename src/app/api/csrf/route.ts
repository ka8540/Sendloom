import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { CSRF_COOKIE, CSRF_COOKIE_MAX_AGE, generateCsrfToken, isValidCsrfToken } from "@/lib/csrf";

export async function GET() {
  const store = await cookies();
  const existing = store.get(CSRF_COOKIE)?.value;
  const token = isValidCsrfToken(existing) ? (existing as string) : generateCsrfToken();

  const response = NextResponse.json({ token });
  response.cookies.set({
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CSRF_COOKIE_MAX_AGE
  });
  return response;
}
