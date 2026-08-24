import { NextResponse } from "next/server";
import { z } from "zod";

import { sendAuthVerificationCode } from "@/lib/auth-email";
import { createAuthOtpChallenge, createAuthOtpSubjectKey } from "@/lib/auth-otp";
import { recordAuditEvent } from "@/lib/audit";
import { normalizeUserEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z
  .object({
    email: z.string().trim().max(320).email()
  })
  .strict();

const PUBLIC_MESSAGE = "If an account exists for that email, we've sent a verification code.";
const START_ERROR = "We couldn't start password recovery. Try again shortly.";

export async function POST(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const ipLimit = await rateLimit({
    key: `auth:password-reset:request:ip:${ip}`,
    limit: 5,
    windowSeconds: 60 * 15
  });
  if (!ipLimit.allowed) {
    return createRateLimitResponse(ipLimit.retryAfterSeconds);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const normalizedEmail = normalizeUserEmail(parsed.data.email);
  let subjectKey: string;
  try {
    subjectKey = createAuthOtpSubjectKey(normalizedEmail);
  } catch {
    console.error("[auth-otp] Password reset verification configuration is unavailable.");
    return NextResponse.json({ error: START_ERROR }, { status: 503 });
  }

  const emailLimit = await rateLimit({
    key: `auth:password-reset:request:email:${subjectKey}`,
    limit: 3,
    windowSeconds: 60 * 15
  });
  if (!emailLimit.allowed) {
    return createRateLimitResponse(emailLimit.retryAfterSeconds);
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, isAdmin: true }
  });

  // Bootstrap-admin passwords are restored from ADMIN_PASSWORD during login,
  // so public recovery cannot safely change them. Treat them exactly like an
  // unknown address: create a non-authorizing decoy and reveal nothing.
  const resettableUser = user && !user.isAdmin ? user : null;

  try {
    const pending = await createAuthOtpChallenge({
      purpose: "PASSWORD_RESET",
      normalizedEmail,
      userId: resettableUser?.id ?? null
    });

    if (resettableUser) {
      try {
        await sendAuthVerificationCode({
          to: resettableUser.email,
          purpose: "PASSWORD_RESET",
          code: pending.code
        });
        await recordAuditEvent({
          actor: { id: resettableUser.id, email: resettableUser.email },
          action: "auth.password_reset_verification_sent",
          category: "AUTH",
          severity: "INFO",
          message: "Password reset email verification sent.",
          request
        });
      } catch {
        // Keep the same public response and challenge behavior as the decoy
        // path. The user can retry or resend without this becoming an account
        // existence oracle when the email provider is unavailable.
        console.error("[auth-email] Password reset verification delivery was unavailable.");
      }
    }

    return NextResponse.json({
      success: true,
      requiresVerification: true,
      message: PUBLIC_MESSAGE,
      ...pending.metadata
    });
  } catch {
    console.error("[auth-otp] Password reset verification could not be started.");
    return NextResponse.json({ error: START_ERROR }, { status: 503 });
  }
}
