import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { systemNoticeErrorResponse } from "@/lib/system-notice-api";
import { requestSystemNoticeSendNow } from "@/services/system-notices";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;

  const limit = await rateLimit({ key: `admin:system-notices:send-now:${auth.user.id}`, limit: 3, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  try {
    const { id } = await context.params;
    return NextResponse.json(
      await requestSystemNoticeSendNow(id, { id: auth.user.id, email: auth.user.email }, request)
    );
  } catch (error) {
    return systemNoticeErrorResponse(error);
  }
}
