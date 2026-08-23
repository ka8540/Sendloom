import { NextResponse } from "next/server";
import { z } from "zod";

import { sendAuthVerificationCode } from "@/lib/auth-email";
import {
  createAuthOtpSubjectKey,
  deleteAuthOtpChallenge,
  getAuthOtpChallengeForContext,
  rotateAuthOtpChallenge
} from "@/lib/auth-otp";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  challengeId: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/)
});

const RESEND_ERROR = "We couldn't send a new code. Try again shortly.";

export async function POST(request: Request): Promise<Response> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: RESEND_ERROR }, { status: 400 });
  }

  const ip = getClientIp(request);
  const [ipLimit, challengeLimit] = await Promise.all([
    rateLimit({ key: `auth:signup:resend:ip:${ip}`, limit: 10, windowSeconds: 60 * 15 }),
    rateLimit({
      key: `auth:signup:resend:challenge:${parsed.data.challengeId}`,
      limit: 5,
      windowSeconds: 60 * 15
    })
  ]);
  if (!ipLimit.allowed || !challengeLimit.allowed) {
    return createRateLimitResponse(Math.max(ipLimit.retryAfterSeconds, challengeLimit.retryAfterSeconds));
  }

  const pending = await getAuthOtpChallengeForContext(parsed.data.challengeId, "SIGNUP");
  if (!pending) {
    return NextResponse.json({ error: "That code has expired. Start again to request a new one." }, { status: 410 });
  }

  let emailKey: string;
  try {
    emailKey = createAuthOtpSubjectKey(pending.normalizedEmail);
  } catch {
    return NextResponse.json({ error: RESEND_ERROR }, { status: 503 });
  }
  const emailLimit = await rateLimit({
    key: `auth:signup:resend:email:${emailKey}`,
    limit: 5,
    windowSeconds: 60 * 15
  });
  if (!emailLimit.allowed) {
    return createRateLimitResponse(emailLimit.retryAfterSeconds);
  }

  const rotated = await rotateAuthOtpChallenge({ challengeId: parsed.data.challengeId, purpose: "SIGNUP" });
  if (!rotated.ok) {
    if (rotated.reason === "cooldown") {
      return NextResponse.json(
        { error: `Wait ${rotated.retryAfterSeconds ?? 1}s before requesting another code.` },
        { status: 429, headers: { "Retry-After": String(rotated.retryAfterSeconds ?? 1) } }
      );
    }
    if (rotated.reason === "email_limit") {
      return NextResponse.json({ error: "Too many codes sent. Try again later." }, { status: 429 });
    }
    return NextResponse.json({ error: "That code has expired. Start again to request a new one." }, { status: 410 });
  }

  try {
    await sendAuthVerificationCode({
      to: rotated.challenge.normalizedEmail,
      purpose: "SIGNUP",
      code: rotated.code
    });
  } catch {
    await deleteAuthOtpChallenge(parsed.data.challengeId).catch(() => undefined);
    return NextResponse.json({ error: RESEND_ERROR }, { status: 503 });
  }

  await recordAuditEvent({
    actor: { email: rotated.challenge.normalizedEmail },
    action: "auth.signup_verification_sent",
    category: "AUTH",
    severity: "INFO",
    message: "A replacement signup verification code was sent.",
    request
  });
  return NextResponse.json({ success: true, ...rotated.metadata });
}
