import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { pauseCampaign } from "@/services/campaigns";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const run = await pauseCampaign(id, auth.user.id);
  return NextResponse.json(run ?? { message: "No active run to pause." });
}
