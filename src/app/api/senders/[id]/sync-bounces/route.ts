import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { runRecentBounceBackfill, resolveBounceMonitoringStatus } from "@/services/bounces";

// One-time "Sync recent delivery failures" action for a connected Gmail
// sender. Owner-scoped, capability-gated, bounded (recent window + message
// cap), and idempotent — a completed backfill is not rescanned.

export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await params;
  const sender = await prisma.senderProfile.findFirst({
    where: { id, userId: auth.user.id },
    select: {
      id: true,
      provider: true,
      oauthRefreshToken: true,
      oauthScope: true,
      gmailWatchStatus: true,
      gmailWatchHistoryId: true,
      bounceLastSyncedAt: true
    }
  });

  if (!sender) {
    return NextResponse.json({ error: "Sender not found." }, { status: 404 });
  }

  const status = resolveBounceMonitoringStatus(sender);
  if (status !== "ACTIVE" && status !== "RENEWAL_FAILED") {
    return NextResponse.json(
      { error: "Reconnect Gmail to detect delivery failures automatically.", status },
      { status: 409 }
    );
  }

  const result = await runRecentBounceBackfill(sender.id);
  return NextResponse.json({
    status,
    checkedMessages: result.checkedMessages,
    processedBounces: result.processedBounces,
    alreadyCompleted: result.skipped === "already_completed"
  });
}
