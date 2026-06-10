import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { searchActivityUsers } from "@/services/admin-activity";

export async function GET(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `admin:users:search:${auth.user.id}`, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";
  const users = await searchActivityUsers(query.slice(0, 120));

  return NextResponse.json({ users });
}
