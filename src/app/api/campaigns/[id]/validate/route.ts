import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { validateCampaign } from "@/services/campaigns";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const report = await validateCampaign(id, auth.user.id);
  return NextResponse.json(report);
}
