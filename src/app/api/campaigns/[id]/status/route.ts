import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getCampaignStatus, processPendingCampaignWork } from "@/services/campaigns";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  after(async () => {
    await processPendingCampaignWork({
      campaignId: id,
      maxDurationMs: 25_000
    });
  });
  return NextResponse.json(await getCampaignStatus(id, user.id));
}
