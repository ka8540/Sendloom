import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { isAdminUser, normalizeUserEmail, setSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { exchangeGoogleCode, fetchGoogleUserInfo, getGoogleLoginRedirectUri } from "@/lib/google";
import { getGoogleLoginUserError } from "@/lib/user-facing-errors";

const GOOGLE_LOGIN_STATE_COOKIE = "sendloom_google_login_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  const store = await cookies();
  const expectedState = store.get(GOOGLE_LOGIN_STATE_COOKIE)?.value;
  store.delete(GOOGLE_LOGIN_STATE_COOKIE);

  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError(error))}`, request.url));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError("state_mismatch"))}`, request.url));
  }

  try {
    const tokens = await exchangeGoogleCode(code, getGoogleLoginRedirectUri(origin));
    const profile = await fetchGoogleUserInfo(tokens.access_token);

    // Reject sign-in if Google didn't verify the email. Without this an
    // attacker controlling a Google Workspace can set an unverified primary
    // email matching a victim Sendloom account, then sign in as that victim.
    if (profile.email_verified !== true) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError("email_unverified"))}`, request.url)
      );
    }

    const email = normalizeUserEmail(profile.email);

    // Do NOT silently merge a Google identity into an existing password-only
    // account. Password users must explicitly connect Google from inside their
    // account (via /api/auth/google/connect).
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.passwordHash) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError("password_account_exists"))}`, request.url)
      );
    }

    const user = existing
      ? existing
      : await prisma.user.create({
          data: {
            email
          }
        });

    await setSession(email);
    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: existing ? "auth.google_login" : "auth.google_signup",
      category: existing ? "AUTH" : "USER",
      severity: "SUCCESS",
      message: existing ? "Signed in with Google." : "Account created with Google sign-in.",
      request
    });
    return NextResponse.redirect(new URL(isAdminUser(user) ? "/admin" : "/workspace", request.url));
  } catch (loginError) {
    console.error("[google-login] Google sign-in callback failed.", loginError);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError())}`, request.url));
  }
}
