import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { sendAuthVerificationCode } from "@/lib/auth-email";
import {
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
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response ?? NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: RESEND_ERROR }, { status: 400 });
  }

  const ip = getClientIp(request);
  const [ipLimit, userLimit, challengeLimit] = await Promise.all([
    rateLimit({ key: `account:password:resend:ip:${ip}`, limit: 10, windowSeconds: 60 * 15 }),
    rateLimit({ key: `account:password:resend:user:${auth.user.id}`, limit: 5, windowSeconds: 60 * 15 }),
    rateLimit({
      key: `account:password:resend:challenge:${parsed.data.challengeId}`,
      limit: 5,
      windowSeconds: 60 * 15
    })
  ]);
  if (!ipLimit.allowed || !userLimit.allowed || !challengeLimit.allowed) {
    return createRateLimitResponse(
      Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds, challengeLimit.retryAfterSeconds)
    );
  }

  const pending = await getAuthOtpChallengeForContext(
    parsed.data.challengeId,
    "PASSWORD_CHANGE",
    auth.user.id
  );
  if (!pending) {
    return NextResponse.json({ error: "That code has expired. Start the password update again." }, { status: 410 });
  }

  const rotated = await rotateAuthOtpChallenge({
    challengeId: parsed.data.challengeId,
    purpose: "PASSWORD_CHANGE",
    userId: auth.user.id
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
    return NextResponse.json({ error: "That code has expired. Start the password update again." }, { status: 410 });
  }

  try {
    await sendAuthVerificationCode({
      to: rotated.challenge.normalizedEmail,
      purpose: "PASSWORD_CHANGE",
      code: rotated.code
    });
  } catch {
    await deleteAuthOtpChallenge(parsed.data.challengeId).catch(() => undefined);
    return NextResponse.json({ error: RESEND_ERROR }, { status: 503 });
  }

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "auth.password_verification_sent",
    category: "AUTH",
    severity: "INFO",
    message: "A replacement password change verification code was sent.",
    request
  });
  return NextResponse.json({ success: true, ...rotated.metadata });
}
