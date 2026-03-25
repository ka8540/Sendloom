import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { validateCampaign } from "@/services/campaigns";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const report = await validateCampaign(id, user.id);
  return NextResponse.json(report);
}
