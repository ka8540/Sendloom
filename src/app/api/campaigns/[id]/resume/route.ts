import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { resumeCampaign } from "@/services/campaigns";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `campaigns:resume:user:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  const run = await resumeCampaign(id, auth.user.id);
  return NextResponse.json(run ?? { message: "No paused run to resume." });
}
