import { after } from "next/server";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { getCampaignStatus, processPendingCampaignWork } from "@/services/campaigns";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const { id } = await context.params;
  after(async () => {
    await processPendingCampaignWork({
      campaignId: id,
      maxDurationMs: 25_000
    });
  });
  return NextResponse.json(await getCampaignStatus(id, user.id));
}
