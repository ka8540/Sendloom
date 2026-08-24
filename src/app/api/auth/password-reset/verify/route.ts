import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getAuthOtpChallengeForContext,
  verifyAndConsumeAuthOtpChallenge
} from "@/lib/auth-otp";
import { recordAuditEvent } from "@/lib/audit";
import { createPasswordResetGrant } from "@/lib/password-reset";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z
  .object({
    challengeId: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
    code: z.string().regex(/^\d{6}$/)
  })
  .strict();

function verificationError(reason: string) {
  if (reason === "invalid") {
    return NextResponse.json({ error: "That code is incorrect. Try again." }, { status: 400 });
  }
  if (reason === "exhausted") {
    return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
  }
  return NextResponse.json({ error: "That code has expired. Start again." }, { status: 410 });
}

export async function POST(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const ipLimit = await rateLimit({
    key: `auth:password-reset:verify:ip:${ip}`,
    limit: 30,
    windowSeconds: 60 * 15
  });
  if (!ipLimit.allowed) {
    return createRateLimitResponse(ipLimit.retryAfterSeconds);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit verification code." }, { status: 400 });
  }

  const challengeLimit = await rateLimit({
    key: `auth:password-reset:verify:challenge:${parsed.data.challengeId}`,
    limit: 10,
    windowSeconds: 60 * 15
  });
  if (!challengeLimit.allowed) {
    return createRateLimitResponse(challengeLimit.retryAfterSeconds);
  }

  const auditChallenge = await getAuthOtpChallengeForContext(
    parsed.data.challengeId,
    "PASSWORD_RESET"
  );
  const result = await verifyAndConsumeAuthOtpChallenge({
    challengeId: parsed.data.challengeId,
    purpose: "PASSWORD_RESET",
    code: parsed.data.code
  });

  if (!result.ok) {
    if (auditChallenge?.purpose === "PASSWORD_RESET" && auditChallenge.userId) {
      await recordAuditEvent({
        actor: { id: auditChallenge.userId, email: auditChallenge.normalizedEmail },
        action: "auth.password_reset_verification_failed",
        category: "AUTH",
        severity: "WARNING",
        message: "Password reset email verification failed.",
        request
      });
    }
    return verificationError(result.reason);
  }

  if (result.challenge.purpose !== "PASSWORD_RESET" || !result.challenge.userId) {
    // A correctly guessed decoy code is still non-authorizing. The challenge
    // has already been consumed atomically and no user or reset grant exists.
    return verificationError("invalid");
  }

  try {
    const grant = await createPasswordResetGrant({
      userId: result.challenge.userId,
      normalizedEmail: result.challenge.normalizedEmail
    });
    await recordAuditEvent({
      actor: { id: result.challenge.userId, email: result.challenge.normalizedEmail },
      action: "auth.password_reset_verified",
      category: "AUTH",
      severity: "SUCCESS",
      message: "Password reset email ownership verified.",
      request
    });
    return NextResponse.json({ success: true, resetGrant: grant.resetGrant });
  } catch {
    // The OTP is already consumed. Failing closed requires restarting instead
    // of restoring either one-time credential.
    console.error("[password-reset] A reset grant could not be issued.");
    return NextResponse.json(
      { error: "We couldn't verify that code. Start password recovery again." },
      { status: 503 }
    );
  }
}
