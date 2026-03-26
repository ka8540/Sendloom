import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { validateCampaign } from "@/services/campaigns";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const { id } = await context.params;
  const report = await validateCampaign(id, user.id);
  return NextResponse.json(report);
}
