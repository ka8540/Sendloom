import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { exchangeGoogleCode, fetchGoogleUserInfo, getGoogleRedirectUri } from "@/lib/google";
import { getGmailConnectUserError } from "@/lib/user-facing-errors";
import { upsertGoogleSender } from "@/services/senders";

const GOOGLE_STATE_COOKIE = "sendloom_google_oauth_state";
const GOOGLE_NEXT_COOKIE = "sendloom_google_oauth_next";

function buildRedirectUrl(requestUrl: string, nextPath: string | undefined, params: Record<string, string>) {
  const target = new URL(nextPath && nextPath.startsWith("/") ? nextPath : "/campaigns", requestUrl);

  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }

  return target;
}

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
  const nextPath = store.get(GOOGLE_NEXT_COOKIE)?.value;
  store.delete(GOOGLE_STATE_COOKIE);
  store.delete(GOOGLE_NEXT_COOKIE);

  if (error) {
    return NextResponse.redirect(buildRedirectUrl(request.url, nextPath, { gmail_error: getGmailConnectUserError(error) }));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      buildRedirectUrl(request.url, nextPath, { gmail_error: getGmailConnectUserError("state_mismatch") })
    );
  }

  try {
    const tokens = await exchangeGoogleCode(code, getGoogleRedirectUri(origin));
    const profile = await fetchGoogleUserInfo(tokens.access_token);

    const sender = await upsertGoogleSender({
      userId: user.id,
      accountId: profile.sub,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      refreshToken: tokens.refresh_token,
      scope: tokens.scope
    });

    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: "sender.connected",
      category: "SENDER",
      severity: "SUCCESS",
      target: { type: "sender", id: sender.id, name: sender.fromEmail },
      message: `Connected Gmail sender ${sender.fromEmail}.`,
      request
    });

    return NextResponse.redirect(buildRedirectUrl(request.url, nextPath, { gmail: "connected" }));
  } catch (connectError) {
    console.error("[google-connect] Gmail connection callback failed.", connectError);
    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: "sender.connect_failed",
      category: "SENDER",
      severity: "ERROR",
      message: "Gmail sender connection failed during the OAuth callback.",
      request
    });
    return NextResponse.redirect(buildRedirectUrl(request.url, nextPath, { gmail_error: getGmailConnectUserError() }));
  }
}
