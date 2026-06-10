import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { resumeCampaign } from "@/services/campaigns";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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

  if (run) {
    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: "sequence.resumed",
      category: "SEQUENCE",
      target: { type: "sequence", id },
      message: "Resumed a paused sequence run.",
      metadata: { runId: run.id },
      request
    });
  }

  return NextResponse.json(run ?? { message: "No paused run to resume." });
}
