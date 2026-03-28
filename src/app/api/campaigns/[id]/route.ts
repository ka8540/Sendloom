import { NextResponse } from "next/server";

import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { deleteCampaign } from "@/services/campaigns";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const { id } = await context.params;
  const result = await deleteCampaign(id, user.id);
  await writeAuditLog({
    actorEmail: user.email,
    action: "campaign.delete",
    entityType: "campaign",
    entityId: id
  });

  return NextResponse.json(result);
}
