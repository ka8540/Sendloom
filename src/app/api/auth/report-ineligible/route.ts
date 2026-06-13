import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { clearSession, getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      eligibilityBlockedAt: now,
      eligibilityBlockedReason: "self_reported_underage"
    }
  });

  await recordAuditEvent({
    actor: { id: user.id, email: user.email },
    action: "compliance.eligibility_blocked",
    category: "SECURITY",
    severity: "WARNING",
    message: "User self-reported as ineligible (under 18). Account blocked.",
    request
  });

  await clearSession();

  return NextResponse.json({
    blocked: true,
    message: "Sendloom is not available to users under 18."
  });
}
