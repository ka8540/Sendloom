import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { deleteCampaign } from "@/services/campaigns";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const result = await deleteCampaign(id, auth.user.id);
  await writeAuditLog({
    actorEmail: auth.user.email,
    action: "campaign.delete",
    entityType: "campaign",
    entityId: id
  });

  return NextResponse.json(result);
}
