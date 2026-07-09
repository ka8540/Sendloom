import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  GmailHistoryExpiredError,
  fetchGmailDsnFilterMetadata,
  fetchGmailMessageFull,
  getGmailProfileHistoryId,
  isGmailNotFoundError,
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
// First sync must NOT just anchor the cursor at "now" — a bounce that arrived
// before monitoring started (the exact production failure) would be silently
// skipped forever. It also runs one bounded recent DSN scan.
const BOUNCE_FIRST_SYNC_WINDOW_DAYS = 7;
const BOUNCE_FIRST_SYNC_MAX_MESSAGES = 100;
const BOUNCE_BACKFILL_WINDOW_DAYS = 30;
const BOUNCE_BACKFILL_MAX_MESSAGES = 200;
const BOUNCE_SEQUENCE_SCAN_WINDOW_DAYS = 30;
const BOUNCE_SEQUENCE_SCAN_PADDING_BEFORE_MS = 12 * 60 * 60_000;
const BOUNCE_SEQUENCE_SCAN_PADDING_AFTER_MS = 7 * 24 * 60 * 60_000;
const BOUNCE_SEQUENCE_SCAN_MAX_MESSAGES = 200;
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

/**
 * One-off, idempotent repair for recipients recorded before the Skipped
 * disposition existed: rows stored as FAILED whose OWN metadata proves a
 * permanent recipient-address failure (HARD_BOUNCE_RECIPIENT) become
 * SUPPRESSED with a concise reason. Nothing else converts — server errors,
 * Gmail auth problems, temporary and policy failures all keep their FAILED
 * status, and the bounce evidence in metadata stays untouched. Safe to run on
 * every cron tick: repaired rows no longer match the filter.
 */
export async function repairHardBouncedRecipientDispositions(): Promise<{ repairedCount: number }> {
  const jobs = await prisma.recipientJob.findMany({
    where: {
      status: "FAILED",
      metadata: { path: ["failureCode"], equals: "HARD_BOUNCE_RECIPIENT" }
    },
    select: { id: true, campaignRunId: true, metadata: true },
    take: 500
  });

  if (jobs.length === 0) {
    return { repairedCount: 0 };
  }

  for (const job of jobs) {
    const metadata =
      job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};
    const category = typeof metadata.failureCategory === "string" ? metadata.failureCategory : null;
    await prisma.recipientJob.update({
      where: { id: job.id },
      data: {
        status: "SUPPRESSED",
        nextRetryAt: null,
        lastError: safeDeliveryFailureReason((category as DeliveryFailureCategory) ?? "HARD_BOUNCE_MAILBOX_NOT_FOUND")
      }
    });
  }

  for (const runId of new Set(jobs.map((job) => job.campaignRunId))) {
    await syncRunCounts(runId);
  }

  console.info("[bounce-sync] Repaired hard-bounced recipient dispositions.", { repairedCount: jobs.length });
  return { repairedCount: jobs.length };
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

async function loadCandidateJobs(
  senderProfileId: string,
  options: { campaignId?: string } = {}
): Promise<CandidateJob[]> {
  return prisma.recipientJob.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - BOUNCE_CORRELATION_WINDOW_MS) },
      campaignRun: {
        campaign: {
          senderProfileId,
          ...(options.campaignId ? { id: options.campaignId } : {})
        }
      }
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
  /** Invoked when a referenced thread no longer exists (threads.get 404). */
  onMissingThread?: () => void;
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
      } catch (error) {
        // A missing thread (404) is expected for deleted/archived-away
        // conversations — count it and fall back to email-based correlation.
        // Any other thread-read failure also falls back rather than aborting.
        if (isGmailNotFoundError(error)) {
          args.onMissingThread?.();
        }
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

/**
 * Heal a delivery-status notification that an earlier reply sync stored as a
 * human "reply" (bounces arrive in the sent thread with References headers, so
 * before DSN exclusion existed they matched the reply heuristics). Removes the
 * bogus InboundReply and recomputes the job's reply count/timestamp from its
 * remaining real replies.
 */
export async function removeDeliveryNotificationStoredAsReply(gmailMessageId: string): Promise<boolean> {
  const reply = await prisma.inboundReply.findUnique({
    where: { gmailMessageId },
    select: { id: true, recipientJobId: true }
  });
  if (!reply) {
    return false;
  }

  await prisma.inboundReply.delete({ where: { id: reply.id } });

  if (reply.recipientJobId) {
    const remaining = await prisma.inboundReply.findMany({
      where: { recipientJobId: reply.recipientJobId },
      orderBy: { receivedAt: "desc" },
      take: 1,
      select: { receivedAt: true }
    });
    const remainingCount = await prisma.inboundReply.count({ where: { recipientJobId: reply.recipientJobId } });
    const job = await prisma.recipientJob.update({
      where: { id: reply.recipientJobId },
      data: {
        replyCount: remainingCount,
        repliedAt: remaining[0]?.receivedAt ?? null
      },
      select: { campaignRunId: true }
    });
    await syncRunCounts(job.campaignRunId);
  }
  return true;
}

// ---------------------------------------------------------------------------
// DSN processing.
// ---------------------------------------------------------------------------

type BounceProcessOutcome = "processed" | "duplicate" | "not-dsn" | "unmatched" | "ignored";

type BounceProcessResult = {
  outcome: BounceProcessOutcome;
  /** True when the message parsed as a real DSN (any outcome past filtering). */
  parsed: boolean;
  permanentFailures: number;
  temporaryFailures: number;
};

// FAILED is included so a delivery-status report can HEAL a job that already
// failed synchronously at send time (e.g. a generic "Gmail rejected this
// recipient" row) into the truthful Skipped/invalid-address disposition.
// OPENED is included because a message the receiving server permanently
// rejected was never delivered — an "open" on it is a false positive (Gmail's
// image proxy fetches the tracking pixel from the quoted original when the
// sender views the bounce report). CLICKED and any job with a real reply stay
// protected: that engagement is strong evidence the bounce was misdirected.
const JOB_STATUSES_UPDATABLE_BY_BOUNCE = new Set(["PENDING", "RETRYING", "SENT", "FAILED", "OPENED"]);

function isJobUpdatableByBounce(job: { status: string; replyCount: number }): boolean {
  return JOB_STATUSES_UPDATABLE_BY_BOUNCE.has(job.status) && job.replyCount === 0;
}

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
  /**
   * Manual sequence checks intentionally re-read DSNs whose ProviderEvent was
   * already recorded, because old code may have consumed the message before it
   * repaired a matching FAILED/SENT row. The event itself stays idempotent.
   */
  allowDuplicateRepair?: boolean;
  /** Invoked when a referenced thread no longer exists (threads.get 404). */
  onMissingThread?: () => void;
}): Promise<BounceProcessResult> {
  const done = (
    outcome: BounceProcessOutcome,
    detail: Partial<Omit<BounceProcessResult, "outcome">> = {}
  ): BounceProcessResult => ({
    outcome,
    parsed: detail.parsed ?? false,
    permanentFailures: detail.permanentFailures ?? 0,
    temporaryFailures: detail.temporaryFailures ?? 0
  });

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
  if (existing && !args.allowDuplicateRepair) {
    return done("duplicate", { parsed: true });
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
    return done("not-dsn");
  }

  const full = (await fetchGmailMessageFull(args.accessToken, args.gmailMessageId)) as GmailFullMessage;
  const parsed = parseDeliveryStatusFromGmailMessage(full);
  if (!parsed) {
    return done("not-dsn");
  }

  // A confirmed DSN must not linger as a stored "reply". Earlier reply syncs
  // (before DSN exclusion) matched bounces through the sent thread's
  // References headers — remove the bogus reply and fix the job's counters.
  try {
    await removeDeliveryNotificationStoredAsReply(args.gmailMessageId);
  } catch (error) {
    console.warn("[bounce-sync] Could not remove delivery notification stored as reply.", {
      senderId: args.sender.id,
      gmailMessageId: args.gmailMessageId,
      error: error instanceof Error ? error.message.slice(0, 160) : "unknown"
    });
  }

  const results: Array<Record<string, unknown>> = [];
  let matchedAny = false;
  let permanentFailures = 0;
  let temporaryFailures = 0;

  for (const recipient of parsed.recipients) {
    const classification = classifyDeliveryFailure(recipient);
    const job = await correlateBounceToJob({
      accessToken: args.accessToken,
      jobs: args.jobs,
      failedEmail: recipient.email,
      referenceMessageIds: parsed.referenceMessageIds,
      gmailThreadId: parsed.gmailThreadId,
      threadCache: args.threadCache,
      onMissingThread: args.onMissingThread
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
      console.warn("[bounce-sync] Delivery notification could not be correlated.", {
        senderId: args.sender.id,
        gmailMessageId: args.gmailMessageId,
        category: classification.category,
        enhancedStatusCode: recipient.status
      });
      continue;
    }
    matchedAny = true;

    // The candidate list is loaded once per batch, so the row may have moved
    // since (a pixel hit, an earlier DSN, or the bogus-reply healer above).
    // The disposition decision always uses the live status and reply count.
    const liveJob = await prisma.recipientJob.findUnique({
      where: { id: job.id },
      select: { status: true, replyCount: true }
    });

    if (classification.suppressRecipient && classification.permanence === "permanent") {
      permanentFailures += 1;
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
      if (liveJob && isJobUpdatableByBounce(liveJob)) {
        // The ADDRESS is bad, not Sendloom: the recipient's disposition is
        // Skipped (SUPPRESSED), never a system failure. The immutable bounce
        // evidence (category, enhanced code, failure code) stays in metadata,
        // the ProviderEvent row, and the suppression record.
        await markRecipientAttempt({
          jobId: job.id,
          status: "SUPPRESSED",
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
          reason
        });
      }
      console.info("[bounce-sync] Permanent delivery failure recorded.", {
        senderId: args.sender.id,
        gmailMessageId: args.gmailMessageId,
        recipientJobId: job.id,
        category: classification.category,
        enhancedStatusCode: recipient.status
      });
    } else if (
      (classification.category === "POLICY_REJECTION" || classification.category === "SPAM_REJECTION") &&
      // Policy/spam rejections never demote an engagement state — only a
      // proven-invalid ADDRESS justifies overriding a recorded open.
      liveJob &&
      liveJob.status !== "OPENED" &&
      isJobUpdatableByBounce(liveJob)
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
    } else if (classification.permanence === "temporary") {
      temporaryFailures += 1;
    }
    // Temporary and sender-account failures: record the event only. The
    // receiving server (or the send path's own retry policy) owns retries —
    // an already-submitted Gmail message must never be re-sent from here.
  }

  const created = existing
    ? false
    : await recordDsnEvent(args.gmailMessageId, {
        reports: results,
        referenceCount: parsed.referenceMessageIds.length
      });

  if (!created && !existing) {
    return done("duplicate", { parsed: true });
  }
  return done(matchedAny ? "processed" : "unmatched", { parsed: true, permanentFailures, temporaryFailures });
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
  bouncesParsed: number;
  processedBounces: number;
  unmatchedBounces: number;
  permanentFailures: number;
  temporaryFailures: number;
  /** Listed message ids that no longer existed (Gmail messages.get 404) — skipped. */
  missingMessageCount: number;
  /** Referenced thread ids that no longer existed (Gmail threads.get 404) — skipped. */
  missingThreadCount: number;
  recovered: boolean;
  skipped?: string;
};

type BounceBatchStats = Omit<BounceSyncResult, "recovered" | "skipped">;

async function processMessageIds(
  sender: SenderBounceCandidate,
  accessToken: string,
  messageIds: string[],
  options: { campaignId?: string; allowDuplicateRepair?: boolean } = {}
): Promise<BounceBatchStats> {
  const jobs = await loadCandidateJobs(sender.id, { campaignId: options.campaignId });
  const threadCache = new Map<string, string[]>();
  const stats: BounceBatchStats = {
    checkedMessages: messageIds.length,
    bouncesParsed: 0,
    processedBounces: 0,
    unmatchedBounces: 0,
    permanentFailures: 0,
    temporaryFailures: 0,
    missingMessageCount: 0,
    missingThreadCount: 0
  };

  for (const gmailMessageId of messageIds) {
    let result: BounceProcessResult;
    try {
      result = await processPotentialBounceMessage({
        sender,
        accessToken,
        gmailMessageId,
        jobs,
        threadCache,
        allowDuplicateRepair: options.allowDuplicateRepair,
        onMissingThread: () => {
          stats.missingThreadCount += 1;
        }
      });
    } catch (error) {
      // A message the search/history listed can be deleted before we read it —
      // Gmail then returns 404 "Requested entity was not found". Skip that one
      // message and keep scanning the rest; never let it crash the sync. Only
      // a missing-entity 404 is swallowed here — real auth/outage errors still
      // propagate to the caller's safe handling.
      if (isGmailNotFoundError(error)) {
        stats.missingMessageCount += 1;
        console.warn("[sync-bounces] Gmail message not found; skipping missing message.", {
          senderId: sender.id,
          gmailMessageId,
          operation: "messages.get"
        });
        continue;
      }
      throw error;
    }
    if (result.parsed) {
      stats.bouncesParsed += 1;
    }
    if (result.outcome === "processed") {
      stats.processedBounces += 1;
    } else if (result.outcome === "unmatched") {
      stats.unmatchedBounces += 1;
    }
    stats.permanentFailures += result.permanentFailures;
    stats.temporaryFailures += result.temporaryFailures;
  }

  return stats;
}

const EMPTY_BATCH_STATS: BounceBatchStats = {
  checkedMessages: 0,
  bouncesParsed: 0,
  processedBounces: 0,
  unmatchedBounces: 0,
  permanentFailures: 0,
  temporaryFailures: 0,
  missingMessageCount: 0,
  missingThreadCount: 0
};

function logBounceSyncSummary(senderId: string, stats: BounceBatchStats, context: string) {
  // Safe operational summary — counts and ids only, never recipient addresses.
  console.info("[bounce-sync] Processed Gmail delivery notifications.", {
    senderId,
    context,
    messagesScanned: stats.checkedMessages,
    bouncesParsed: stats.bouncesParsed,
    bouncesMatched: stats.processedBounces,
    permanentFailures: stats.permanentFailures,
    temporaryFailures: stats.temporaryFailures,
    unmatchedBounces: stats.unmatchedBounces,
    missingMessages: stats.missingMessageCount,
    missingThreads: stats.missingThreadCount
  });
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
    ...EMPTY_BATCH_STATS,
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
      // First sync: anchor at the current mailbox position AND run one bounded
      // scan of recent likely delivery-failure messages. Anchoring alone would
      // permanently skip any bounce that arrived before monitoring started —
      // exactly how the real "550 5.1.0 Address Rejected" bounce was missed.
      const historyId = await getGmailProfileHistoryId(accessToken);
      const candidateIds = await listGmailDsnCandidateIds({
        accessToken,
        newerThanDays: BOUNCE_FIRST_SYNC_WINDOW_DAYS,
        maxResults: BOUNCE_FIRST_SYNC_MAX_MESSAGES
      });
      const stats = await processMessageIds(sender, accessToken, candidateIds);
      await markSenderWatchState(sender.id, {
        gmailWatchHistoryId: historyId,
        bounceLastSyncedAt: new Date(),
        gmailWatchError: null
      });
      logBounceSyncSummary(sender.id, stats, "first-sync");
      return { ...stats, recovered: false };
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
      logBounceSyncSummary(sender.id, stats, "history");
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
      logBounceSyncSummary(sender.id, stats, "recovery");
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
    return { ...EMPTY_BATCH_STATS, recovered: false, skipped: "unavailable" };
  }
  if (sender.bounceBackfillCompletedAt && !options.force) {
    return { ...EMPTY_BATCH_STATS, recovered: false, skipped: "already_completed" };
  }

  const result = await withBounceSyncLock(`${sender.id}:backfill`, async (): Promise<BounceSyncResult> => {
    let accessToken: string;
    try {
      accessToken = (await refreshGoogleAccessToken(sender.oauthRefreshToken as string)).access_token;
    } catch (error) {
      // Any refresh failure here (invalid_grant, or an unclassified 400 from
      // the token endpoint) means the mailbox is unreadable — surface the safe
      // reconnect state instead of letting a provider error escape as a 500.
      await markSenderWatchState(sender.id, {
        gmailWatchStatus: "RECONNECT_REQUIRED",
        gmailWatchError: "authorization_expired"
      });
      console.warn("[bounce-sync] Backfill could not refresh Gmail authorization.", {
        senderId: sender.id,
        reconnectLike: isGmailReconnectError(error)
      });
      return { ...EMPTY_BATCH_STATS, recovered: false, skipped: "reconnect_required" };
    }
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
    logBounceSyncSummary(sender.id, stats, "backfill");
    return { ...stats, recovered: false };
  });

  return result ?? { ...EMPTY_BATCH_STATS, recovered: false, skipped: "locked" };
}

function getSequenceSearchWindow(
  campaign: {
    createdAt: Date;
    updatedAt: Date;
    runs: Array<{
      createdAt: Date;
      scheduledFor: Date | null;
      startedAt: Date | null;
      completedAt: Date | null;
      updatedAt: Date;
    }>;
  },
  now = new Date()
): { after: Date; before: Date } | null {
  const runStarts = campaign.runs.map(
    (run) => run.startedAt ?? run.scheduledFor ?? run.createdAt
  );
  const runEnds = campaign.runs.map((run) => run.completedAt ?? run.updatedAt);
  const earliest = runStarts.length
    ? new Date(Math.min(...runStarts.map((date) => date.getTime())))
    : campaign.createdAt;
  const latest = runEnds.length
    ? new Date(Math.max(...runEnds.map((date) => date.getTime())))
    : campaign.updatedAt;
  const oldestAllowed = new Date(now.getTime() - BOUNCE_SEQUENCE_SCAN_WINDOW_DAYS * 24 * 60 * 60_000);
  const after = new Date(Math.max(oldestAllowed.getTime(), earliest.getTime() - BOUNCE_SEQUENCE_SCAN_PADDING_BEFORE_MS));
  const before = new Date(Math.min(now.getTime() + 60_000, latest.getTime() + BOUNCE_SEQUENCE_SCAN_PADDING_AFTER_MS));
  return after < before ? { after, before } : null;
}

/**
 * Manual Check-bounces scan for one sequence. Unlike the background sender
 * sync, this searches broadly for DSN-looking messages in a bounded window
 * around the sequence run(s), scopes correlation to the sequence's recipient
 * jobs, and reprocesses already-recorded DSN events so old consumed bounces can
 * still repair stuck FAILED/SENT rows.
 */
export async function runSequenceBounceScan(args: {
  campaignId: string;
  userId: string;
  senderId: string;
}): Promise<BounceSyncResult> {
  const skipped = (reason: string): BounceSyncResult => ({
    ...EMPTY_BATCH_STATS,
    recovered: false,
    skipped: reason
  });

  const [sender, campaign] = await Promise.all([
    loadSenderForBounceSync(args.senderId),
    prisma.campaign.findFirst({
      where: { id: args.campaignId, userId: args.userId, senderProfileId: args.senderId },
      select: {
        createdAt: true,
        updatedAt: true,
        runs: {
          select: {
            createdAt: true,
            scheduledFor: true,
            startedAt: true,
            completedAt: true,
            updatedAt: true
          }
        }
      }
    })
  ]);

  if (!sender || !campaign) {
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

  const window = getSequenceSearchWindow(campaign);
  if (!window) {
    return { ...EMPTY_BATCH_STATS, recovered: false };
  }

  const result = await withBounceSyncLock(`${sender.id}:sequence:${args.campaignId}`, async (): Promise<BounceSyncResult> => {
    let accessToken: string;
    try {
      accessToken = (await refreshGoogleAccessToken(sender.oauthRefreshToken as string)).access_token;
    } catch (error) {
      await markSenderWatchState(sender.id, {
        gmailWatchStatus: "RECONNECT_REQUIRED",
        gmailWatchError: "authorization_expired"
      });
      return skipped("reconnect_required");
    }

    const candidateIds = await listGmailDsnCandidateIds({
      accessToken,
      after: window.after,
      before: window.before,
      maxResults: BOUNCE_SEQUENCE_SCAN_MAX_MESSAGES
    });
    const stats = await processMessageIds(sender, accessToken, candidateIds, {
      campaignId: args.campaignId,
      allowDuplicateRepair: true
    });
    await markSenderWatchState(sender.id, {
      bounceLastSyncedAt: new Date(),
      gmailWatchError: null
    });
    logBounceSyncSummary(sender.id, stats, "sequence-check");
    return { ...stats, recovered: false };
  });

  return result ?? skipped("locked");
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
    return { ...EMPTY_BATCH_STATS, recovered: false, skipped: "unknown_sender" };
  }
  return syncSenderBounces(sender.id, { force: true });
}
