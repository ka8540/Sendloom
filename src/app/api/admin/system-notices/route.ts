import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { readJsonBody, systemNoticeErrorResponse } from "@/lib/system-notice-api";
import { systemNoticeInputSchema } from "@/lib/system-notices";
import { createSystemNotice, listSystemNotices } from "@/services/system-notices";

export async function GET(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;

  const limit = await rateLimit({ key: `admin:system-notices:list:${auth.user.id}`, limit: 120, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  const page = Number(new URL(request.url).searchParams.get("page")) || 1;
  const activePage = Number(new URL(request.url).searchParams.get("activePage")) || 1;
  return NextResponse.json(await listSystemNotices(page, activePage));
}

export async function POST(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;

  const limit = await rateLimit({ key: `admin:system-notices:create:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  try {
    const input = systemNoticeInputSchema.parse(body.body);
    const notice = await createSystemNotice(input, { id: auth.user.id, email: auth.user.email }, request);
    return NextResponse.json(notice, { status: 201 });
  } catch (error) {
    return systemNoticeErrorResponse(error);
  }
}
