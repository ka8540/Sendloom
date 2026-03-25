import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { launchCampaign, processPendingCampaignWork } from "@/services/campaigns";

export const maxDuration = 60;

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const run = await launchCampaign(id, user.id);
  after(async () => {
    await processPendingCampaignWork({
      runId: run.id,
      maxDurationMs: 55_000
    });
  });
  await writeAuditLog({
    actorEmail: user.email,
    action: "campaign.launch",
    entityType: "campaign",
    entityId: id,
    metadata: { runId: run.id }
  });
  return NextResponse.json(run);
}
