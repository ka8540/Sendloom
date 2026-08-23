import { NextResponse } from "next/server";
import { z } from "zod";

import { sendAuthVerificationCode } from "@/lib/auth-email";
import {
  createAuthOtpChallenge,
  createAuthOtpSubjectKey,
  deleteAuthOtpChallenge
} from "@/lib/auth-otp";
import { recordAuditEvent } from "@/lib/audit";
import { createPasswordHash, normalizeUserEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8)
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"]
  });

const SIGNUP_START_ERROR = "We couldn't send a verification code. Try again shortly.";

export async function POST(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const limit = await rateLimit({ key: `auth:signup:ip:${ip}`, limit: 5, windowSeconds: 60 * 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Enter a valid email and password.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const email = normalizeUserEmail(parsed.data.email);
  let subjectKey: string;
  try {
    subjectKey = createAuthOtpSubjectKey(email);
  } catch {
    console.error("[auth-otp] Signup verification configuration is unavailable.");
    return NextResponse.json({ error: SIGNUP_START_ERROR }, { status: 503 });
  }

  const emailLimit = await rateLimit({
    key: `auth:signup:email:${subjectKey}`,
    limit: 5,
    windowSeconds: 60 * 15
  });
  if (!emailLimit.allowed) {
    return createRateLimitResponse(emailLimit.retryAfterSeconds);
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser?.passwordHash) {
    return NextResponse.json({ error: "An account with that email already exists. Sign in instead." }, { status: 409 });
  }
  if (existingUser && !existingUser.passwordHash) {
    return NextResponse.json(
      { error: "That email already has a Google-based account. Continue with Google to sign in." },
      { status: 409 }
    );
  }

  let challengeId: string | null = null;
  try {
    const passwordHash = await createPasswordHash(parsed.data.password);
    const pending = await createAuthOtpChallenge({ purpose: "SIGNUP", normalizedEmail: email, passwordHash });
    challengeId = pending.challengeId;
    await sendAuthVerificationCode({ to: email, purpose: "SIGNUP", code: pending.code });

    await recordAuditEvent({
      actor: { email },
      action: "auth.signup_verification_sent",
      category: "AUTH",
      severity: "INFO",
      message: "Signup email verification sent.",
      request
    });

    return NextResponse.json({ success: true, requiresVerification: true, ...pending.metadata });
  } catch {
    if (challengeId) {
      await deleteAuthOtpChallenge(challengeId).catch(() => undefined);
    }
    console.error("[auth-otp] Signup verification could not be started.");
    return NextResponse.json({ error: SIGNUP_START_ERROR }, { status: 503 });
  }
}
