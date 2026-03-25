import crypto from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildGoogleLoginUrl } from "@/lib/google";

const GOOGLE_LOGIN_STATE_COOKIE = "sendloom_google_login_state";

export async function GET(request: Request) {
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
    return NextResponse.redirect(buildGoogleLoginUrl({ state }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "google_login_unavailable";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  }
}
