import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import {
  processPendingCampaignWork,
  retryFailedRecipients,
  type RetryFailedRecipientsResult
} from "@/services/campaigns";

export const maxDuration = 60;

const FAILURE_RESPONSES: Record<
  Exclude<RetryFailedRecipientsResult["status"], "ok">,
  { status: number; error: string }
> = {
  not_found: { status: 404, error: "This sequence could not be found." },
  no_failures: { status: 409, error: "There are no failed recipients to retry right now." },
  run_active: { status: 409, error: "This sequence is already sending. Wait for the run to finish before retrying." },
  paused: { status: 409, error: "Resume this sequence before retrying its failed recipients." },
  sender_disconnected: { status: 409, error: "Reconnect Gmail before retrying failed recipients." },
  daily_limit: {
    status: 409,
    error: "Gmail's daily safety limit is active. Sendloom will retry automatically when it resets."
  },
  locked: { status: 409, error: "A retry is already being prepared. Try again in a moment." }
};

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser("campaignLaunch");
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `campaigns:retry-failed:user:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  const result = await retryFailedRecipients(id, auth.user.id);

  if (result.status !== "ok") {
    const response = FAILURE_RESPONSES[result.status];
    return NextResponse.json({ error: response.error }, { status: response.status });
  }

  after(async () => {
    await processPendingCampaignWork({
      runId: result.run.id,
      maxDurationMs: 55_000
    });
  });

  await writeAuditLog({
    actorEmail: auth.user.email,
    action: "campaign.retry_failed",
    entityType: "campaign",
    entityId: id,
    metadata: { runId: result.run.id, retried: result.retried }
  });

  return NextResponse.json({ retried: result.retried, run: result.run });
}
