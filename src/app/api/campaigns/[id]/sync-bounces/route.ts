import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { checkSequenceBounces } from "@/services/sequence-bounce-check";

// Gmail history reads + bounded DSN scans can take a while on first use.
export const maxDuration = 60;

/**
 * Manual "Check bounces" for one sequence: reads the connected Gmail sender's
 * delivery-status notifications and reclassifies confirmed invalid recipient
 * addresses as skipped, with exact-email suppressions for future sends.
 * Never sends, resends, or modifies any email — this is a read-and-classify
 * action, and the response carries counts only (no Gmail message content).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  // Each check runs bounded Gmail queries — keep manual clicking reasonable.
  const limit = await rateLimit({ key: `campaigns:sync-bounces:user:${auth.user.id}`, limit: 6, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  const result = await checkSequenceBounces({ campaignId: id, userId: auth.user.id });

  if (result.status === "not_found") {
    return NextResponse.json({ error: "This sequence could not be found." }, { status: 404 });
  }
  if (result.status === "sender_unavailable") {
    return NextResponse.json(
      { error: "Bounce checking is only available for Gmail senders.", code: "SENDER_UNAVAILABLE" },
      { status: 409 }
    );
  }
  if (result.status === "sender_disconnected") {
    return NextResponse.json(
      { error: "Reconnect Gmail to check bounces.", code: "SENDER_DISCONNECTED" },
      { status: 409 }
    );
  }
  if (result.status === "gmail_unavailable") {
    // A transient Gmail outage/rate limit that repaired nothing — safe,
    // retryable, and never a raw Gmail API error to the UI.
    return NextResponse.json(
      { error: "Couldn't check bounces. Please try again.", code: "GMAIL_UNAVAILABLE" },
      { status: 503 }
    );
  }

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "sequence.bounce_check",
    category: "SEQUENCE",
    target: { type: "sequence", id },
    message:
      result.summary.invalidRecipientsUpdated > 0
        ? `Bounce check marked ${result.summary.invalidRecipientsUpdated} invalid recipient${result.summary.invalidRecipientsUpdated === 1 ? "" : "s"} as skipped.`
        : "Bounce check found no new invalid recipients.",
    metadata: { ...result.summary },
    request
  });

  return NextResponse.json(result.summary);
}
