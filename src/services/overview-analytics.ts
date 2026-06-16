import { Prisma, type RecipientJobStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  getDailySendLimit,
  getGmailDailySendWindow,
  type DailySendWindow
} from "@/lib/daily-send-limit";
import { formatCompactNumber, formatRelativeTime } from "@/components/dashboard/formatters";
import type {
  ActionItem,
  AnalyticsKpi,
  AnalyticsTrend,
  AnalyticsWindow,
  FailureCategory,
  FailureIntelligence,
  FunnelStage,
  HeatmapDay,
  HeatmapLevel,
  ImportQuality,
  OverviewAnalytics,
  SenderPacing,
  SenderUtilization,
  SequenceHealthSlice,
  TemplatePerformance,
  TimelinePoint
} from "@/components/dashboard/analytics-types";

const DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_DAYS = 30;
const ACTIVE_RUN_STATUSES = ["QUEUED", "RUNNING"] as const;
const MAX_SENDERS = 8;
const FAILURE_SAMPLE_SIZE = 120;

// Recipient outcome buckets. Each RecipientJob has exactly one status, so these
// partitions never double-count.
const DELIVERED_STATUSES: RecipientJobStatus[] = ["SENT", "OPENED", "CLICKED"];
const OPENED_STATUSES: RecipientJobStatus[] = ["OPENED", "CLICKED"];
const QUEUED_STATUSES: RecipientJobStatus[] = ["PENDING", "RETRYING"];
const ATTENTION_STATUSES: RecipientJobStatus[] = ["FAILED", "BOUNCED", "COMPLAINED", "INVALID"];

export type SenderWindowInput = {
  senderProfileId: string;
  senderEmail: string;
  senderName: string;
  connected: boolean;
  window: DailySendWindow;
};

type GetOverviewAnalyticsArgs = {
  userId: string;
  window: AnalyticsWindow;
  now?: Date;
  /**
   * Optional pre-computed sender windows. The Overview page already computes
   * these for the (untouched) Live System card, so passing them in avoids
   * re-reading the send ledger during server render. The API route omits this
   * and lets the service compute them.
   */
  senderWindows?: SenderWindowInput[] | null;
};

function getWindowConfig(window: AnalyticsWindow, now: Date) {
  const days = window === "7d" ? 7 : window === "14d" ? 14 : window === "30d" ? 30 : null;
  if (days === null) {
    return { days: null as number | null, since: null as Date | null, prevSince: null, prevUntil: null };
  }
  const since = new Date(now.getTime() - days * DAY_MS);
  const prevUntil = since;
  const prevSince = new Date(since.getTime() - days * DAY_MS);
  return { days, since, prevSince, prevUntil };
}

function sumStatuses(groups: Map<string, number>, statuses: readonly RecipientJobStatus[]) {
  return statuses.reduce((total, status) => total + (groups.get(status) ?? 0), 0);
}

function toStatusMap(rows: Array<{ status: RecipientJobStatus; _count: number }>) {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.status, row._count);
  }
  return map;
}

function getPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((value / total) * 100));
}

function getNullablePercent(value: number, total: number) {
  if (total <= 0) {
    return null;
  }
  return Math.round((value / total) * 100);
}

function buildTrend(current: number, previous: number): AnalyticsTrend | null {
  const delta = current - previous;
  if (delta === 0) {
    return { direction: "flat", label: "Flat vs prior period" };
  }
  if (previous === 0) {
    return {
      direction: delta > 0 ? "up" : "down",
      label: `${delta > 0 ? "+" : ""}${formatCompactNumber(delta)} vs prior period`
    };
  }
  const percentage = Math.round((Math.abs(delta) / previous) * 100);
  return {
    direction: delta > 0 ? "up" : "down",
    label: `${delta > 0 ? "+" : "-"}${percentage}% vs prior period`
  };
}

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
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

async function computeSenderWindows(userId: string): Promise<SenderWindowInput[]> {
  const senders = await prisma.senderProfile.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    // NOTE: oauthRefreshToken is read only to derive a `connected` boolean and is
    // never returned to the caller.
    select: { id: true, fromEmail: true, name: true, oauthRefreshToken: true }
  });

  return Promise.all(
    senders.map(async (sender) => ({
      senderProfileId: sender.id,
      senderEmail: sender.fromEmail,
      senderName: sender.name,
      connected: Boolean(sender.oauthRefreshToken),
      window: await getGmailDailySendWindow({ userId, senderProfileId: sender.id })
    }))
  );
}

function resolveSenderPacing(input: {
  connected: boolean;
  ledgerAvailable: boolean;
  isBlocked: boolean;
  sent24h: number;
  utilizationPercent: number;
}): { pacing: SenderPacing; pacingLabel: string } {
  if (!input.connected) {
    return { pacing: "offline", pacingLabel: "Not connected" };
  }
  if (!input.ledgerAvailable) {
    return { pacing: "offline", pacingLabel: "Metrics unavailable" };
  }
  if (input.isBlocked) {
    return { pacing: "blocked", pacingLabel: "Safety limit reached" };
  }
  if (input.sent24h === 0) {
    return { pacing: "idle", pacingLabel: "Idle" };
  }
  if (input.utilizationPercent >= 85) {
    return { pacing: "near-limit", pacingLabel: "Near limit" };
  }
  if (input.utilizationPercent >= 50) {
    return { pacing: "warming", pacingLabel: "Ramping up" };
  }
  return { pacing: "healthy", pacingLabel: "Healthy pace" };
}

export async function getOverviewAnalytics({
  userId,
  window,
  now = new Date(),
  senderWindows = null
}: GetOverviewAnalyticsArgs): Promise<OverviewAnalytics> {
  const { days, since, prevSince, prevUntil } = getWindowConfig(window, now);
  const heatmapSince = new Date(now.getTime() - HEATMAP_DAYS * DAY_MS);

  // Window filter applied to the run / campaign / import that the recipient or
  // record belongs to. `all` omits the lower bound.
  const runWhere: Prisma.CampaignRunWhereInput = {
    campaign: { userId },
    ...(since ? { createdAt: { gte: since } } : {})
  };
  const campaignWindowWhere: Prisma.CampaignWhereInput = {
    userId,
    ...(since ? { createdAt: { gte: since } } : {})
  };
  const importWhere: Prisma.ImportWhereInput = {
    userId,
    ...(since ? { createdAt: { gte: since } } : {})
  };
  const sinceSql = since ? Prisma.sql`AND rj."updatedAt" >= ${since}` : Prisma.empty;
  const templateSinceSql = since ? Prisma.sql`AND c."createdAt" >= ${since}` : Prisma.empty;

  const [
    statusRows,
    repliedCount,
    prevStatusRows,
    prevRepliedCount,
    campaignRows,
    failureSample,
    activityRows,
    templateRows,
    importGroups,
    mappedImports,
    finderAgg,
    activeBySender,
    totalCampaignCount,
    resolvedSenderWindows
  ] = await Promise.all([
    prisma.recipientJob.groupBy({
      by: ["status"],
      where: { campaignRun: runWhere },
      _count: true
    }),
    prisma.recipientJob.count({
      where: { campaignRun: runWhere, repliedAt: { not: null } }
    }),
    since && prevSince && prevUntil
      ? prisma.recipientJob.groupBy({
          by: ["status"],
          where: { campaignRun: { campaign: { userId }, createdAt: { gte: prevSince, lt: prevUntil } } },
          _count: true
        })
      : Promise.resolve([] as Array<{ status: RecipientJobStatus; _count: number }>),
    since && prevSince && prevUntil
      ? prisma.recipientJob.count({
          where: {
            campaignRun: { campaign: { userId }, createdAt: { gte: prevSince, lt: prevUntil } },
            repliedAt: { not: null }
          }
        })
      : Promise.resolve(0),
    prisma.campaign.findMany({
      where: campaignWindowWhere,
      select: {
        id: true,
        status: true,
        runs: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 3 }
      }
    }),
    prisma.recipientJob.findMany({
      where: { campaignRun: runWhere, status: { in: ATTENTION_STATUSES } },
      orderBy: { updatedAt: "desc" },
      take: FAILURE_SAMPLE_SIZE,
      select: { lastError: true, updatedAt: true }
    }),
    prisma.$queryRaw<Array<{ day: Date; sent: number; failed: number; engaged: number }>>`
      SELECT
        date_trunc('day', rj."updatedAt") AS day,
        COUNT(*) FILTER (WHERE rj.status IN ('SENT', 'OPENED', 'CLICKED'))::int AS sent,
        COUNT(*) FILTER (WHERE rj.status IN ('FAILED', 'BOUNCED', 'COMPLAINED', 'INVALID'))::int AS failed,
        COUNT(*) FILTER (WHERE rj.status IN ('OPENED', 'CLICKED'))::int AS engaged
      FROM "RecipientJob" rj
      JOIN "CampaignRun" cr ON cr.id = rj."campaignRunId"
      JOIN "Campaign" c ON c.id = cr."campaignId"
      WHERE c."userId" = ${userId}
        AND rj."updatedAt" >= ${heatmapSince}
      GROUP BY day
      ORDER BY day ASC
    `,
    prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        uses: number;
        sent: number;
        opened: number;
        replied: number;
        last_used: Date | null;
      }>
    >`
      SELECT
        c."templateId" AS id,
        t.name AS name,
        COUNT(DISTINCT c.id)::int AS uses,
        COALESCE(SUM(cr."sentCount"), 0)::int AS sent,
        COALESCE(SUM(cr."openedCount"), 0)::int AS opened,
        COALESCE(SUM(cr."repliedCount"), 0)::int AS replied,
        MAX(cr."updatedAt") AS last_used
      FROM "Campaign" c
      JOIN "Template" t ON t.id = c."templateId"
      LEFT JOIN "CampaignRun" cr ON cr."campaignId" = c.id
      WHERE c."userId" = ${userId}
        ${templateSinceSql}
      GROUP BY c."templateId", t.name
      ORDER BY uses DESC, sent DESC
      LIMIT 6
    `,
    prisma.import.groupBy({
      by: ["status"],
      where: importWhere,
      _count: true,
      _sum: { rowCount: true }
    }),
    prisma.import.count({ where: { ...importWhere, mappings: { some: {} } } }),
    prisma.hunterDomainSearch.aggregate({
      where: { userId, ...(since ? { createdAt: { gte: since } } : {}) },
      _count: true,
      _sum: { resultCount: true }
    }),
    prisma.campaign.groupBy({
      by: ["senderProfileId"],
      where: {
        userId,
        OR: [{ status: "RUNNING" }, { runs: { some: { status: { in: [...ACTIVE_RUN_STATUSES] } } } }]
      },
      _count: true
    }),
    prisma.campaign.count({ where: { userId } }),
    senderWindows ? Promise.resolve(senderWindows) : computeSenderWindows(userId)
  ]);

  // ----- Recipient outcome buckets -----
  const groups = toStatusMap(statusRows);
  const audience = statusRows.reduce((total, row) => total + row._count, 0);
  const delivered = sumStatuses(groups, DELIVERED_STATUSES);
  const opened = sumStatuses(groups, OPENED_STATUSES);
  const queued = sumStatuses(groups, QUEUED_STATUSES);
  const attention = sumStatuses(groups, ATTENTION_STATUSES);
  const replied = repliedCount;
  const completionRate = getNullablePercent(audience - queued, audience);

  const prevGroups = toStatusMap(prevStatusRows);
  const prevDelivered = sumStatuses(prevGroups, DELIVERED_STATUSES);
  const prevOpened = sumStatuses(prevGroups, OPENED_STATUSES);
  const hasPrevious = since !== null;

  const kpis: AnalyticsKpi[] = [
    {
      key: "audience",
      label: "Recipients processed",
      value: audience,
      display: formatCompactNumber(audience),
      format: "count",
      hint: "Across runs in this window",
      tone: "neutral",
      trend: null
    },
    {
      key: "delivered",
      label: "Delivered",
      value: delivered,
      display: formatCompactNumber(delivered),
      format: "count",
      hint: audience > 0 ? `${getPercent(delivered, audience)}% of audience` : "Awaiting first send",
      tone: "success",
      trend: hasPrevious ? buildTrend(delivered, prevDelivered) : null
    },
    {
      key: "opened",
      label: "Opened",
      value: opened,
      display: formatCompactNumber(opened),
      format: "count",
      hint: delivered > 0 ? `${getPercent(opened, delivered)}% open rate` : "No opens tracked yet",
      tone: "accent",
      trend: hasPrevious ? buildTrend(opened, prevOpened) : null
    },
    {
      key: "replied",
      label: "Replies",
      value: replied,
      display: formatCompactNumber(replied),
      format: "count",
      hint: delivered > 0 ? `${getPercent(replied, delivered)}% reply rate` : "No replies yet",
      tone: "success",
      trend: hasPrevious ? buildTrend(replied, prevRepliedCount) : null
    },
    {
      key: "attention",
      label: "Needs attention",
      value: attention,
      display: formatCompactNumber(attention),
      format: "count",
      hint: attention > 0 ? "Failed, invalid or bounced" : "All clear",
      tone: attention > 0 ? "danger" : "neutral",
      trend: null
    },
    {
      key: "completion",
      label: "Completion rate",
      value: completionRate ?? 0,
      display: completionRate === null ? "—" : `${completionRate}%`,
      format: "percent",
      hint: queued > 0 ? `${formatCompactNumber(queued)} still queued` : "No work pending",
      tone: "accent",
      trend: null
    }
  ];

  // ----- Delivery funnel -----
  const funnelRaw: Array<{ key: string; label: string; value: number; tone: FunnelStage["tone"]; convertible: boolean }> = [
    { key: "audience", label: "Audience", value: audience, tone: "neutral", convertible: false },
    { key: "queued", label: "Queued", value: queued, tone: "warning", convertible: false },
    { key: "sent", label: "Sent", value: delivered, tone: "accent", convertible: true },
    { key: "opened", label: "Opened", value: opened, tone: "success", convertible: true },
    { key: "replied", label: "Replied", value: replied, tone: "success", convertible: true },
    { key: "attention", label: "Needs attention", value: attention, tone: "danger", convertible: false }
  ];
  const funnelTop = Math.max(audience, 1);
  let lastConvertibleValue: number | null = null;
  const funnel: FunnelStage[] = funnelRaw.map((stage) => {
    let conversionFromPrev: number | null = null;
    if (stage.convertible && lastConvertibleValue !== null && lastConvertibleValue > 0) {
      conversionFromPrev = Math.round((stage.value / lastConvertibleValue) * 100);
    }
    if (stage.convertible) {
      lastConvertibleValue = stage.value;
    }
    return {
      key: stage.key,
      label: stage.label,
      value: stage.value,
      percentOfTop: stage.value > 0 ? Math.max(3, getPercent(stage.value, funnelTop)) : 0,
      conversionFromPrev,
      tone: stage.tone
    };
  });

  // ----- Activity timeline + heatmap (fixed 30-day daily granularity) -----
  const activityByDay = new Map<string, { sent: number; failed: number; engaged: number }>();
  for (const row of activityRows) {
    activityByDay.set(dayKey(row.day), {
      sent: Number(row.sent) || 0,
      failed: Number(row.failed) || 0,
      engaged: Number(row.engaged) || 0
    });
  }

  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fullSeries: TimelinePoint[] = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i -= 1) {
    const date = new Date(todayUtc.getTime() - i * DAY_MS);
    const key = dayKey(date);
    const entry = activityByDay.get(key) ?? { sent: 0, failed: 0, engaged: 0 };
    fullSeries.push({
      date: date.toISOString(),
      label: dayLabelFormatter.format(date),
      sent: entry.sent,
      failed: entry.failed,
      engaged: entry.engaged
    });
  }

  // Timeline follows the window length (capped at 30 days of daily detail).
  const timelineLength = days === null ? HEATMAP_DAYS : Math.min(days, HEATMAP_DAYS);
  const timelinePoints = fullSeries.slice(fullSeries.length - timelineLength);
  const timelineTotals = timelinePoints.reduce(
    (totals, point) => ({
      sent: totals.sent + point.sent,
      failed: totals.failed + point.failed,
      engaged: totals.engaged + point.engaged
    }),
    { sent: 0, failed: 0, engaged: 0 }
  );
  const timelinePeak = timelinePoints.reduce((peak, point) => Math.max(peak, point.sent, point.failed), 0);

  const heatmapMax = fullSeries.reduce((max, point) => Math.max(max, point.sent), 0);
  const levelFor = (count: number): HeatmapLevel => {
    if (count <= 0 || heatmapMax <= 0) {
      return 0;
    }
    const ratio = count / heatmapMax;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };
  let busiestDay: TimelinePoint | null = null;
  const heatmapDays: HeatmapDay[] = fullSeries.map((point) => {
    if (!busiestDay || point.sent > busiestDay.sent) {
      busiestDay = point;
    }
    const date = new Date(point.date);
    return {
      date: point.date,
      label: point.label,
      weekday: date.getUTCDay(),
      count: point.sent,
      level: levelFor(point.sent)
    };
  });
  const heatmapTotal = heatmapDays.reduce((total, day) => total + day.count, 0);

  // ----- Sequence health distribution (aggregate, not the Recent Sequences UI) -----
  const health = { running: 0, completed: 0, scheduled: 0, attention: 0, draftPaused: 0 };
  for (const campaign of campaignRows) {
    const runStatuses = new Set(campaign.runs.map((run) => run.status));
    if (campaign.status === "RUNNING" || runStatuses.has("RUNNING") || runStatuses.has("QUEUED")) {
      health.running += 1;
    } else if (campaign.status === "FAILED" || campaign.status === "CANCELLED" || runStatuses.has("FAILED")) {
      health.attention += 1;
    } else if (campaign.status === "COMPLETED" || runStatuses.has("COMPLETED")) {
      health.completed += 1;
    } else if (campaign.status === "SCHEDULED") {
      health.scheduled += 1;
    } else {
      health.draftPaused += 1;
    }
  }
  const sequenceHealthSlices: SequenceHealthSlice[] = [
    { key: "running", label: "Running", value: health.running, tone: "accent" },
    { key: "completed", label: "Completed", value: health.completed, tone: "success" },
    { key: "scheduled", label: "Scheduled", value: health.scheduled, tone: "warning" },
    { key: "attention", label: "Needs attention", value: health.attention, tone: "danger" },
    { key: "draft", label: "Draft / paused", value: health.draftPaused, tone: "neutral" }
  ];
  const sequenceHealthTotal = campaignRows.length;

  // ----- Sender utilization -----
  const activeSequenceBySender = new Map<string, number>();
  for (const row of activeBySender) {
    activeSequenceBySender.set(row.senderProfileId, row._count);
  }
  const limit = getDailySendLimit();
  const senders: SenderUtilization[] = resolvedSenderWindows
    .map((sender) => {
      const sent24h = sender.window.sentLast24h;
      const senderLimit = sender.window.limit || limit;
      const utilizationPercent = senderLimit > 0 ? Math.min(100, Math.round((sent24h / senderLimit) * 100)) : 0;
      const { pacing, pacingLabel } = resolveSenderPacing({
        connected: sender.connected,
        ledgerAvailable: sender.window.ledgerAvailable,
        isBlocked: sender.window.isBlocked,
        sent24h,
        utilizationPercent
      });
      return {
        senderProfileId: sender.senderProfileId,
        name: sender.senderName,
        email: sender.senderEmail,
        connected: sender.connected,
        sent24h,
        limit: senderLimit,
        remaining: sender.window.remaining,
        utilizationPercent,
        pacing,
        pacingLabel,
        activeSequences: activeSequenceBySender.get(sender.senderProfileId) ?? 0,
        resetAtLabel: sender.window.resetAt ? formatRelativeTime(sender.window.resetAt) : null,
        ledgerAvailable: sender.window.ledgerAvailable
      } satisfies SenderUtilization;
    })
    .sort((a, b) => b.sent24h - a.sent24h || b.activeSequences - a.activeSequences)
    .slice(0, MAX_SENDERS);

  const sendersNearLimit = senders.filter(
    (sender) => sender.pacing === "near-limit" || sender.pacing === "blocked"
  ).length;

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

  // ----- Template performance -----
  const templates: TemplatePerformance[] = templateRows
    .filter((row) => row.uses > 0)
    .map((row) => ({
      id: row.id,
      name: row.name,
      uses: Number(row.uses) || 0,
      sent: Number(row.sent) || 0,
      opened: Number(row.opened) || 0,
      replied: Number(row.replied) || 0,
      openRate: getNullablePercent(Number(row.opened) || 0, Number(row.sent) || 0),
      lastUsedAt: row.last_used ? row.last_used.toISOString() : null,
      lastUsedLabel: row.last_used ? formatRelativeTime(row.last_used) : null
    }));

  // ----- Import / list quality -----
  let importTotal = 0;
  let importProcessed = 0;
  let importFailed = 0;
  let importRows = 0;
  for (const row of importGroups) {
    importTotal += row._count;
    importRows += row._sum.rowCount ?? 0;
    if (row.status === "PROCESSED") {
      importProcessed += row._count;
    } else if (row.status === "FAILED") {
      importFailed += row._count;
    }
  }
  const imports: ImportQuality = {
    totalImports: importTotal,
    processed: importProcessed,
    failed: importFailed,
    totalRows: importRows,
    averageRows: importTotal > 0 ? Math.round(importRows / importTotal) : 0,
    mappedImports,
    unmappedImports: Math.max(0, importTotal - mappedImports),
    mappedPercent: getNullablePercent(mappedImports, importTotal),
    finderSearches: finderAgg._count,
    finderResults: finderAgg._sum.resultCount ?? 0
  };

  // ----- Action center -----
  const actions: ActionItem[] = [];
  if (health.attention > 0) {
    actions.push({
      key: "attention",
      label: "Sequences need attention",
      detail: "Runs failed or were cancelled and need a review.",
      count: health.attention,
      tone: "attention",
      href: "/campaigns",
      cta: "Review"
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
  if (imports.unmappedImports > 0) {
    actions.push({
      key: "mapping",
      label: "Imports missing field mapping",
      detail: "Map columns before these lists can launch.",
      count: imports.unmappedImports,
      tone: "import",
      href: "/imports",
      cta: "Map fields"
    });
  }

  const isEmpty = totalCampaignCount === 0 && audience === 0 && imports.totalImports === 0;

  return {
    window,
    generatedAt: now.toISOString(),
    isEmpty,
    performance: {
      kpis,
      audience,
      delivered,
      completionRate
    },
    funnel,
    timeline: {
      points: timelinePoints,
      totals: timelineTotals,
      peak: timelinePeak
    },
    sequenceHealth: {
      total: sequenceHealthTotal,
      slices: sequenceHealthSlices
    },
    senders,
    failures,
    templates,
    imports,
    heatmap: {
      days: heatmapDays,
      total: heatmapTotal,
      busiestLabel: busiestDay && (busiestDay as TimelinePoint).sent > 0 ? (busiestDay as TimelinePoint).label : null,
      max: heatmapMax
    },
    actions
  };
}
