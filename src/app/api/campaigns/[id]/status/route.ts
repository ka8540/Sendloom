import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { getCampaignStatus, getOwnedCampaignReference, processUserCampaignWork } from "@/services/campaigns";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const campaign = await getOwnedCampaignReference(id, auth.user.id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  after(async () => {
    await processUserCampaignWork({
      userId: auth.user.id,
      campaignId: id,
      maxDurationMs: 25_000
    });
  });
  return NextResponse.json(await getCampaignStatus(id, auth.user.id));
}
