import { NextResponse } from "next/server";
import { z } from "zod";

import { sendAuthVerificationCode } from "@/lib/auth-email";
import {
  createAuthOtpSubjectKey,
  getAuthOtpChallengeForContext,
  rotateAuthOtpChallenge
} from "@/lib/auth-otp";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z
  .object({
    challengeId: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/)
  })
  .strict();

const RESEND_ERROR = "We couldn't send a new code. Try again shortly.";

export async function POST(request: Request): Promise<Response> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: RESEND_ERROR }, { status: 400 });
  }

  const ip = getClientIp(request);
  const [ipLimit, challengeLimit] = await Promise.all([
    rateLimit({ key: `auth:password-reset:resend:ip:${ip}`, limit: 10, windowSeconds: 60 * 15 }),
    rateLimit({
      key: `auth:password-reset:resend:challenge:${parsed.data.challengeId}`,
      limit: 5,
      windowSeconds: 60 * 15
    })
  ]);
  if (!ipLimit.allowed || !challengeLimit.allowed) {
    return createRateLimitResponse(Math.max(ipLimit.retryAfterSeconds, challengeLimit.retryAfterSeconds));
  }

  const pending = await getAuthOtpChallengeForContext(
    parsed.data.challengeId,
    "PASSWORD_RESET"
  );
  if (!pending || pending.purpose !== "PASSWORD_RESET") {
    return NextResponse.json({ error: "That code has expired. Start again." }, { status: 410 });
  }

  let subjectKey: string;
  try {
    subjectKey = createAuthOtpSubjectKey(pending.normalizedEmail);
  } catch {
    return NextResponse.json({ error: RESEND_ERROR }, { status: 503 });
  }
  const emailLimit = await rateLimit({
    key: `auth:password-reset:resend:email:${subjectKey}`,
    limit: 5,
    windowSeconds: 60 * 15
  });
  if (!emailLimit.allowed) {
    return createRateLimitResponse(emailLimit.retryAfterSeconds);
  }

  const rotated = await rotateAuthOtpChallenge({
    challengeId: parsed.data.challengeId,
    purpose: "PASSWORD_RESET"
  });
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
    return NextResponse.json({ error: "That code has expired. Start again." }, { status: 410 });
  }

  if (rotated.challenge.purpose !== "PASSWORD_RESET") {
    return NextResponse.json({ error: "That code has expired. Start again." }, { status: 410 });
  }

  if (rotated.challenge.userId) {
    try {
      await sendAuthVerificationCode({
        to: rotated.challenge.normalizedEmail,
        purpose: "PASSWORD_RESET",
        code: rotated.code
      });
      await recordAuditEvent({
        actor: {
          id: rotated.challenge.userId,
          email: rotated.challenge.normalizedEmail
        },
        action: "auth.password_reset_verification_sent",
        category: "AUTH",
        severity: "INFO",
        message: "A replacement password reset verification code was sent.",
        request
      });
    } catch {
      // Preserve decoy-equivalent public semantics if the provider is down.
      console.error("[auth-email] Replacement password reset delivery was unavailable.");
    }
  }

  return NextResponse.json({ success: true, ...rotated.metadata });
}
