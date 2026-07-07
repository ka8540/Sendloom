import { NextResponse } from "next/server";

import { SENDER_REMOVAL_HTTP_STATUS, SENDER_REMOVAL_MESSAGES } from "@/lib/account";
import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { removeUserSender } from "@/services/account";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const result = await removeUserSender(auth.user.id, id);

  if (!result.ok) {
    return NextResponse.json(
      { error: SENDER_REMOVAL_MESSAGES[result.reason] },
      { status: SENDER_REMOVAL_HTTP_STATUS[result.reason] }
    );
  }

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "sender.removed",
    category: "SENDER",
    severity: "INFO",
    target: { type: "sender", id, name: result.fromEmail },
    message:
      result.mode === "deleted"
        ? `Removed connected Gmail sender ${result.fromEmail}.`
        : `Disconnected Gmail sender ${result.fromEmail} (sequence history retained).`,
    metadata: { mode: result.mode },
    request
  });

  return NextResponse.json({ success: true, mode: result.mode });
}
