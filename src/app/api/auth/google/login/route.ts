import crypto from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildGoogleLoginUrl } from "@/lib/google";
import { getGoogleLoginUserError } from "@/lib/user-facing-errors";

const GOOGLE_LOGIN_STATE_COOKIE = "sendloom_google_login_state";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const state = crypto.randomBytes(32).toString("hex");
  const store = await cookies();

  store.set(GOOGLE_LOGIN_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10
  });

  try {
    return NextResponse.redirect(
      buildGoogleLoginUrl({
        state,
        redirectUri: `${origin}/api/auth/google/login/callback`
      })
    );
  } catch (error) {
    console.error("[google-login] Could not start Google sign-in.", error);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError())}`, request.url));
  }
}
