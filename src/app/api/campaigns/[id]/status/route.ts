import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getCampaignStatus } from "@/services/campaigns";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  return NextResponse.json(await getCampaignStatus(id, user.id));
}
