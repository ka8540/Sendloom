import crypto from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { buildGoogleConnectUrl } from "@/lib/google";

const GOOGLE_STATE_COOKIE = "sendloom_google_oauth_state";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
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

  try {
    return NextResponse.redirect(
      buildGoogleConnectUrl({
        state,
        loginHint: user.email,
        redirectUri: `${origin}/api/auth/google/callback`
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "google_connect_unavailable";
    return NextResponse.redirect(new URL(`/campaigns?gmail_error=${encodeURIComponent(message)}`, request.url));
  }
}
