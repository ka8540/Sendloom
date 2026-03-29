import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { getCampaignStatus, processPendingCampaignWork } from "@/services/campaigns";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  after(async () => {
    await processPendingCampaignWork({
      campaignId: id,
      maxDurationMs: 25_000
    });
  });
  return NextResponse.json(await getCampaignStatus(id, auth.user.id));
}
