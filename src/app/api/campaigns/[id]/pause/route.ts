import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { pauseCampaign } from "@/services/campaigns";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `campaigns:pause:user:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  const run = await pauseCampaign(id, auth.user.id);

  if (run) {
    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: "sequence.paused",
      category: "SEQUENCE",
      target: { type: "sequence", id },
      message: "Paused a sequence run.",
      metadata: { runId: run.id },
      request
    });
  }

  return NextResponse.json(run ?? { message: "No active run to pause." });
}
