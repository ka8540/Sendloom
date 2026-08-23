import { NextResponse } from "next/server";
import { z } from "zod";

import { PASSWORD_UPDATE_SUCCESS_MESSAGE } from "@/lib/account";
import { requireApiUser } from "@/lib/api-auth";
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
  return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 410 });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response ?? NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit verification code." }, { status: 400 });
  }

  const ip = getClientIp(request);
  const [ipLimit, userLimit, challengeLimit] = await Promise.all([
    rateLimit({ key: `account:password:verify:ip:${ip}`, limit: 30, windowSeconds: 60 * 15 }),
    rateLimit({ key: `account:password:verify:user:${auth.user.id}`, limit: 15, windowSeconds: 60 * 15 }),
    rateLimit({
      key: `account:password:verify:challenge:${parsed.data.challengeId}`,
      limit: 10,
      windowSeconds: 60 * 15
    })
  ]);
  if (!ipLimit.allowed || !userLimit.allowed || !challengeLimit.allowed) {
    return createRateLimitResponse(
      Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds, challengeLimit.retryAfterSeconds)
    );
  }

  const auditChallenge = await getAuthOtpChallengeForContext(
    parsed.data.challengeId,
    "PASSWORD_CHANGE",
    auth.user.id
  );
  const result = await verifyAndConsumeAuthOtpChallenge({
    challengeId: parsed.data.challengeId,
    purpose: "PASSWORD_CHANGE",
    code: parsed.data.code,
    userId: auth.user.id
  });
  if (!result.ok) {
    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: "auth.password_verification_failed",
      category: "AUTH",
      severity: "WARNING",
      message: "Password change email verification failed.",
      request
    });
    return verificationError(result.reason);
  }

  if (
    result.challenge.purpose !== "PASSWORD_CHANGE" ||
    result.challenge.userId !== auth.user.id ||
    !auditChallenge
  ) {
    return verificationError("context_mismatch");
  }

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { passwordHash: result.challenge.newPasswordHash }
  });
  await setSession(auth.user.email);

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: result.challenge.hadPassword ? "auth.password_changed" : "auth.password_set",
    category: "AUTH",
    severity: "SUCCESS",
    message: result.challenge.hadPassword
      ? "Password changed after email verification."
      : "Password set for a Google-based account after email verification.",
    request
  });

  return NextResponse.json({ success: true, message: PASSWORD_UPDATE_SUCCESS_MESSAGE });
}
