import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { validateCampaign } from "@/services/campaigns";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `campaigns:validate:user:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  const report = await validateCampaign(id, auth.user.id);

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "sequence.validation_refreshed",
    category: "SEQUENCE",
    target: { type: "sequence", id },
    message: "Refreshed sequence validation.",
    metadata: report.summary ? { summary: report.summary } : undefined,
    request
  });

  return NextResponse.json(report);
}
