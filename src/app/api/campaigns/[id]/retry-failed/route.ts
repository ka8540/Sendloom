import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { SEQUENCE_CONCURRENCY_LIMIT_CODE } from "@/lib/sequence-limit-codes";
import {
  processPendingCampaignWork,
  retryFailedRecipients,
  type RetryFailedRecipientsResult
} from "@/services/campaigns";

export const maxDuration = 60;

const FAILURE_RESPONSES: Record<
  Exclude<RetryFailedRecipientsResult["status"], "ok" | "waiting">,
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
  concurrency_limit: {
    status: 409,
    error: "You can run up to 10 sequences at the same time. Pause a running sequence, wait for one to finish, or place this sequence in the queue."
  },
  locked: { status: 409, error: "A retry is already being prepared. Try again in a moment." }
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser("campaignLaunch");
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `campaigns:retry-failed:user:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  const body = await request.clone().json().catch(() => ({}));
  const result = await retryFailedRecipients(id, auth.user.id, { waitForSlot: body?.waitForSlot === true });

  if (result.status !== "ok" && result.status !== "waiting") {
    const response = FAILURE_RESPONSES[result.status];
    return NextResponse.json(
      {
        error: response.error,
        ...(result.status === "concurrency_limit" ? { code: SEQUENCE_CONCURRENCY_LIMIT_CODE } : {})
      },
      { status: response.status }
    );
  }

  if (result.status === "ok") {
    after(async () => {
      await processPendingCampaignWork({
        runId: result.run.id,
        maxDurationMs: 55_000
      });
    });
  }

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: result.status === "waiting" ? "sequence.waiting_for_slot" : "sequence.retry_failed_started",
    category: "SEQUENCE",
    target: { type: "sequence", id },
    message:
      result.status === "waiting"
        ? "Sequence waiting for an execution slot."
        : `Retried ${result.retried} failed recipient${result.retried === 1 ? "" : "s"}.`,
    metadata: { runId: result.run.id, retried: result.retried },
    request
  });

  return NextResponse.json({
    status: result.status === "waiting" ? "WAITING_FOR_SLOT" : "STARTED",
    retried: result.retried,
    run: result.run
  });
}
