// On-demand "Check bounces" for one sequence: sync the connected Gmail
// sender's delivery-status notifications (bounded, incremental — never a
// full-mailbox scan), then repair any of this sequence's recipient rows whose
// stored evidence already proves an invalid address (covers bounces the DSN
// idempotency gate consumed earlier). Everything is reused from the existing
// bounce pipeline and reclassification service — one classifier, one
// suppression writer, one rollup resync. No email is ever sent from here, and
// no Gmail message content leaves the server: the result is counts only.

import { prisma } from "@/lib/db";
import { isGmailReconnectError } from "@/lib/provider";
import { summarizeRecipientOverviewDispositions } from "@/lib/recipient-overview-disposition";
import {
  type BounceSyncResult,
  runRecentBounceBackfill,
  runSequenceBounceScan,
  syncSenderBounces
} from "@/services/bounces";
import { reclassifyInvalidRecipientJobs } from "@/services/invalid-recipient-reclassification";

/** A Gmail sync/search result with all counts zeroed (nothing read). */
function emptyBounceSyncResult(): BounceSyncResult {
  return {
    checkedMessages: 0,
    bouncesParsed: 0,
    processedBounces: 0,
    unmatchedBounces: 0,
    permanentFailures: 0,
    temporaryFailures: 0,
    missingMessageCount: 0,
    missingThreadCount: 0,
    recovered: false
  };
}

export type SequenceBounceCheckSummary = {
  /** Gmail messages inspected across the backfill + incremental sync. */
  gmailMessagesChecked: number;
  /** Delivery-status notifications parsed among them. */
  bouncesFound: number;
  /** Stored failed/delivered rows repaired by the reclassification pass. */
  existingRowsReclassified: number;
  /** THIS sequence's recipients newly moved to the invalid/skipped outcome. */
  invalidRecipientsUpdated: number;
  /** Exact-address suppression writes performed (user-scoped, idempotent). */
  suppressionsCreated: number;
  /** Whether the sequence-level skipped/delivered rollups changed. */
  statsChanged: boolean;
  /** This sequence's recipients already known invalid/skipped before the check. */
  skippedAlreadyKnown: number;
  /** Set when the Gmail mailbox could not be read (stale authorization). */
  gmailSyncSkipped: string | null;
  /** Listed Gmail messages that no longer existed (404) and were skipped. */
  missingMessageCount: number;
  /** Referenced Gmail threads that no longer existed (404) and were skipped. */
  missingThreadCount: number;
  /** Total missing Gmail entities skipped this check (messages + threads). */
  skippedMissingGmailEntities: number;
};

export type SequenceBounceCheckResult =
  | { status: "not_found" }
  | { status: "sender_unavailable" }
  | { status: "sender_disconnected" }
  | { status: "gmail_unavailable" }
  | { status: "ok"; summary: SequenceBounceCheckSummary };

/** Skipped-disposition count over every recipient of every run of the sequence. */
async function countSequenceSkipped(campaignId: string): Promise<number> {
  const jobs = await prisma.recipientJob.findMany({
    where: { campaignRun: { campaignId } },
    select: { status: true, metadata: true, lastError: true }
  });
  return summarizeRecipientOverviewDispositions(jobs).skipped;
}

/**
 * Check already-sent recipients of one sequence against the sender's Gmail
 * delivery-status notifications and reclassify confirmed invalid addresses as
 * Skipped (with exact-email INVALID_EMAIL suppressions for future sends).
 *
 * Safe to run repeatedly: the DSN pipeline is idempotent per Gmail message,
 * the reclassification only converts rows with hard evidence, and a second
 * check reports zero updates. Detection is signature-based — no company,
 * domain, or recipient is ever special-cased.
 */
export async function checkSequenceBounces(args: {
  campaignId: string;
  userId: string;
}): Promise<SequenceBounceCheckResult> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: args.campaignId, userId: args.userId },
    select: {
      id: true,
      senderProfileId: true,
      senderProfile: { select: { provider: true, oauthRefreshToken: true } }
    }
  });
  if (!campaign) {
    return { status: "not_found" };
  }
  if (campaign.senderProfile.provider !== "google_oauth") {
    return { status: "sender_unavailable" };
  }
  if (!campaign.senderProfile.oauthRefreshToken) {
    return { status: "sender_disconnected" };
  }

  const skippedBefore = await countSequenceSkipped(campaign.id);

  // One-time recent backfill for mailboxes that predate bounce monitoring
  // (no-op once completed), then a forced incremental sync from the stored
  // history position. The final sequence scan is broader (body/subject/sender
  // DSN terms, not Sent-only) but bounded to the sequence's run window and
  // scoped to this campaign's jobs. It also repairs already-recorded DSNs.
  //
  // Individual missing Gmail entities (a message/thread the search or history
  // listed but that no longer exists — 404 "Requested entity was not found")
  // are already skipped deep inside each scan. This guard is the safety net so
  // that ANY unexpected Gmail failure (outage, rate limit, or a 404 from the
  // search/profile call itself) can never prevent the stored-evidence repair
  // below from running — the repair is the part that fixes already-known bad
  // rows, so it must not sit behind a Gmail call that can throw.
  let backfill = emptyBounceSyncResult();
  let sync = emptyBounceSyncResult();
  let sequenceScan = emptyBounceSyncResult();
  let gmailSyncFailed = false;
  let gmailSyncReconnect = false;
  try {
    backfill = await runRecentBounceBackfill(campaign.senderProfileId);
    sync = await syncSenderBounces(campaign.senderProfileId, { force: true });
    sequenceScan = await runSequenceBounceScan({
      campaignId: campaign.id,
      userId: args.userId,
      senderId: campaign.senderProfileId
    });
  } catch (error) {
    gmailSyncFailed = true;
    gmailSyncReconnect = isGmailReconnectError(error);
    // Safe operational log only — the message is Google's normalized error
    // string (never a raw Gmail body, recipient address, or OAuth token).
    console.warn("[sync-bounces] Gmail sync phase failed; continuing with stored-evidence repair.", {
      campaignId: campaign.id,
      senderProfileId: campaign.senderProfileId,
      reconnectLike: gmailSyncReconnect,
      error: error instanceof Error ? error.message.slice(0, 160) : "unknown"
    });
  }

  // A DSN processed earlier may have been unable to update the job at the
  // time (and its message id is now consumed by the idempotency gate). The
  // reclassification converts this sequence's rows from their own stored
  // evidence — hard-bounce metadata or a confirmed invalid-address
  // suppression — and resyncs the touched runs' rollup counters. Runs
  // unconditionally, even when the Gmail phase above found or fetched nothing.
  const reclassification = await reclassifyInvalidRecipientJobs({
    apply: true,
    userId: args.userId,
    campaignId: campaign.id
  });

  const skippedAfter = await countSequenceSkipped(campaign.id);

  const gmailMessagesChecked = backfill.checkedMessages + sync.checkedMessages + sequenceScan.checkedMessages;
  const bouncesFound = backfill.bouncesParsed + sync.bouncesParsed + sequenceScan.bouncesParsed;
  const existingRowsReclassified = reclassification.reclassifiedCount;
  const suppressionsCreated =
    backfill.permanentFailures +
    sync.permanentFailures +
    sequenceScan.permanentFailures +
    reclassification.suppressionsRecordedCount;
  const missingMessageCount =
    backfill.missingMessageCount + sync.missingMessageCount + sequenceScan.missingMessageCount;
  const missingThreadCount = backfill.missingThreadCount + sync.missingThreadCount + sequenceScan.missingThreadCount;
  const skippedMissingGmailEntities = missingMessageCount + missingThreadCount;

  const gmailSyncSkipped = sequenceScan.skipped ?? sync.skipped ?? backfill.skipped ?? null;
  const authorizationLost =
    gmailSyncReconnect ||
    gmailSyncSkipped === "reconnect_required" ||
    gmailSyncSkipped === "permission_required";
  const skippedDelta = Math.max(0, skippedAfter - skippedBefore);
  const invalidRecipientsUpdated = Math.max(skippedDelta, existingRowsReclassified);
  const statsChanged = skippedAfter !== skippedBefore;

  // The mailbox is unreadable AND nothing could be repaired from stored
  // evidence: surface the reconnect state instead of a hollow zero summary.
  if (authorizationLost && invalidRecipientsUpdated === 0) {
    return { status: "sender_disconnected" };
  }

  // A non-auth Gmail failure (outage/rate limit, or an unexpected error) that
  // repaired nothing from stored evidence: surface a safe retryable state
  // rather than a hollow "no bounces" summary or a raw 500.
  if (gmailSyncFailed && !gmailSyncReconnect && invalidRecipientsUpdated === 0) {
    return { status: "gmail_unavailable" };
  }

  return {
    status: "ok",
    summary: {
      gmailMessagesChecked,
      bouncesFound,
      existingRowsReclassified,
      invalidRecipientsUpdated,
      suppressionsCreated,
      statsChanged,
      skippedAlreadyKnown: skippedBefore,
      gmailSyncSkipped,
      missingMessageCount,
      missingThreadCount,
      skippedMissingGmailEntities
    }
  };
}
