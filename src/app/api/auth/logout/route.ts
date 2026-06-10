import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { clearSession, getSessionUser } from "@/lib/auth";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = await rateLimit({ key: `auth:logout:ip:${ip}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  // Resolve the user before the session cookie is cleared so the sign-out is
  // attributable in the audit log.
  const user = await getSessionUser().catch(() => null);

  await clearSession();

  if (user) {
    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: "auth.logout",
      category: "AUTH",
      message: "Signed out.",
      request
    });
  }

  return NextResponse.json({ success: true });
}
