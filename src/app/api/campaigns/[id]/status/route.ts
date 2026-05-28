import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getCampaignStatus, processPendingCampaignWork } from "@/services/campaigns";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;

  // Verify ownership BEFORE scheduling background work so a random
  // authenticated user cannot trigger campaign processing for arbitrary IDs.
  const owned = await prisma.campaign.findFirst({
    where: { id, userId: auth.user.id },
    select: { id: true }
  });
  if (!owned) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  after(async () => {
    await processPendingCampaignWork({
      campaignId: id,
      maxDurationMs: 25_000
    });
  });
  return NextResponse.json(await getCampaignStatus(id, auth.user.id));
}
