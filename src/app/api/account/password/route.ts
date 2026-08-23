import { NextResponse } from "next/server";
import { z } from "zod";

import { PASSWORD_UPDATE_ERROR_MESSAGE, validatePasswordChange } from "@/lib/account";
import { requireApiUser } from "@/lib/api-auth";
import { sendAuthVerificationCode } from "@/lib/auth-email";
import {
  createAuthOtpChallenge,
  createAuthOtpSubjectKey,
  deleteAuthOtpChallenge
} from "@/lib/auth-otp";
import { recordAuditEvent } from "@/lib/audit";
import { createPasswordHash, verifyPassword } from "@/lib/auth";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string(),
  confirmPassword: z.string()
});

const PASSWORD_START_ERROR = "We couldn't send a verification code. Try again shortly.";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response ?? NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const ip = getClientIp(request);
  const [ipLimit, userLimit] = await Promise.all([
    rateLimit({ key: `account:password:ip:${ip}`, limit: 10, windowSeconds: 60 * 15 }),
    rateLimit({ key: `account:password:user:${auth.user.id}`, limit: 5, windowSeconds: 60 * 15 })
  ]);
  if (!ipLimit.allowed || !userLimit.allowed) {
    return createRateLimitResponse(Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds));
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: PASSWORD_UPDATE_ERROR_MESSAGE }, { status: 400 });
  }

  const hasPassword = Boolean(auth.user.passwordHash);
  const currentPassword = parsed.data.currentPassword ?? "";
  const validation = validatePasswordChange({
    hasPassword,
    currentPassword,
    newPassword: parsed.data.newPassword,
    confirmPassword: parsed.data.confirmPassword
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 400 });
  }

  if (hasPassword) {
    const valid = auth.user.passwordHash
      ? await verifyPassword(currentPassword, auth.user.passwordHash)
      : false;
    if (!valid) {
      await recordAuditEvent({
        actor: { id: auth.user.id, email: auth.user.email },
        action: "auth.password_change_failed",
        category: "AUTH",
        severity: "WARNING",
        message: "Password change failed: the current password did not match.",
        request
      });
      return NextResponse.json({ error: PASSWORD_UPDATE_ERROR_MESSAGE }, { status: 400 });
    }
  }

  let emailKey: string;
  try {
    emailKey = createAuthOtpSubjectKey(auth.user.email);
  } catch {
    console.error("[auth-otp] Password verification configuration is unavailable.");
    return NextResponse.json({ error: PASSWORD_START_ERROR }, { status: 503 });
  }
  const emailLimit = await rateLimit({
    key: `account:password:email:${emailKey}`,
    limit: 5,
    windowSeconds: 60 * 15
  });
  if (!emailLimit.allowed) {
    return createRateLimitResponse(emailLimit.retryAfterSeconds);
  }

  let challengeId: string | null = null;
  try {
    const newPasswordHash = await createPasswordHash(parsed.data.newPassword);
    const pending = await createAuthOtpChallenge({
      purpose: "PASSWORD_CHANGE",
      normalizedEmail: auth.user.email,
      userId: auth.user.id,
      newPasswordHash,
      hadPassword: hasPassword
    });
    challengeId = pending.challengeId;
    await sendAuthVerificationCode({
      to: auth.user.email,
      purpose: "PASSWORD_CHANGE",
      code: pending.code
    });

    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: "auth.password_verification_sent",
      category: "AUTH",
      severity: "INFO",
      message: "Password change email verification sent.",
      request
    });

    return NextResponse.json({ success: true, requiresVerification: true, ...pending.metadata });
  } catch {
    if (challengeId) {
      await deleteAuthOtpChallenge(challengeId).catch(() => undefined);
    }
    console.error("[auth-otp] Password verification could not be started.");
    return NextResponse.json({ error: PASSWORD_START_ERROR }, { status: 503 });
  }
}
