import { NextResponse } from "next/server";
import { z } from "zod";

import {
  PASSWORD_UPDATE_ERROR_MESSAGE,
  PASSWORD_UPDATE_SUCCESS_MESSAGE,
  validatePasswordChange
} from "@/lib/account";
import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { createPasswordHash, setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string(),
  confirmPassword: z.string()
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const ip = getClientIp(request);
  const ipLimit = await rateLimit({ key: `account:password:ip:${ip}`, limit: 10, windowSeconds: 60 * 15 });
  if (!ipLimit.allowed) {
    return createRateLimitResponse(ipLimit.retryAfterSeconds);
  }

  const userLimit = await rateLimit({ key: `account:password:user:${auth.user.id}`, limit: 5, windowSeconds: 60 * 15 });
  if (!userLimit.allowed) {
    return createRateLimitResponse(userLimit.retryAfterSeconds);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: PASSWORD_UPDATE_ERROR_MESSAGE }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
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

  // Changing an existing password requires proving the current one. A wrong
  // password returns only the generic safe message (never confirming which
  // field failed).
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

  const passwordHash = await createPasswordHash(parsed.data.newPassword);
  await prisma.user.update({ where: { id: auth.user.id }, data: { passwordHash } });

  // Rotate the session: advances sessionIssuedAt (revoking older JWTs) and
  // re-issues a fresh cookie so the current browser stays signed in.
  await setSession(auth.user.email);

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: hasPassword ? "auth.password_changed" : "auth.password_set",
    category: "AUTH",
    severity: "SUCCESS",
    message: hasPassword
      ? "Password changed from account settings."
      : "Password set for a Google-based account.",
    request
  });

  return NextResponse.json({ success: true, message: PASSWORD_UPDATE_SUCCESS_MESSAGE });
}
