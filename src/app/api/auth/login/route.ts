import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit";
import { isAdminUser, normalizeUserEmail, setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";
import { ensureBootstrapData } from "@/services/seed";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const ipLimit = await rateLimit({ key: `auth:login:ip:${ip}`, limit: 10, windowSeconds: 60 });
  if (!ipLimit.allowed) {
    return createRateLimitResponse(ipLimit.retryAfterSeconds);
  }

  await ensureBootstrapData();
  const payload = schema.parse(await request.json());
  const email = normalizeUserEmail(payload.email);

  const emailLimit = await rateLimit({ key: `auth:login:email:${email}`, limit: 5, windowSeconds: 60 });
  if (!emailLimit.allowed) {
    return createRateLimitResponse(emailLimit.retryAfterSeconds);
  }

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (user && !user.passwordHash) {
    return NextResponse.json({ error: "This account uses Google sign-in. Continue with Google instead." }, { status: 401 });
  }

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const valid = await verifyPassword(payload.password, user.passwordHash);
  if (!valid) {
    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: "auth.login_failed",
      category: "AUTH",
      severity: "WARNING",
      message: "Password sign-in failed (invalid credentials).",
      request
    });
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  if (user.eligibilityBlockedAt) {
    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: "auth.login_blocked",
      category: "SECURITY",
      severity: "WARNING",
      message: "Blocked sign-in for an ineligible account.",
      request
    });
    return NextResponse.json({ error: "This account is not eligible to use Sendloom." }, { status: 403 });
  }

  await setSession(email);
  await recordAuditEvent({
    actor: { id: user.id, email: user.email },
    action: "auth.login",
    category: "AUTH",
    severity: "SUCCESS",
    message: "Signed in with email and password.",
    request
  });
  return NextResponse.json({
    success: true,
    redirectTo: isAdminUser(user) ? "/admin" : "/workspace"
  });
}
