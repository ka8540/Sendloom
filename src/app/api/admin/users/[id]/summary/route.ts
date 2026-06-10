import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { getActivityUserSummary } from "@/services/admin-activity";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `admin:users:summary:${auth.user.id}`, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  const summary = await getActivityUserSummary(id);

  if (!summary) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "admin.viewed_user_activity",
    category: "ADMIN",
    target: { type: "user", id: summary.id, name: summary.email },
    message: `Viewed the activity log for ${summary.email}.`,
    request
  });

  return NextResponse.json(summary);
}
