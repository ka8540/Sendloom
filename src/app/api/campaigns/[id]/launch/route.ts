import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { launchCampaign, processUserCampaignWork } from "@/services/campaigns";

export const maxDuration = 60;

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser("campaignLaunch");
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const run = await launchCampaign(id, auth.user.id);
  after(async () => {
    await processUserCampaignWork({
      userId: auth.user.id,
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
