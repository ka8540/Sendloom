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
    const googleSub = profile.sub;
    if (!googleSub) {
      throw new Error("Google profile did not include a subject identifier.");
    }

    // Resolve by the stable Google identity first, then by the verified
    // email. A password on the account never blocks Google sign-in; both
    // methods stay valid on the same User.
    const linkedUser = await prisma.user.findUnique({ where: { googleSub } });
    const emailUser = linkedUser ? null : await prisma.user.findUnique({ where: { email } });
    const existing = linkedUser ?? emailUser;

    if (existing?.eligibilityBlockedAt) {
      await recordAuditEvent({
        actor: { id: existing.id, email: existing.email },
        action: "auth.google_login_blocked",
        category: "SECURITY",
        severity: "WARNING",
        message: "Blocked Google sign-in for an ineligible account.",
        request
      });
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError("account_ineligible"))}`, request.url)
      );
    }

    let user = linkedUser;
    let linkedNow = false;
    let isNewUser = false;

    if (!user && emailUser) {
      // Attach the verified Google identity to the existing account,
      // preserving the password. The googleSub-null guard plus the unique
      // index make concurrent callbacks safe: only one writer can claim the
      // identity, and a passwordHash is never touched.
      try {
        const link = await prisma.user.updateMany({
          where: { id: emailUser.id, googleSub: null },
          data: { googleSub }
        });
        if (link.count === 1) {
          user = { ...emailUser, googleSub };
          linkedNow = true;
        }
      } catch {
        // Unique conflict — settled by the owner lookup below.
      }

      if (!user) {
        const owner = await prisma.user.findUnique({ where: { googleSub } });
        if (owner?.id === emailUser.id) {
          // A concurrent callback linked the same identity to this account.
          user = owner;
        } else {
          // Fail closed: never overwrite or reassign a Google identity.
          await recordAuditEvent({
            actor: { id: emailUser.id, email: emailUser.email },
            action: "auth.google_identity_conflict",
            category: "SECURITY",
            severity: "WARNING",
            message: "Rejected Google sign-in that conflicted with an existing linked identity.",
            request
          });
          return NextResponse.redirect(
            new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError())}`, request.url)
          );
        }
      }
    }

    if (!user) {
      try {
        user = await prisma.user.create({
          data: { email, googleSub }
        });
        isNewUser = true;
      } catch (createError) {
        const owner = await prisma.user.findUnique({ where: { googleSub } });
        if (owner) {
          await recordAuditEvent({
            actor: { id: owner.id, email: owner.email },
            action: "auth.google_identity_conflict",
            category: "SECURITY",
            severity: "WARNING",
            message: "Rejected Google signup that conflicted with an existing linked identity.",
            request
          });
          return NextResponse.redirect(
            new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError())}`, request.url)
          );
        }
        throw createError;
      }
    }

    await setSession(email);
    if (linkedNow) {
      await recordAuditEvent({
        actor: { id: user.id, email: user.email },
        action: "auth.google_identity_linked",
        category: "AUTH",
        severity: "SUCCESS",
        message: "Linked Google sign-in to the existing account.",
        request
      });
    }
    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: isNewUser ? "auth.google_signup" : "auth.google_login",
      category: isNewUser ? "USER" : "AUTH",
      severity: "SUCCESS",
      message: isNewUser ? "Account created with Google sign-in." : "Signed in with Google.",
      request
    });
    return NextResponse.redirect(new URL(isAdminUser(user) ? "/admin" : "/workspace", request.url));
  } catch (loginError) {
    console.error("[google-login] Google sign-in callback failed.", loginError);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(getGoogleLoginUserError())}`, request.url));
  }
}
