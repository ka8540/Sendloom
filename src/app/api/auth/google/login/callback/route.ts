import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { setSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { exchangeGoogleCode, fetchGoogleUserInfo, getGoogleLoginRedirectUri } from "@/lib/google";

const GOOGLE_LOGIN_STATE_COOKIE = "sendloom_google_login_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  const store = await cookies();
  const expectedState = store.get(GOOGLE_LOGIN_STATE_COOKIE)?.value;
  store.delete(GOOGLE_LOGIN_STATE_COOKIE);

  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=state_mismatch", request.url));
  }

  try {
    const tokens = await exchangeGoogleCode(code, getGoogleLoginRedirectUri());
    const profile = await fetchGoogleUserInfo(tokens.access_token);

    await prisma.user.upsert({
      where: { email: profile.email },
      update: {},
      create: {
        email: profile.email
      }
    });

    await setSession(profile.email);
    return NextResponse.redirect(new URL("/workspace", request.url));
  } catch (loginError) {
    const message = loginError instanceof Error ? loginError.message : "google_login_failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  }
}
