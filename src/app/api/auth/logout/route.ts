import { NextResponse } from "next/server";

import { clearSession } from "@/lib/auth";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = await rateLimit({ key: `auth:logout:ip:${ip}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  await clearSession();
  return NextResponse.json({ success: true });
}
