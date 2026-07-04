import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { enqueueCampaignForExecutionSlot, processPendingCampaignWork } from "@/services/campaigns";

export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser("campaignLaunch");
  if ("response" in auth) return auth.response;

  const limit = await rateLimit({
    key: `campaigns:wait-for-slot:user:${auth.user.id}`,
    limit: 20,
    windowSeconds: 60
  });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  const { id } = await context.params;
  const result = await enqueueCampaignForExecutionSlot(id, auth.user.id);

  if (result.status === "STARTED") {
    after(async () => {
      await processPendingCampaignWork({ runId: result.run.id, maxDurationMs: 55_000 });
    });
  }

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: result.status === "STARTED" ? "sequence.launched" : "sequence.waiting_for_slot",
    category: "SEQUENCE",
    severity: "SUCCESS",
    target: { type: "sequence", id },
    message:
      result.status === "STARTED"
        ? "Sequence started when an execution slot became available."
        : "Sequence waiting for an execution slot.",
    metadata: { runId: result.run.id },
    request
  });

  return NextResponse.json({ status: result.status, runId: result.run.id });
}
