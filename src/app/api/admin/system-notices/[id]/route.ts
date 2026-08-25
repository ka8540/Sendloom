import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { readJsonBody, systemNoticeErrorResponse } from "@/lib/system-notice-api";
import { systemNoticeInputSchema } from "@/lib/system-notices";
import { getSystemNotice, updateSystemNotice } from "@/services/system-notices";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  const notice = await getSystemNotice(id);
  return notice
    ? NextResponse.json(notice)
    : NextResponse.json({ error: "System notice not found." }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;

  const limit = await rateLimit({ key: `admin:system-notices:update:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  try {
    const input = systemNoticeInputSchema.parse(body.body);
    const { id } = await context.params;
    return NextResponse.json(
      await updateSystemNotice(id, input, { id: auth.user.id, email: auth.user.email }, request)
    );
  } catch (error) {
    return systemNoticeErrorResponse(error);
  }
}
