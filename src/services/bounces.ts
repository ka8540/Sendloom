import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  GmailHistoryExpiredError,
  fetchGmailDsnFilterMetadata,
  fetchGmailMessageFull,
  getGmailProfileHistoryId,
  listGmailDsnCandidateIds,
  listGmailHistoryMessageIds,
  listGmailThreadMessageIds,
  normalizeMessageId,
  registerGmailWatch
} from "@/lib/gmail";
import {
  classifyDeliveryFailure,
  getGmailHeader,
  isLikelyDeliveryStatusMessage,
  parseDeliveryStatusFromGmailMessage,
  safeDeliveryFailureReason,
  type DeliveryFailureCategory,
  type GmailFullMessage
} from "@/lib/gmail-dsn";
import { GOOGLE_GMAIL_REPLY_SCOPE, refreshGoogleAccessToken } from "@/lib/google";
import { isGmailReconnectError } from "@/lib/provider";
import { getRedis } from "@/lib/redis";
import { markRecipientAttempt, syncRunCounts } from "@/services/campaigns";

// Delivery-status events are recorded under this provider key in ProviderEvent;
// its unique [provider, providerMessageId, eventType] constraint is the
// idempotency gate — one DSN Gmail message is processed exactly once.
export const GMAIL_DSN_PROVIDER = "gmail-dsn";
export const GMAIL_DSN_SUPPRESSION_SOURCE = "gmail-dsn";

const BOUNCE_SYNC_LOCK_TTL_SECONDS = 2 * 60;
const BOUNCE_SYNC_MIN_INTERVAL_MS = 10 * 60_000;
const BOUNCE_HISTORY_MAX_MESSAGES = 200;
const BOUNCE_RECOVERY_WINDOW_DAYS = 7;
const BOUNCE_RECOVERY_MAX_MESSAGES = 100;
const BOUNCE_BACKFILL_WINDOW_DAYS = 30;
const BOUNCE_BACKFILL_MAX_MESSAGES = 200;
const BOUNCE_CORRELATION_WINDOW_MS = 30 * 24 * 60 * 60_000;
const BOUNCE_JOB_CANDIDATE_LIMIT = 5_000;

export type BounceMonitoringStatus =
  | "ACTIVE"
  | "PERMISSION_REQUIRED"
  | "RECONNECT_REQUIRED"
  | "RENEWAL_FAILED"
  | "UNAVAILABLE";

type SenderBounceCandidate = {
  id: string;
  userId: string | null;
  fromEmail: string;
  provider: string;
  oauthRefreshToken: string | null;
  oauthScope: string | null;
  gmailWatchHistoryId: string | null;
  gmailWatchExpiresAt: Date | null;
  gmailWatchStatus: string | null;
  bounceLastSyncedAt: Date | null;
  bounceBackfillCompletedAt: Date | null;
};

const SENDER_BOUNCE_SELECT = {
  id: true,
  userId: true,
  fromEmail: true,
  provider: true,
  oauthRefreshToken: true,
  oauthScope: true,
  gmailWatchHistoryId: true,
  gmailWatchExpiresAt: true,
  gmailWatchStatus: true,
  bounceLastSyncedAt: true,
  bounceBackfillCompletedAt: true
} satisfies Prisma.SenderProfileSelect;

/**
 * Whether this sender granted the mailbox-read scope bounce monitoring needs.
 * Senders connected before the read scope existed keep sending normally — they
 * just show "Permission required" until they reconnect.
 */
export function senderHasBounceReadScope(sender: Pick<SenderBounceCandidate, "oauthScope">): boolean {
  const scopes = sender.oauthScope?.split(/\s+/) ?? [];
  return scopes.includes(GOOGLE_GMAIL_REPLY_SCOPE) || scopes.includes("https://mail.google.com/");
}

/** Safe, user-facing capability state for the sender settings area. */
export function resolveBounceMonitoringStatus(
  sender: Pick<
    SenderBounceCandidate,
    "provider" | "oauthRefreshToken" | "oauthScope" | "gmailWatchStatus" | "bounceLastSyncedAt" | "gmailWatchHistoryId"
  >
): BounceMonitoringStatus {
  if (sender.provider !== "google_oauth") {
    return "UNAVAILABLE";
  }
  if (!sender.oauthRefreshToken || sender.gmailWatchStatus === "RECONNECT_REQUIRED") {
    return "RECONNECT_REQUIRED";
  }
  if (!senderHasBounceReadScope(sender)) {
    return "PERMISSION_REQUIRED";
  }
  if (sender.gmailWatchStatus === "RENEWAL_FAILED") {
    return "RENEWAL_FAILED";
  }
  return "ACTIVE";
}

export const BOUNCE_MONITORING_STATUS_LABELS: Record<BounceMonitoringStatus, string> = {
  ACTIVE: "Bounce monitoring active",
  PERMISSION_REQUIRED: "Bounce monitoring: permission required",
  RECONNECT_REQUIRED: "Reconnect Gmail to detect delivery failures automatically.",
  RENEWAL_FAILED: "Delivery-failure monitoring is temporarily unavailable. Sending can continue, but recent bounces may take longer to appear.",
  UNAVAILABLE: "Bounce monitoring unavailable"
};

function isDuplicateRecordError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function withBounceSyncLock<T>(senderId: string, callback: () => Promise<T>) {
  const redis = getRedis();
  const key = `sendloom:bounce-sync:${senderId}`;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const acquired = await redis.set(key, token, "EX", BOUNCE_SYNC_LOCK_TTL_SECONDS, "NX");
  if (acquired !== "OK") {
    return null;
  }
  try {
    return await callback();
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token
    );
  }
}

// ---------------------------------------------------------------------------
// Suppression persistence (idempotent, unsubscribe-preserving).
// ---------------------------------------------------------------------------

/**
 * Record a confirmed permanent delivery failure. Idempotent per DSN message:
 * reprocessing the same Gmail message never double-counts. An existing
 * UNSUBSCRIBED record keeps its reason (unsubscribes are never relabelled as
 * failures) — only the structured failure detail is added.
 */
export async function recordDeliveryFailureSuppression(args: {
  userId: string;
  email: string;
  category: DeliveryFailureCategory;
  enhancedStatusCode: string | null;
  sourceGmailMessageId: string;
  occurredAt: Date;
}) {
  const email = args.email.trim().toLowerCase();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.suppression.findUnique({
      where: { userId_email: { userId: args.userId, email } }
    });

    if (existing?.sourceGmailMessageId === args.sourceGmailMessageId) {
      return existing;
    }

    const failureDetail = {
      failureCategory: args.category,
      enhancedStatusCode: args.enhancedStatusCode,
      lastFailedAt: args.occurredAt,
      sourceGmailMessageId: args.sourceGmailMessageId
    };

    if (existing) {
      return tx.suppression.update({
        where: { id: existing.id },
        data: {
          ...failureDetail,
          // Unsubscribed stays unsubscribed; every other reason escalates to
          // the delivery-failure reason.
          reason: existing.reason === "UNSUBSCRIBED" ? existing.reason : "HARD_BOUNCE",
          source: existing.reason === "UNSUBSCRIBED" ? existing.source : GMAIL_DSN_SUPPRESSION_SOURCE,
          firstFailedAt: existing.firstFailedAt ?? args.occurredAt,
          failureCount: { increment: 1 }
        }
      });
    }

    return tx.suppression.create({
      data: {
        userId: args.userId,
        email,
        reason: "HARD_BOUNCE",
        source: GMAIL_DSN_SUPPRESSION_SOURCE,
        ...failureDetail,
        firstFailedAt: args.occurredAt,
        failureCount: 1
      }
    });
  });
}

/**
 * Skip every still-queued attempt to a permanently failed address for this
 * user, across all of their sequences. Already-sent history is never altered.
 */
export async function skipQueuedSendsForFailedAddress(args: { userId: string; email: string; reason: string }) {
  const email = args.email.trim().toLowerCase();
  const queued = await prisma.recipientJob.findMany({
    where: {
      status: { in: ["PENDING", "RETRYING"] },
      recipientEmail: { equals: email, mode: "insensitive" },
      campaignRun: { campaign: { userId: args.userId } }
    },
    select: { id: true, campaignRunId: true }
  });

  if (queued.length === 0) {
    return { skippedCount: 0 };
  }

  await prisma.recipientJob.updateMany({
    where: { id: { in: queued.map((job) => job.id) } },
    data: {
      status: "SUPPRESSED",
      lastError: args.reason,
      nextRetryAt: null
    }
  });

  for (const runId of new Set(queued.map((job) => job.campaignRunId))) {
    await syncRunCounts(runId);
  }

  return { skippedCount: queued.length };
}

// ---------------------------------------------------------------------------
// Correlation — match a DSN to the original Sendloom send.
// ---------------------------------------------------------------------------

type CandidateJob = {
  id: string;
  campaignRunId: string;
  recipientEmail: string;
  providerMessageId: string | null;
  status: string;
  metadata: unknown;
  updatedAt: Date;
};

function getJobRfcMessageId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as { rfcMessageId?: unknown }).rfcMessageId;
  return typeof value === "string" ? normalizeMessageId(value) : null;
}

async function loadCandidateJobs(senderProfileId: string): Promise<CandidateJob[]> {
  return prisma.recipientJob.findMany({
    where: {
      providerMessageId: { not: null },
      createdAt: { gte: new Date(Date.now() - BOUNCE_CORRELATION_WINDOW_MS) },
      campaignRun: { campaign: { senderProfileId } }
    },
    select: {
      id: true,
      campaignRunId: true,
      recipientEmail: true,
      providerMessageId: true,
      status: true,
      metadata: true,
      updatedAt: true
    },
    orderBy: { createdAt: "desc" },
    take: BOUNCE_JOB_CANDIDATE_LIMIT
  });
}

/**
 * Preferred matching order: original RFC Message-ID (stored at send time) →
 * Gmail thread association → failed recipient + this sender within the bounded
 * window. Every path is scoped to THIS sender's jobs, so another user's send
 * can never be matched.
 */
async function correlateBounceToJob(args: {
  accessToken: string;
  jobs: CandidateJob[];
  failedEmail: string;
  referenceMessageIds: string[];
  gmailThreadId: string | null;
  threadCache: Map<string, string[]>;
}): Promise<CandidateJob | null> {
  const byRfcId = new Map<string, CandidateJob>();
  const byGmailId = new Map<string, CandidateJob>();
  for (const job of args.jobs) {
    const rfcId = getJobRfcMessageId(job.metadata);
    if (rfcId && !byRfcId.has(rfcId)) {
      byRfcId.set(rfcId, job);
    }
    const gmailId = normalizeMessageId(job.providerMessageId);
    if (gmailId && !byGmailId.has(gmailId)) {
      byGmailId.set(gmailId, job);
    }
  }

  for (const referenceId of args.referenceMessageIds) {
    const match = byRfcId.get(referenceId);
    if (match) {
      return match;
    }
  }

  if (args.gmailThreadId) {
    let threadMessageIds = args.threadCache.get(args.gmailThreadId);
    if (!threadMessageIds) {
      try {
        threadMessageIds = await listGmailThreadMessageIds({
          accessToken: args.accessToken,
          threadId: args.gmailThreadId
        });
      } catch {
        threadMessageIds = [];
      }
      args.threadCache.set(args.gmailThreadId, threadMessageIds);
    }
    for (const messageId of threadMessageIds) {
      const match = byGmailId.get(messageId);
      if (match) {
        return match;
      }
    }
  }

  // Recipient + sender + bounded window. The failed address itself identifies
  // the recipient; prefer the most recent attempt to that address.
  const failedEmail = args.failedEmail.toLowerCase();
  const byEmail = args.jobs
    .filter((job) => job.recipientEmail.trim().toLowerCase() === failedEmail)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  return byEmail[0] ?? null;
}

// ---------------------------------------------------------------------------
// DSN processing.
// ---------------------------------------------------------------------------

type BounceProcessOutcome = "processed" | "duplicate" | "not-dsn" | "unmatched" | "ignored";

const JOB_STATUSES_UPDATABLE_BY_BOUNCE = new Set(["PENDING", "RETRYING", "SENT"]);

async function recordDsnEvent(gmailMessageId: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    await prisma.providerEvent.create({
      data: {
        provider: GMAIL_DSN_PROVIDER,
        providerMessageId: gmailMessageId,
        eventType: "BOUNCED",
        payload: payload as Prisma.InputJsonValue
      }
    });
    return true;
  } catch (error) {
    if (isDuplicateRecordError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Inspect one mailbox message id and, when it is a delivery-status
 * notification for a Sendloom send, apply the classified outcome. Safe to call
 * repeatedly with the same message — the ProviderEvent unique key makes the
 * whole operation idempotent.
 */
export async function processPotentialBounceMessage(args: {
  sender: Pick<SenderBounceCandidate, "id" | "userId" | "fromEmail">;
  accessToken: string;
  gmailMessageId: string;
  jobs: CandidateJob[];
  threadCache: Map<string, string[]>;
}): Promise<BounceProcessOutcome> {
  const existing = await prisma.providerEvent.findUnique({
    where: {
      provider_providerMessageId_eventType: {
        provider: GMAIL_DSN_PROVIDER,
        providerMessageId: args.gmailMessageId,
        eventType: "BOUNCED"
      }
    },
    select: { id: true }
  });
  if (existing) {
    return "duplicate";
  }

  // Cheap metadata pass first — ordinary personal mail is dismissed here
  // without ever reading a body.
  const metadata = await fetchGmailDsnFilterMetadata(args.accessToken, args.gmailMessageId);
  const headers = metadata.payload?.headers;
  const likely = isLikelyDeliveryStatusMessage({
    fromHeader: getGmailHeader(headers, "From"),
    subject: getGmailHeader(headers, "Subject"),
    contentType: getGmailHeader(headers, "Content-Type"),
    autoSubmitted: getGmailHeader(headers, "Auto-Submitted"),
    hasFailedRecipientsHeader: Boolean(getGmailHeader(headers, "X-Failed-Recipients"))
  });
  if (!likely) {
    return "not-dsn";
  }

  const full = (await fetchGmailMessageFull(args.accessToken, args.gmailMessageId)) as GmailFullMessage;
  const parsed = parseDeliveryStatusFromGmailMessage(full);
  if (!parsed) {
    return "not-dsn";
  }

  const results: Array<Record<string, unknown>> = [];
  let matchedAny = false;

  for (const recipient of parsed.recipients) {
    const classification = classifyDeliveryFailure(recipient);
    const job = await correlateBounceToJob({
      accessToken: args.accessToken,
      jobs: args.jobs,
      failedEmail: recipient.email,
      referenceMessageIds: parsed.referenceMessageIds,
      gmailThreadId: parsed.gmailThreadId,
      threadCache: args.threadCache
    });

    // Never persist the recipient address in the event payload — categories,
    // codes, and internal ids only.
    const summary: Record<string, unknown> = {
      category: classification.category,
      permanence: classification.permanence,
      status: recipient.status,
      structured: parsed.structured,
      recipientJobId: job?.id ?? null,
      matched: Boolean(job)
    };
    results.push(summary);

    if (!job) {
      // Unmatched bounce: recorded (below) for internal investigation, but a
      // recipient state is never changed on an ambiguous match.
      continue;
    }
    matchedAny = true;

    if (classification.suppressRecipient && classification.permanence === "permanent") {
      const reason = safeDeliveryFailureReason(classification.category);
      if (args.sender.userId) {
        await recordDeliveryFailureSuppression({
          userId: args.sender.userId,
          email: recipient.email,
          category: classification.category,
          enhancedStatusCode: recipient.status,
          sourceGmailMessageId: args.gmailMessageId,
          occurredAt: parsed.receivedAt
        });
      }
      if (JOB_STATUSES_UPDATABLE_BY_BOUNCE.has(job.status)) {
        await markRecipientAttempt({
          jobId: job.id,
          status: "FAILED",
          lastError: reason,
          failureCode: "HARD_BOUNCE_RECIPIENT",
          failureSource: "GMAIL",
          failureDetails: {
            failureCategory: classification.category,
            enhancedStatusCode: recipient.status
          }
        });
      }
      if (args.sender.userId) {
        await skipQueuedSendsForFailedAddress({
          userId: args.sender.userId,
          email: recipient.email,
          reason: `${reason} — this address previously returned a permanent delivery failure.`
        });
      }
    } else if (
      (classification.category === "POLICY_REJECTION" || classification.category === "SPAM_REJECTION") &&
      JOB_STATUSES_UPDATABLE_BY_BOUNCE.has(job.status)
    ) {
      // The specific attempt failed, but the address is not proven invalid —
      // no suppression, and a manual retry stays available.
      await markRecipientAttempt({
        jobId: job.id,
        status: "FAILED",
        lastError: safeDeliveryFailureReason(classification.category),
        failureCode: "GMAIL_SEND_REJECTED",
        failureSource: "GMAIL",
        failureDetails: { failureCategory: classification.category, enhancedStatusCode: recipient.status }
      });
    }
    // Temporary and sender-account failures: record the event only. The
    // receiving server (or the send path's own retry policy) owns retries —
    // an already-submitted Gmail message must never be re-sent from here.
  }

  const created = await recordDsnEvent(args.gmailMessageId, {
    reports: results,
    referenceCount: parsed.referenceMessageIds.length
  });

  if (!created) {
    return "duplicate";
  }
  return matchedAny ? "processed" : "unmatched";
}

// ---------------------------------------------------------------------------
// Mailbox synchronization (history-based, bounded recovery).
// ---------------------------------------------------------------------------

async function loadSenderForBounceSync(senderId: string): Promise<SenderBounceCandidate | null> {
  return prisma.senderProfile.findFirst({
    where: { id: senderId, provider: "google_oauth" },
    select: SENDER_BOUNCE_SELECT
  });
}

async function markSenderWatchState(
  senderId: string,
  data: Partial<{
    gmailWatchHistoryId: string;
    gmailWatchExpiresAt: Date;
    gmailWatchStatus: string;
    gmailWatchError: string | null;
    bounceLastSyncedAt: Date;
    bounceBackfillCompletedAt: Date;
  }>
) {
  await prisma.senderProfile.update({ where: { id: senderId }, data });
}

export type BounceSyncResult = {
  checkedMessages: number;
  processedBounces: number;
  unmatchedBounces: number;
  recovered: boolean;
  skipped?: string;
};

async function processMessageIds(
  sender: SenderBounceCandidate,
  accessToken: string,
  messageIds: string[]
): Promise<Omit<BounceSyncResult, "recovered">> {
  const jobs = await loadCandidateJobs(sender.id);
  const threadCache = new Map<string, string[]>();
  let processedBounces = 0;
  let unmatchedBounces = 0;

  for (const gmailMessageId of messageIds) {
    const outcome = await processPotentialBounceMessage({
      sender,
      accessToken,
      gmailMessageId,
      jobs,
      threadCache
    });
    if (outcome === "processed") {
      processedBounces += 1;
    } else if (outcome === "unmatched") {
      unmatchedBounces += 1;
    }
  }

  return { checkedMessages: messageIds.length, processedBounces, unmatchedBounces };
}

/**
 * Incremental mailbox sync from the stored Gmail history position. Runs under
 * a per-sender lock; the history pointer only advances after processing
 * succeeds. An out-of-date pointer triggers ONE bounded recovery pass over
 * likely delivery-failure messages — never a full-mailbox scan.
 */
export async function syncSenderBounces(
  senderId: string,
  options: { force?: boolean } = {}
): Promise<BounceSyncResult> {
  const skipped = (reason: string): BounceSyncResult => ({
    checkedMessages: 0,
    processedBounces: 0,
    unmatchedBounces: 0,
    recovered: false,
    skipped: reason
  });

  const sender = await loadSenderForBounceSync(senderId);
  if (!sender) {
    return skipped("sender_not_found");
  }
  if (!sender.oauthRefreshToken) {
    await markSenderWatchState(sender.id, { gmailWatchStatus: "RECONNECT_REQUIRED" });
    return skipped("reconnect_required");
  }
  if (!senderHasBounceReadScope(sender)) {
    await markSenderWatchState(sender.id, { gmailWatchStatus: "PERMISSION_REQUIRED" });
    return skipped("permission_required");
  }
  if (!options.force && sender.bounceLastSyncedAt && sender.bounceLastSyncedAt > new Date(Date.now() - 30_000)) {
    return skipped("recently_synced");
  }

  const result = await withBounceSyncLock(sender.id, async (): Promise<BounceSyncResult> => {
    let accessToken: string;
    try {
      accessToken = (await refreshGoogleAccessToken(sender.oauthRefreshToken as string)).access_token;
    } catch (error) {
      if (isGmailReconnectError(error)) {
        await markSenderWatchState(sender.id, {
          gmailWatchStatus: "RECONNECT_REQUIRED",
          gmailWatchError: "authorization_expired"
        });
        return skipped("reconnect_required");
      }
      throw error;
    }

    if (!sender.gmailWatchHistoryId) {
      // First sync: anchor at the current mailbox position. Older messages are
      // only reachable through the explicit bounded backfill action.
      const historyId = await getGmailProfileHistoryId(accessToken);
      await markSenderWatchState(sender.id, {
        gmailWatchHistoryId: historyId,
        bounceLastSyncedAt: new Date(),
        gmailWatchError: null
      });
      return { checkedMessages: 0, processedBounces: 0, unmatchedBounces: 0, recovered: false };
    }

    try {
      const history = await listGmailHistoryMessageIds({
        accessToken,
        startHistoryId: sender.gmailWatchHistoryId,
        maxMessages: BOUNCE_HISTORY_MAX_MESSAGES
      });
      const stats = await processMessageIds(sender, accessToken, history.messageIds);
      await markSenderWatchState(sender.id, {
        gmailWatchHistoryId: history.latestHistoryId,
        bounceLastSyncedAt: new Date(),
        gmailWatchError: null
      });
      return { ...stats, recovered: false };
    } catch (error) {
      if (!(error instanceof GmailHistoryExpiredError)) {
        throw error;
      }
      // Bounded recovery: the stored pointer is too old for Gmail's history
      // window. Scan only likely delivery-failure messages in a short recent
      // window, then re-anchor at the current mailbox position.
      const candidateIds = await listGmailDsnCandidateIds({
        accessToken,
        newerThanDays: BOUNCE_RECOVERY_WINDOW_DAYS,
        maxResults: BOUNCE_RECOVERY_MAX_MESSAGES
      });
      const stats = await processMessageIds(sender, accessToken, candidateIds);
      const historyId = await getGmailProfileHistoryId(accessToken);
      await markSenderWatchState(sender.id, {
        gmailWatchHistoryId: historyId,
        bounceLastSyncedAt: new Date(),
        gmailWatchError: null
      });
      return { ...stats, recovered: true };
    }
  });

  return result ?? skipped("locked");
}

/**
 * One-time recent backfill for existing mailboxes (e.g. a bounce that arrived
 * before monitoring was enabled). Bounded window + message cap; idempotent via
 * the per-message event key, and marked complete so it never rescans.
 */
export async function runRecentBounceBackfill(
  senderId: string,
  options: { force?: boolean } = {}
): Promise<BounceSyncResult> {
  const sender = await loadSenderForBounceSync(senderId);
  if (!sender || !sender.oauthRefreshToken || !senderHasBounceReadScope(sender)) {
    return { checkedMessages: 0, processedBounces: 0, unmatchedBounces: 0, recovered: false, skipped: "unavailable" };
  }
  if (sender.bounceBackfillCompletedAt && !options.force) {
    return {
      checkedMessages: 0,
      processedBounces: 0,
      unmatchedBounces: 0,
      recovered: false,
      skipped: "already_completed"
    };
  }

  const result = await withBounceSyncLock(`${sender.id}:backfill`, async () => {
    const accessToken = (await refreshGoogleAccessToken(sender.oauthRefreshToken as string)).access_token;
    const candidateIds = await listGmailDsnCandidateIds({
      accessToken,
      newerThanDays: BOUNCE_BACKFILL_WINDOW_DAYS,
      maxResults: BOUNCE_BACKFILL_MAX_MESSAGES
    });
    const stats = await processMessageIds(sender, accessToken, candidateIds);
    await markSenderWatchState(sender.id, {
      bounceBackfillCompletedAt: new Date(),
      bounceLastSyncedAt: new Date()
    });
    return { ...stats, recovered: false };
  });

  return (
    result ?? { checkedMessages: 0, processedBounces: 0, unmatchedBounces: 0, recovered: false, skipped: "locked" }
  );
}

// ---------------------------------------------------------------------------
// Watch lifecycle.
// ---------------------------------------------------------------------------

export type WatchRenewalResult = {
  sendersChecked: number;
  renewed: number;
  failed: number;
  skipped?: string;
};

/**
 * Register or renew the Gmail mailbox watch for one sender. Idempotent —
 * re-registering an active watch just refreshes its expiration.
 */
export async function ensureGmailWatch(senderId: string): Promise<boolean> {
  const topicName = env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    return false;
  }
  const sender = await loadSenderForBounceSync(senderId);
  if (!sender || !sender.oauthRefreshToken) {
    return false;
  }
  if (!senderHasBounceReadScope(sender)) {
    await markSenderWatchState(sender.id, { gmailWatchStatus: "PERMISSION_REQUIRED" });
    return false;
  }

  try {
    const accessToken = (await refreshGoogleAccessToken(sender.oauthRefreshToken)).access_token;
    const watch = await registerGmailWatch({ accessToken, topicName });
    await markSenderWatchState(sender.id, {
      gmailWatchStatus: "ACTIVE",
      gmailWatchExpiresAt: watch.expiresAt,
      gmailWatchError: null,
      // Never move an existing pointer — that could skip unprocessed changes.
      ...(sender.gmailWatchHistoryId ? {} : { gmailWatchHistoryId: watch.historyId })
    });
    return true;
  } catch (error) {
    if (isGmailReconnectError(error)) {
      await markSenderWatchState(sender.id, {
        gmailWatchStatus: "RECONNECT_REQUIRED",
        gmailWatchError: "authorization_expired"
      });
    } else {
      await markSenderWatchState(sender.id, {
        gmailWatchStatus: "RENEWAL_FAILED",
        gmailWatchError: "watch_registration_failed"
      });
    }
    return false;
  }
}

/**
 * Scheduled watch maintenance: (re)register watches that are missing or expire
 * within the renewal window. Gmail watches last ~7 days; running this daily
 * (or on every cron tick — it no-ops when nothing is due) keeps them alive.
 */
export async function renewExpiringGmailWatches(
  options: { renewWithinHours?: number; maxSenders?: number } = {}
): Promise<WatchRenewalResult> {
  if (!env.GMAIL_PUBSUB_TOPIC) {
    return { sendersChecked: 0, renewed: 0, failed: 0, skipped: "pubsub_not_configured" };
  }
  const renewWithinMs = (options.renewWithinHours ?? 24) * 60 * 60_000;
  const senders = await prisma.senderProfile.findMany({
    where: {
      provider: "google_oauth",
      oauthRefreshToken: { not: null },
      gmailWatchStatus: { notIn: ["RECONNECT_REQUIRED", "PERMISSION_REQUIRED"] },
      OR: [{ gmailWatchExpiresAt: null }, { gmailWatchExpiresAt: { lte: new Date(Date.now() + renewWithinMs) } }]
    },
    select: { id: true, oauthScope: true },
    take: options.maxSenders ?? 20
  });

  const result: WatchRenewalResult = { sendersChecked: 0, renewed: 0, failed: 0 };
  for (const sender of senders) {
    if (!senderHasBounceReadScope(sender)) {
      continue;
    }
    result.sendersChecked += 1;
    if (await ensureGmailWatch(sender.id)) {
      result.renewed += 1;
    } else {
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Cron fallback: sync senders whose bounce monitoring is enabled but that have
 * not synchronized recently (missed/undelivered Pub/Sub pushes, or push not
 * configured). Incremental history reads only — never an inbox scan.
 */
export async function syncDueSenderBounces(
  options: { maxSenders?: number } = {}
): Promise<{ sendersChecked: number; processedBounces: number; sendersFailed: number }> {
  const cutoff = new Date(Date.now() - BOUNCE_SYNC_MIN_INTERVAL_MS);
  const senders = await prisma.senderProfile.findMany({
    where: {
      provider: "google_oauth",
      oauthRefreshToken: { not: null },
      gmailWatchStatus: { notIn: ["RECONNECT_REQUIRED", "PERMISSION_REQUIRED"] },
      OR: [{ bounceLastSyncedAt: null }, { bounceLastSyncedAt: { lte: cutoff } }]
    },
    select: { id: true, oauthScope: true },
    orderBy: [{ bounceLastSyncedAt: "asc" }],
    take: options.maxSenders ?? 5
  });

  const result = { sendersChecked: 0, processedBounces: 0, sendersFailed: 0 };
  for (const sender of senders) {
    if (!senderHasBounceReadScope(sender)) {
      continue;
    }
    result.sendersChecked += 1;
    try {
      const sync = await syncSenderBounces(sender.id);
      result.processedBounces += sync.processedBounces;
    } catch (error) {
      result.sendersFailed += 1;
      console.warn("[bounce-sync] Sender sync failed.", {
        senderId: sender.id,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown"
      });
    }
  }
  return result;
}

/**
 * Handle a Gmail Pub/Sub push: resolve the connected sender from the mailbox
 * address SERVER-SIDE (the payload is untrusted) and run an incremental sync.
 */
export async function handleGmailPushNotification(args: { emailAddress: string }): Promise<BounceSyncResult> {
  const sender = await prisma.senderProfile.findFirst({
    where: {
      provider: "google_oauth",
      fromEmail: { equals: args.emailAddress.trim().toLowerCase(), mode: "insensitive" }
    },
    select: { id: true }
  });
  if (!sender) {
    return { checkedMessages: 0, processedBounces: 0, unmatchedBounces: 0, recovered: false, skipped: "unknown_sender" };
  }
  return syncSenderBounces(sender.id, { force: true });
}
