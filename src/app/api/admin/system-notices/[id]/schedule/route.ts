import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { readJsonBody, systemNoticeErrorResponse } from "@/lib/system-notice-api";
import { scheduleSystemNoticeSchema } from "@/lib/system-notices";
import { scheduleSystemNotice } from "@/services/system-notices";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;

  const limit = await rateLimit({ key: `admin:system-notices:schedule:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  try {
    const input = scheduleSystemNoticeSchema.parse(body.body);
    const { id } = await context.params;
    return NextResponse.json(
      await scheduleSystemNotice(
        id,
        input.scheduledSendAt,
        input.timeZone,
        { id: auth.user.id, email: auth.user.email },
        request
      )
    );
  } catch (error) {
    return systemNoticeErrorResponse(error);
  }
}
