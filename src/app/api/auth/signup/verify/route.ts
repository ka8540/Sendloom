import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getAuthOtpChallengeForContext,
  verifyAndConsumeAuthOtpChallenge
} from "@/lib/auth-otp";
import { recordAuditEvent } from "@/lib/audit";
import { setSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  challengeId: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
  code: z.string().regex(/^\d{6}$/)
});

function verificationError(reason: string) {
  if (reason === "invalid") {
    return NextResponse.json({ error: "That code is incorrect. Try again." }, { status: 400 });
  }
  if (reason === "exhausted") {
    return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
  }
  return NextResponse.json({ error: "That code has expired. Send a new one." }, { status: 410 });
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export async function POST(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const ipLimit = await rateLimit({ key: `auth:signup:verify:ip:${ip}`, limit: 30, windowSeconds: 60 * 15 });
  if (!ipLimit.allowed) {
    return createRateLimitResponse(ipLimit.retryAfterSeconds);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit verification code." }, { status: 400 });
  }

  const challengeLimit = await rateLimit({
    key: `auth:signup:verify:challenge:${parsed.data.challengeId}`,
    limit: 10,
    windowSeconds: 60 * 15
  });
  if (!challengeLimit.allowed) {
    return createRateLimitResponse(challengeLimit.retryAfterSeconds);
  }

  const auditChallenge = await getAuthOtpChallengeForContext(parsed.data.challengeId, "SIGNUP");
  const result = await verifyAndConsumeAuthOtpChallenge({
    challengeId: parsed.data.challengeId,
    purpose: "SIGNUP",
    code: parsed.data.code
  });
  if (!result.ok) {
    if (auditChallenge) {
      await recordAuditEvent({
        actor: { email: auditChallenge.normalizedEmail },
        action: "auth.signup_verification_failed",
        category: "AUTH",
        severity: "WARNING",
        message: "Signup email verification failed.",
        request
      });
    }
    return verificationError(result.reason);
  }

  if (result.challenge.purpose !== "SIGNUP") {
    return verificationError("context_mismatch");
  }

  const { normalizedEmail: email, passwordHash } = result.challenge;
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "An account with that email already exists. Sign in instead." }, { status: 409 });
  }

  try {
    // Signup never grants admin. Admin bootstrap remains confined to its
    // existing login/bootstrap path.
    const user = await prisma.user.create({ data: { email, passwordHash } });
    await setSession(user.email);
    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: "auth.signup_verified",
      category: "USER",
      severity: "SUCCESS",
      message: "Account created after email verification.",
      request
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "An account with that email already exists. Sign in instead." }, { status: 409 });
    }
    throw error;
  }
}
