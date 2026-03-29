import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { exchangeGoogleCode, fetchGoogleUserInfo, getGoogleRedirectUri } from "@/lib/google";
import { upsertGoogleSender } from "@/services/senders";

const GOOGLE_STATE_COOKIE = "sendloom_google_oauth_state";

export async function GET(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const origin = url.origin;
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  const store = await cookies();
  const expectedState = store.get(GOOGLE_STATE_COOKIE)?.value;
  store.delete(GOOGLE_STATE_COOKIE);

  if (error) {
    return NextResponse.redirect(new URL(`/campaigns?gmail_error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/campaigns?gmail_error=state_mismatch", request.url));
  }

  try {
    const tokens = await exchangeGoogleCode(code, getGoogleRedirectUri(origin));
    const profile = await fetchGoogleUserInfo(tokens.access_token);

    await upsertGoogleSender({
      userId: user.id,
      accountId: profile.sub,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      refreshToken: tokens.refresh_token,
      scope: tokens.scope
    });

    return NextResponse.redirect(new URL("/campaigns?gmail=connected", request.url));
  } catch (connectError) {
    const message = connectError instanceof Error ? connectError.message : "google_connect_failed";
    return NextResponse.redirect(new URL(`/campaigns?gmail_error=${encodeURIComponent(message)}`, request.url));
  }
}
