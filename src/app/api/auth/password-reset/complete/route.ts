import { NextResponse } from "next/server";
import { z } from "zod";

import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE
} from "@/lib/account";
import { recordAuditEvent } from "@/lib/audit";
import { createPasswordHash, normalizeUserEmail, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  consumePasswordResetGrant,
  createPasswordResetGrantDigest
} from "@/lib/password-reset";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const MAX_PASSWORD_LENGTH = 1024;
const bodySchema = z
  .object({
    resetGrant: z.string().max(256),
    newPassword: z.string().max(MAX_PASSWORD_LENGTH),
    confirmPassword: z.string().max(MAX_PASSWORD_LENGTH)
  })
  .strict();
const grantSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]+$/);

const EXPIRED_MESSAGE = "This password reset has expired. Start again.";
const COMPLETE_ERROR = "We couldn't reset your password. Start password recovery again.";
const PASSWORD_REUSE_ERROR =
  "Your new password must be different from your current password. Start password recovery again.";

function expiredResponse() {
  return NextResponse.json({ error: EXPIRED_MESSAGE }, { status: 410 });
}

export async function POST(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const ipLimit = await rateLimit({
    key: `auth:password-reset:complete:ip:${ip}`,
    limit: 10,
    windowSeconds: 60 * 15
  });
  if (!ipLimit.allowed) {
    return createRateLimitResponse(ipLimit.retryAfterSeconds);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid new password and confirmation." }, { status: 400 });
  }
  if (!grantSchema.safeParse(parsed.data.resetGrant).success) {
    return expiredResponse();
  }
  if (parsed.data.newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: PASSWORD_TOO_SHORT_MESSAGE }, { status: 400 });
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return NextResponse.json({ error: PASSWORD_MISMATCH_MESSAGE }, { status: 400 });
  }

  const grantLimit = await rateLimit({
    key: `auth:password-reset:complete:grant:${createPasswordResetGrantDigest(parsed.data.resetGrant)}`,
    limit: 5,
    windowSeconds: 60 * 15
  });
  if (!grantLimit.allowed) {
    return createRateLimitResponse(grantLimit.retryAfterSeconds);
  }

  let consumed: Awaited<ReturnType<typeof consumePasswordResetGrant>>;
  try {
    consumed = await consumePasswordResetGrant(parsed.data.resetGrant);
  } catch {
    console.error("[password-reset] Reset grant storage was unavailable.");
    return NextResponse.json({ error: COMPLETE_ERROR }, { status: 503 });
  }
  if (!consumed.ok) {
    return expiredResponse();
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: consumed.grant.userId },
      select: { id: true, email: true, isAdmin: true, passwordHash: true }
    });
    if (
      !user ||
      user.isAdmin ||
      normalizeUserEmail(user.email) !== consumed.grant.normalizedEmail
    ) {
      return expiredResponse();
    }

    const reusesCurrentPassword = user.passwordHash
      ? await verifyPassword(parsed.data.newPassword, user.passwordHash)
      : false;
    if (reusesCurrentPassword) {
      // The grant was intentionally consumed before checking the existing
      // credential. Reusing it as a password oracle or retry credential is not
      // allowed; the user must begin a fresh recovery flow.
      return NextResponse.json(
        { error: PASSWORD_REUSE_ERROR, restartRequired: true },
        { status: 409 }
      );
    }

    const passwordHash = await createPasswordHash(parsed.data.newPassword);
    const revokedAt = new Date();
    const updated = await prisma.user.updateMany({
      where: {
        id: user.id,
        email: user.email,
        isAdmin: false,
        passwordHash: user.passwordHash
      },
      data: {
        passwordHash,
        sessionIssuedAt: revokedAt,
        sessionExpiresAt: null
      }
    });
    if (updated.count !== 1) {
      return expiredResponse();
    }

    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: "auth.password_reset_completed",
      category: "AUTH",
      severity: "SUCCESS",
      message: "Password reset completed and all existing sessions revoked.",
      request
    });

    // Deliberately do not issue a session. The user must authenticate again.
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[password-reset] Password reset completion failed after grant consumption.", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    return NextResponse.json({ error: COMPLETE_ERROR }, { status: 500 });
  }
}
