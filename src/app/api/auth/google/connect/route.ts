import crypto from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { buildGoogleConnectUrl } from "@/lib/google";

const GOOGLE_STATE_COOKIE = "sendloom_google_oauth_state";
const GOOGLE_NEXT_COOKIE = "sendloom_google_oauth_next";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const state = crypto.randomBytes(32).toString("hex");
  const store = await cookies();
  store.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10
  });

  const nextPath = url.searchParams.get("next");
  if (nextPath && nextPath.startsWith("/")) {
    store.set(GOOGLE_NEXT_COOKIE, nextPath, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10
    });
  } else {
    store.delete(GOOGLE_NEXT_COOKIE);
  }

  try {
    const emailHint = url.searchParams.get("email");
    return NextResponse.redirect(
      buildGoogleConnectUrl({
        state,
        loginHint: emailHint ?? user.email,
        redirectUri: `${origin}/api/auth/google/callback`
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "google_connect_unavailable";
    return NextResponse.redirect(new URL(`/campaigns?gmail_error=${encodeURIComponent(message)}`, request.url));
  }
}
