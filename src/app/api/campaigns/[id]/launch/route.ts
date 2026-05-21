import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { CampaignLaunchBlockedError, launchCampaign, processPendingCampaignWork } from "@/services/campaigns";

export const maxDuration = 60;

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser("campaignLaunch");
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `campaigns:launch:user:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  let run;
  try {
    run = await launchCampaign(id, auth.user.id);
  } catch (error) {
    if (error instanceof CampaignLaunchBlockedError) {
      return NextResponse.json(
        {
          error: error.message,
          validation: error.report
        },
        { status: 409 }
      );
    }

    throw error;
  }
  after(async () => {
    await processPendingCampaignWork({
      runId: run.id,
      maxDurationMs: 55_000
    });
  });
  await writeAuditLog({
    actorEmail: auth.user.email,
    action: "campaign.launch",
    entityType: "campaign",
    entityId: id,
    metadata: { runId: run.id }
  });
  return NextResponse.json(run);
}
