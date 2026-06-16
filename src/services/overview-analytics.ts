import type { RecipientJobStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { DailySendWindow } from "@/lib/daily-send-limit";
import { formatRelativeTime } from "@/components/dashboard/formatters";
import type {
  ActionItem,
  FailureCategory,
  FailureIntelligence,
  OverviewAttention
} from "@/components/dashboard/analytics-types";

const ACTIVE_RUN_STATUSES = ["QUEUED", "RUNNING"] as const;
const FAILURE_SAMPLE_SIZE = 120;
// A sender at/above this share of its rolling 24h limit is flagged as needing pacing.
const NEAR_LIMIT_RATIO = 0.85;

// Recipient outcome buckets. Each RecipientJob has exactly one status, so these
// partitions never double-count.
const ATTENTION_STATUSES: RecipientJobStatus[] = ["FAILED", "BOUNCED", "COMPLAINED", "INVALID"];

export type SenderWindowInput = {
  senderProfileId: string;
  senderEmail: string;
  senderName: string;
  connected: boolean;
  window: DailySendWindow;
};

type GetOverviewAttentionArgs = {
  userId: string;
  now?: Date;
  /**
   * Sender windows already computed by the Overview page for the (untouched)
   * Send window card. Passing them in avoids re-reading the send ledger, and
   * keeps oauth token handling entirely out of this service — we only ever see
   * a derived `connected` boolean and the public DailySendWindow shape.
   */
  senderWindows: SenderWindowInput[];
};

function toStatusMap(rows: Array<{ status: RecipientJobStatus; _count: number }>) {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.status, row._count);
  }
  return map;
}

// Categorize a recipient job's lastError into an actionable, safe bucket. We
// never surface the raw error text to the client — only the resulting category
// counts — so provider payloads and addresses can't leak through analytics.
function categorizeFailure(rawError: string | null | undefined): "throttled" | "sender" | "recipient" | "other" {
  const error = (rawError ?? "").toLowerCase();
  if (!error) {
    return "other";
  }
  if (/(rate limit|ratelimit|quota|throttl|too many|429|limit exceeded|user-rate)/.test(error)) {
    return "throttled";
  }
  if (/(auth|token|credential|permission|oauth|unauthorized|401|403|scope|disabled)/.test(error)) {
    return "sender";
  }
  if (/(invalid|no such|not found|does not exist|recipient|mailbox|address|550|554|bounce)/.test(error)) {
    return "recipient";
  }
  return "other";
}

/**
 * Aggregates the small set of "what needs my attention right now" signals shown
 * on the Overview page: actionable items and a delivery-failure breakdown
 * (retryable vs action-required). Every query is scoped to the authenticated
 * operator's own data. Reflects current operational state (not a time window),
 * matching the "right now" framing of the section.
 */
export async function getOverviewAttention({
  userId,
  now = new Date(),
  senderWindows
}: GetOverviewAttentionArgs): Promise<OverviewAttention> {
  const [statusRows, failureSample, attentionCampaignCount, totalCampaignCount, totalImports, mappedImports] =
    await Promise.all([
      prisma.recipientJob.groupBy({
        by: ["status"],
        where: { campaignRun: { campaign: { userId } } },
        _count: true
      }),
      prisma.recipientJob.findMany({
        where: { campaignRun: { campaign: { userId } }, status: { in: ATTENTION_STATUSES } },
        orderBy: { updatedAt: "desc" },
        take: FAILURE_SAMPLE_SIZE,
        select: { lastError: true, updatedAt: true }
      }),
      // Matches the hero "Needs attention" highlight so the two never disagree.
      prisma.campaign.count({
        where: {
          userId,
          OR: [{ status: "FAILED" }, { runs: { some: { status: { in: ["FAILED"] } } } }]
        }
      }),
      prisma.campaign.count({ where: { userId } }),
      prisma.import.count({ where: { userId } }),
      prisma.import.count({ where: { userId, mappings: { some: {} } } })
    ]);

  const groups = toStatusMap(statusRows);
  const audience = statusRows.reduce((total, row) => total + row._count, 0);
  const unmappedImports = Math.max(0, totalImports - mappedImports);

  // ----- Sender signals (from pre-computed windows; no token access here) -----
  const disconnectedSenders = senderWindows.filter((sender) => !sender.connected).length;
  const sendersNearLimit = senderWindows.filter((sender) => {
    const { window } = sender;
    if (!sender.connected || !window.ledgerAvailable) {
      return false;
    }
    if (window.isBlocked) {
      return true;
    }
    const limit = window.limit;
    return limit > 0 && window.sentLast24h / limit >= NEAR_LIMIT_RATIO;
  }).length;

  // ----- Failure intelligence -----
  const invalid = groups.get("INVALID") ?? 0;
  const bounced = groups.get("BOUNCED") ?? 0;
  const complained = groups.get("COMPLAINED") ?? 0;
  const failedHard = groups.get("FAILED") ?? 0;
  const retrying = groups.get("RETRYING") ?? 0;

  const errorBuckets = { throttled: 0, sender: 0, recipient: 0, other: 0 };
  let lastFailureAt: Date | null = null;
  for (const job of failureSample) {
    errorBuckets[categorizeFailure(job.lastError)] += 1;
    if (!lastFailureAt || job.updatedAt > lastFailureAt) {
      lastFailureAt = job.updatedAt;
    }
  }

  const failureCategories: FailureCategory[] = (
    [
      {
        key: "retryable",
        label: "Retryable",
        value: retrying,
        tone: "retryable",
        description: "Awaiting an automatic retry"
      },
      {
        key: "throttled",
        label: "Gmail throttling",
        value: errorBuckets.throttled,
        tone: "sender",
        description: "Paused by send-rate limits"
      },
      {
        key: "sender",
        label: "Sender / auth",
        value: errorBuckets.sender,
        tone: "sender",
        description: "Reconnect or re-authorize sender"
      },
      {
        key: "recipient",
        label: "Invalid recipient",
        value: invalid + bounced,
        tone: "recipient",
        description: "Bad address or hard bounce"
      },
      {
        key: "complaint",
        label: "Complaints",
        value: complained,
        tone: "recipient",
        description: "Marked as spam"
      },
      {
        key: "failed",
        label: "Action required",
        value: failedHard,
        tone: "attention",
        description: "Failed and needs review"
      }
    ] satisfies FailureCategory[]
  ).filter((category) => category.value > 0);

  const retryableTotal = retrying;
  const permanentTotal = invalid + bounced + complained + failedHard;
  const failures: FailureIntelligence = {
    total: retryableTotal + permanentTotal,
    retryable: retryableTotal,
    permanent: permanentTotal,
    categories: failureCategories,
    lastFailureAt: lastFailureAt ? lastFailureAt.toISOString() : null,
    lastFailureLabel: lastFailureAt ? formatRelativeTime(lastFailureAt) : null
  };

  // ----- Action center -----
  const actions: ActionItem[] = [];
  if (attentionCampaignCount > 0) {
    actions.push({
      key: "attention",
      label: "Sequences need attention",
      detail: "A run failed and needs a review before it can continue.",
      count: attentionCampaignCount,
      tone: "attention",
      href: "/campaigns",
      cta: "Review"
    });
  }
  if (disconnectedSenders > 0) {
    actions.push({
      key: "disconnected",
      label: "Senders disconnected",
      detail: "Reconnect Gmail before these senders can send again.",
      count: disconnectedSenders,
      tone: "sender",
      href: "/workspace",
      cta: "Reconnect"
    });
  }
  if (sendersNearLimit > 0) {
    actions.push({
      key: "senders",
      label: "Senders near capacity",
      detail: "Approaching or at the rolling 24h send limit.",
      count: sendersNearLimit,
      tone: "sender",
      href: "/workspace",
      cta: "Pace sends"
    });
  }
  if (retrying > 0) {
    actions.push({
      key: "retry",
      label: "Recipients awaiting retry",
      detail: "Queued for an automatic retry after a transient error.",
      count: retrying,
      tone: "retryable",
      href: "/campaigns",
      cta: "Monitor"
    });
  }
  if (unmappedImports > 0) {
    actions.push({
      key: "mapping",
      label: "Imports missing field mapping",
      detail: "Map columns before these lists can launch.",
      count: unmappedImports,
      tone: "import",
      href: "/imports",
      cta: "Map fields"
    });
  }

  return {
    generatedAt: now.toISOString(),
    hasData: totalCampaignCount > 0 || audience > 0 || totalImports > 0,
    actions,
    failures
  };
}
