import type { Prisma, RecipientJobStatus, RunStatus } from "@prisma/client";

import {
  ANALYSIS_MIN_RANKING_SENDS,
  analysisConfirmedSendKey,
  buildCountComparison,
  buildRateComparison,
  calculateRate,
  classifyAnalysisFailure,
  normalizeAnalysisScheduleType,
  readAnalysisMetadata,
  roundRate,
  type AnalysisPage,
  type AnalysisRange
} from "@/lib/analysis";
import {
  analysisHeatmapBucket,
  analysisLocalWeekdayHour,
  enumerateAnalysisDateKeys,
  formatAnalysisDateKey,
  formatAnalysisInstant,
  instantToAnalysisDateKey
} from "@/lib/analysis-timezone";
import type {
  AnalysisAttentionItem,
  AnalysisBreakdownItem,
  AnalysisEngagementResponse,
  AnalysisHeatmapCell,
  AnalysisJourneyStage,
  AnalysisMetric,
  AnalysisOperationalPoint,
  AnalysisOverviewResponse,
  AnalysisRankedItem,
  AnalysisReliabilityResponse,
  AnalysisResponse,
  AnalysisSenderChange,
  AnalysisSenderItem,
  AnalysisSendersResponse,
  AnalysisSequencePoint,
  AnalysisSequencesResponse,
  AnalysisTemplateItem,
  AnalysisTrendPoint
} from "@/lib/analysis-types";
import { getGmailDailySendWindow } from "@/lib/daily-send-limit";
import { prisma } from "@/lib/db";

const TRACKED_JOB_STATUSES: RecipientJobStatus[] = ["SENT", "OPENED", "CLICKED", "BOUNCED", "COMPLAINED"];
const DIAGNOSTIC_JOB_STATUSES: RecipientJobStatus[] = [
  "FAILED",
  "RETRYING",
  "SUPPRESSED",
  "INVALID",
  "BOUNCED",
  "COMPLAINED",
  "PENDING"
];
const RUN_STATUSES: RunStatus[] = ["QUEUED", "WAITING_FOR_SLOT", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HEATMAP_BLOCKS = ["12a–4a", "4a–8a", "8a–12p", "12p–4p", "4p–8p", "8p–12a"];
const CHART_TONES: AnalysisMetric["tone"][] = ["green", "blue", "purple", "orange", "red"];

type CampaignContext = {
  id: string;
  name: string;
  status: string;
  scheduleType: string | null;
  templateId: string;
  templateName: string;
  senderProfileId: string;
  createdAt: Date;
  updatedAt: Date;
};

type SenderContext = {
  id: string;
  name: string;
  fromEmail: string;
  connected: boolean;
  gmailWatchStatus: string | null;
  gmailWatchExpiresAt: Date | null;
  bounceLastSyncedAt: Date | null;
  lastReplySyncAt: Date | null;
  lastReplySyncError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type PeriodLedgerEntry = {
  id: string;
  recipientJobId: string | null;
  campaignId: string | null;
  campaignRunId: string | null;
  senderProfileId: string | null;
  messageId: string | null;
  sentAt: Date;
};

type PeriodJob = {
  id: string;
  campaignRunId: string;
  status: RecipientJobStatus;
  retryCount: number;
  nextRetryAt: Date | null;
  providerMessageId: string | null;
  repliedAt: Date | null;
  replyCount: number;
  lastError: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

type PeriodRun = {
  id: string;
  campaignId: string;
  status: RunStatus;
  totalRecipients: number;
  progressSnapshot: Prisma.JsonValue;
  waitingForSlotAt: Date | null;
  executionSlotClaimedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PeriodReply = {
  recipientJobId: string | null;
  receivedAt: Date;
};

type PeriodProviderEvent = {
  providerMessageId: string;
  eventType: string;
  createdAt: Date;
};

type PeriodData = {
  start: Date;
  endExclusive: Date;
  timeZone: string;
  ledger: PeriodLedgerEntry[];
  jobs: PeriodJob[];
  runs: PeriodRun[];
  replies: PeriodReply[];
  providerEvents: PeriodProviderEvent[];
  auditEvents: Array<{ action: string; createdAt: Date; metadata: Prisma.JsonValue }>;
};

type ActivityRecord = {
  key: string;
  recipientJobId: string | null;
  campaignId: string | null;
  campaignRunId: string | null;
  senderProfileId: string | null;
  sentAt: Date;
  openedAt: Date | null;
  clickedAt: Date | null;
  repliedAt: Date | null;
  status: RecipientJobStatus | null;
};

type PeriodSummary = {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  activities: ActivityRecord[];
  trends: AnalysisTrendPoint[];
  targeted: number;
  retryable: number;
  permanent: number;
  suppressed: number;
  pacing: number;
  safetyPauses: number;
  failureCounts: Map<string, number>;
};

function inRange(date: Date, start: Date, endExclusive: Date) {
  return date >= start && date < endExclusive;
}

function uniqueLedgerEntries(entries: PeriodLedgerEntry[]) {
  const byRecipient = new Map<string, PeriodLedgerEntry>();
  for (const entry of entries) {
    const key = analysisConfirmedSendKey(entry);
    const existing = byRecipient.get(key);
    if (!existing || entry.sentAt < existing.sentAt) {
      byRecipient.set(key, entry);
    }
  }
  return [...byRecipient.entries()].map(([key, entry]) => ({ key, entry }));
}

function getSnapshotString(value: Prisma.JsonValue, key: string) {
  const snapshot = readAnalysisMetadata(value);
  return typeof snapshot[key] === "string" ? String(snapshot[key]) : null;
}

function metric(args: AnalysisMetric): AnalysisMetric {
  return args;
}

function responseRange(range: AnalysisRange) {
  return { from: range.from, to: range.to, label: range.label, days: range.days, timeZone: range.timeZone };
}

function mapById<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]));
}

function dateLabel(dateKey: string, rangeDays: number, timeZone: string) {
  return formatAnalysisDateKey(dateKey, timeZone, {
    month: rangeDays > 90 ? "short" : undefined,
    day: rangeDays > 90 ? undefined : "numeric",
    weekday: rangeDays > 31 ? undefined : "short"
  });
}

function buildTrendPoints(period: PeriodData, activities: ActivityRecord[]) {
  const points = new Map<string, AnalysisTrendPoint>();
  const keys = enumerateAnalysisDateKeys(
    instantToAnalysisDateKey(period.start, period.timeZone),
    instantToAnalysisDateKey(period.endExclusive, period.timeZone)
  );
  for (const key of keys) {
    points.set(key, {
      date: key,
      label: dateLabel(key, keys.length, period.timeZone),
      sent: 0,
      opened: 0,
      clicked: 0,
      replied: 0,
      openRate: 0,
      clickRate: 0,
      replyRate: 0
    });
  }

  for (const activity of activities) {
    const sentKey = instantToAnalysisDateKey(activity.sentAt, period.timeZone);
    const sentPoint = points.get(sentKey);
    if (sentPoint) sentPoint.sent += 1;

    if (activity.openedAt) {
      const openPoint = points.get(instantToAnalysisDateKey(activity.openedAt, period.timeZone));
      if (openPoint) openPoint.opened += 1;
    }
    if (activity.clickedAt) {
      const clickPoint = points.get(instantToAnalysisDateKey(activity.clickedAt, period.timeZone));
      if (clickPoint) clickPoint.clicked += 1;
    }
    if (activity.repliedAt) {
      const replyPoint = points.get(instantToAnalysisDateKey(activity.repliedAt, period.timeZone));
      if (replyPoint) replyPoint.replied += 1;
    }
  }

  for (const point of points.values()) {
    point.openRate = calculateRate(point.opened, point.sent);
    point.clickRate = calculateRate(point.clicked, point.sent);
    point.replyRate = calculateRate(point.replied, point.sent);
  }

  return [...points.values()];
}

function summarizePeriod(period: PeriodData): PeriodSummary {
  const jobsById = mapById(period.jobs);
  const jobIdByMessageId = new Map<string, string>();
  for (const job of period.jobs) {
    if (job.providerMessageId) jobIdByMessageId.set(job.providerMessageId, job.id);
  }

  const openAtByJob = new Map<string, Date>();
  const clickAtByJob = new Map<string, Date>();
  for (const event of period.providerEvents) {
    const jobId = jobIdByMessageId.get(event.providerMessageId);
    if (!jobId) continue;
    const target = event.eventType === "OPENED" ? openAtByJob : event.eventType === "CLICKED" ? clickAtByJob : null;
    if (!target) continue;
    const current = target.get(jobId);
    if (!current || event.createdAt < current) target.set(jobId, event.createdAt);
  }

  const replyAtByJob = new Map<string, Date>();
  for (const reply of period.replies) {
    if (!reply.recipientJobId) continue;
    const current = replyAtByJob.get(reply.recipientJobId);
    if (!current || reply.receivedAt < current) replyAtByJob.set(reply.recipientJobId, reply.receivedAt);
  }

  const activities: ActivityRecord[] = uniqueLedgerEntries(period.ledger).map(({ key, entry }) => {
    const job = entry.recipientJobId ? jobsById.get(entry.recipientJobId) : null;
    const trackedFallbackAt = job && inRange(job.updatedAt, period.start, period.endExclusive) ? job.updatedAt : null;
    const openedAt = entry.recipientJobId
      ? openAtByJob.get(entry.recipientJobId) ?? (job?.status === "OPENED" ? trackedFallbackAt : null)
      : null;
    const clickedAt = entry.recipientJobId
      ? clickAtByJob.get(entry.recipientJobId) ?? (job?.status === "CLICKED" ? trackedFallbackAt : null)
      : null;
    const repliedAt = entry.recipientJobId ? replyAtByJob.get(entry.recipientJobId) ?? null : null;

    return {
      key,
      recipientJobId: entry.recipientJobId,
      campaignId: entry.campaignId,
      campaignRunId: entry.campaignRunId,
      senderProfileId: entry.senderProfileId,
      sentAt: entry.sentAt,
      openedAt,
      clickedAt,
      repliedAt,
      status: job?.status ?? null
    };
  });

  const runIds = new Set(activities.flatMap((activity) => (activity.campaignRunId ? [activity.campaignRunId] : [])));
  for (const run of period.runs) {
    if (inRange(run.createdAt, period.start, period.endExclusive) || inRange(run.startedAt ?? run.createdAt, period.start, period.endExclusive)) {
      runIds.add(run.id);
    }
  }
  const targeted = period.runs
    .filter((run) => runIds.has(run.id))
    .reduce((total, run) => total + Math.max(0, run.totalRecipients), 0);

  const failureCounts = new Map<string, number>();
  let retryable = 0;
  let permanent = 0;
  let suppressed = 0;
  let pacing = 0;
  for (const job of period.jobs) {
    if (!DIAGNOSTIC_JOB_STATUSES.includes(job.status)) continue;
    const classification = classifyAnalysisFailure(job);
    if (!classification) continue;
    failureCounts.set(classification.category, (failureCounts.get(classification.category) ?? 0) + 1);
    if (classification.disposition === "retryable") retryable += 1;
    if (classification.disposition === "permanent") permanent += 1;
    if (classification.disposition === "suppressed") suppressed += 1;
    if (classification.disposition === "pacing") pacing += 1;
  }

  const safetyPauses = period.runs.filter((run) => {
    const reason = getSnapshotString(run.progressSnapshot, "pauseReason");
    const pausedAtValue = getSnapshotString(run.progressSnapshot, "pausedAt");
    const pausedAt = pausedAtValue ? new Date(pausedAtValue) : run.updatedAt;
    return ["DAILY_SEND_LIMIT", "GMAIL_SENDER_LIMIT"].includes(reason ?? "") && inRange(pausedAt, period.start, period.endExclusive);
  }).length;

  const sent = activities.length;
  const opened = activities.filter((activity) => Boolean(activity.openedAt)).length;
  const clicked = activities.filter((activity) => Boolean(activity.clickedAt)).length;
  const replied = activities.filter((activity) => Boolean(activity.repliedAt)).length;

  return {
    sent,
    opened,
    clicked,
    replied,
    openRate: calculateRate(opened, sent),
    clickRate: calculateRate(clicked, sent),
    replyRate: calculateRate(replied, sent),
    activities,
    trends: buildTrendPoints(period, activities),
    targeted,
    retryable,
    permanent,
    suppressed,
    pacing,
    safetyPauses,
    failureCounts
  };
}

async function loadPeriodData(userId: string, start: Date, endExclusive: Date, timeZone: string): Promise<PeriodData> {
  const ledger = await prisma.sendLedger.findMany({
    where: { userId, sentAt: { gte: start, lt: endExclusive } },
    orderBy: { sentAt: "asc" },
    select: {
      id: true,
      recipientJobId: true,
      campaignId: true,
      campaignRunId: true,
      senderProfileId: true,
      messageId: true,
      sentAt: true
    }
  });
  const ledgerJobIds = [...new Set(ledger.flatMap((entry) => (entry.recipientJobId ? [entry.recipientJobId] : [])))];
  const ledgerRunIds = [...new Set(ledger.flatMap((entry) => (entry.campaignRunId ? [entry.campaignRunId] : [])))];

  const [jobs, runs, replies, auditEvents] = await Promise.all([
    prisma.recipientJob.findMany({
      where: {
        campaignRun: { campaign: { userId } },
        OR: [
          ...(ledgerJobIds.length ? [{ id: { in: ledgerJobIds } }] : []),
          { createdAt: { gte: start, lt: endExclusive } },
          { updatedAt: { gte: start, lt: endExclusive } },
          { repliedAt: { gte: start, lt: endExclusive } }
        ]
      },
      select: {
        id: true,
        campaignRunId: true,
        status: true,
        retryCount: true,
        nextRetryAt: true,
        providerMessageId: true,
        repliedAt: true,
        replyCount: true,
        lastError: true,
        metadata: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.campaignRun.findMany({
      where: {
        campaign: { userId },
        OR: [
          ...(ledgerRunIds.length ? [{ id: { in: ledgerRunIds } }] : []),
          { createdAt: { gte: start, lt: endExclusive } },
          { updatedAt: { gte: start, lt: endExclusive } },
          { startedAt: { gte: start, lt: endExclusive } },
          { completedAt: { gte: start, lt: endExclusive } }
        ]
      },
      select: {
        id: true,
        campaignId: true,
        status: true,
        totalRecipients: true,
        progressSnapshot: true,
        waitingForSlotAt: true,
        executionSlotClaimedAt: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.inboundReply.findMany({
      where: {
        senderProfile: { userId },
        recipientJobId: { not: null },
        receivedAt: { gte: start, lt: endExclusive }
      },
      select: { recipientJobId: true, receivedAt: true }
    }),
    prisma.auditLog.findMany({
      where: { actorUserId: userId, createdAt: { gte: start, lt: endExclusive }, category: "EMAIL_SEND" },
      select: { action: true, createdAt: true, metadata: true },
      orderBy: { createdAt: "asc" }
    })
  ]);

  const messageIds = [...new Set(jobs.flatMap((job) => (job.providerMessageId ? [job.providerMessageId] : [])))];
  const providerEvents = messageIds.length
    ? await prisma.providerEvent.findMany({
        where: {
          providerMessageId: { in: messageIds },
          eventType: { in: ["OPENED", "CLICKED"] },
          createdAt: { gte: start, lt: endExclusive }
        },
        select: { providerMessageId: true, eventType: true, createdAt: true }
      })
    : [];

  return { start, endExclusive, timeZone, ledger, jobs, runs, replies, providerEvents, auditEvents };
}

async function loadContext(userId: string, range: AnalysisRange) {
  const [campaignRows, senderRows, current, previous] = await Promise.all([
    prisma.campaign.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        status: true,
        scheduleType: true,
        templateId: true,
        senderProfileId: true,
        createdAt: true,
        updatedAt: true,
        template: { select: { name: true } }
      }
    }),
    prisma.senderProfile.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        fromEmail: true,
        oauthRefreshToken: true,
        gmailWatchStatus: true,
        gmailWatchExpiresAt: true,
        bounceLastSyncedAt: true,
        lastReplySyncAt: true,
        lastReplySyncError: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    loadPeriodData(userId, range.start, range.endExclusive, range.timeZone),
    loadPeriodData(userId, range.previousStart, range.previousEndExclusive, range.timeZone)
  ]);

  const campaigns: CampaignContext[] = campaignRows.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    scheduleType: campaign.scheduleType,
    templateId: campaign.templateId,
    templateName: campaign.template.name,
    senderProfileId: campaign.senderProfileId,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt
  }));
  const senders: SenderContext[] = senderRows.map(({ oauthRefreshToken, ...sender }) => ({
    ...sender,
    connected: Boolean(oauthRefreshToken)
  }));

  return {
    campaigns,
    senders,
    current,
    previous,
    currentSummary: summarizePeriod(current),
    previousSummary: summarizePeriod(previous)
  };
}

/** Confirmed sends without a tracked open. Derived — never a stored counter. */
function unopenedCount(summary: PeriodSummary) {
  return Math.max(0, summary.sent - summary.opened);
}

function unopenedRate(summary: PeriodSummary) {
  return calculateRate(unopenedCount(summary), summary.sent);
}

function buildCoreMetrics(current: PeriodSummary, previous: PeriodSummary, includeUnopened = false) {
  const metrics: AnalysisMetric[] = [
    metric({
      key: "sent",
      label: "Sent",
      value: current.sent,
      format: "number",
      detail: "Confirmed Gmail sends",
      info: "Unique confirmed recipient sends recorded during the selected local date range.",
      comparison: buildCountComparison(current.sent, previous.sent),
      tone: "green",
      icon: "send"
    }),
    metric({
      key: "opened",
      label: "Opened",
      value: current.opened,
      format: "number",
      detail: `${current.openRate.toFixed(1)}% open rate`,
      info: "Unique confirmed-send recipients with a tracked open. Email-client privacy settings can affect this directional metric.",
      comparison: buildRateComparison(current.openRate, previous.openRate),
      tone: "blue",
      icon: "open"
    })
  ];

  if (includeUnopened) {
    metrics.push(
      metric({
        key: "unopened",
        label: "Unopened",
        value: unopenedCount(current),
        format: "number",
        detail: `${unopenedRate(current).toFixed(1)}% not opened yet`,
        info: "Confirmed sends without a tracked open, derived as sent minus unique opened. Email-client privacy settings can suppress opens, so this is directional.",
        comparison:
          previous.sent > 0
            ? buildRateComparison(unopenedRate(current), unopenedRate(previous))
            : { label: "No prior data", direction: "neutral" as const },
        tone: "orange",
        icon: "unopened"
      })
    );
  }

  metrics.push(
    metric({
      key: "replied",
      label: includeUnopened ? "Replied" : "Replies",
      value: current.replied,
      format: "number",
      detail: `${current.replyRate.toFixed(1)}% reply rate`,
      info: "The percentage of confirmed-send recipients who sent at least one matched Gmail reply.",
      comparison: buildRateComparison(current.replyRate, previous.replyRate),
      tone: "purple",
      icon: "reply"
    })
  );
  return metrics;
}

function buildJourney(summary: PeriodSummary, includeUnopened: boolean): AnalysisJourneyStage[] {
  const stages: AnalysisJourneyStage[] = [
    { name: "Targeted", value: summary.targeted, conversion: null, detail: "Total people queued for outreach" },
    {
      name: "Sent",
      value: summary.sent,
      conversion: calculateRate(summary.sent, summary.targeted),
      detail: "Confirmed Gmail sends"
    },
    {
      name: "Opened",
      value: summary.opened,
      conversion: calculateRate(summary.opened, summary.sent),
      detail: "Unique opens"
    }
  ];
  if (includeUnopened) {
    stages.push({
      name: "Unopened",
      value: unopenedCount(summary),
      conversion: unopenedRate(summary),
      detail: "Confirmed sends not opened"
    });
  }
  stages.push({
    name: "Replied",
    value: summary.replied,
    conversion: calculateRate(summary.replied, summary.sent),
    detail: "Unique replies"
  });
  return stages;
}

function groupSequenceActivity(summary: PeriodSummary, campaigns: CampaignContext[]) {
  const campaignById = mapById(campaigns);
  const grouped = new Map<string, { sent: number; replies: number; opened: number; clicked: number }>();
  for (const activity of summary.activities) {
    if (!activity.campaignId || !campaignById.has(activity.campaignId)) continue;
    const row = grouped.get(activity.campaignId) ?? { sent: 0, replies: 0, opened: 0, clicked: 0 };
    row.sent += 1;
    if (activity.repliedAt) row.replies += 1;
    if (activity.openedAt) row.opened += 1;
    if (activity.clickedAt) row.clicked += 1;
    grouped.set(activity.campaignId, row);
  }
  return grouped;
}

function buildRankedSequences(
  currentSummary: PeriodSummary,
  previousSummary: PeriodSummary,
  campaigns: CampaignContext[]
): AnalysisRankedItem[] {
  const campaignById = mapById(campaigns);
  const current = groupSequenceActivity(currentSummary, campaigns);
  const previous = groupSequenceActivity(previousSummary, campaigns);
  const rows: AnalysisRankedItem[] = [];
  for (const [campaignId, values] of current) {
    if (values.sent < ANALYSIS_MIN_RANKING_SENDS) continue;
    const prior = previous.get(campaignId);
    const replyRate = calculateRate(values.replies, values.sent);
    const priorRate = prior ? calculateRate(prior.replies, prior.sent) : null;
    rows.push({
      name: campaignById.get(campaignId)?.name ?? "Untitled sequence",
      sent: values.sent,
      replies: values.replies,
      replyRate,
      change: priorRate === null ? null : roundRate(replyRate - priorRate),
      detail: priorRate === null ? "Ranked by unique replies; no prior-period sample" : "Reply-rate change vs prior period"
    });
  }
  return rows.sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent);
}

function buildBestDays(summary: PeriodSummary, timeZone: string) {
  const rows = DAY_LABELS.map((name, index) => ({ name, dayIndex: index, sent: 0, replies: 0, replyRate: 0, meetsMinimum: false }));
  for (const activity of summary.activities) {
    const row = rows[analysisLocalWeekdayHour(activity.sentAt, timeZone).weekdayIndex];
    row.sent += 1;
    if (activity.repliedAt) row.replies += 1;
  }
  for (const row of rows) {
    row.replyRate = calculateRate(row.replies, row.sent);
    row.meetsMinimum = row.sent >= ANALYSIS_MIN_RANKING_SENDS;
  }
  return [...rows.slice(1), rows[0]];
}

function buildOutcomeMix(summary: PeriodSummary): AnalysisBreakdownItem[] {
  const replied = summary.activities.filter((item) => Boolean(item.repliedAt)).length;
  const openedOnly = summary.activities.filter((item) => !item.repliedAt && Boolean(item.openedAt)).length;
  const categories: Array<{ name: string; value: number; tone: AnalysisMetric["tone"] }> = [
    { name: "Replied", value: replied, tone: "green" as const },
    { name: "Opened", value: openedOnly, tone: "blue" as const },
    {
      name: "No tracked engagement",
      value: Math.max(0, summary.sent - replied - openedOnly),
      tone: "purple" as const
    }
  ];
  return categories.map((item) => ({ ...item, percent: calculateRate(item.value, summary.sent) }));
}

function buildOverview(
  range: AnalysisRange,
  context: Awaited<ReturnType<typeof loadContext>>
): AnalysisOverviewResponse {
  const { currentSummary, previousSummary } = context;
  const needsAttention = currentSummary.permanent + currentSummary.suppressed;
  const previousNeedsAttention = previousSummary.permanent + previousSummary.suppressed;
  const metrics = buildCoreMetrics(currentSummary, previousSummary);
  metrics.push(
    metric({
      key: "attention",
      label: "Needs attention",
      value: needsAttention,
      format: "number",
      detail: "Permanent, invalid, or suppressed",
      info: "Actionable permanent failures, validation issues, and suppressed recipients. Pacing and safety waits are excluded.",
      comparison: buildCountComparison(needsAttention, previousNeedsAttention),
      tone: "orange",
      icon: "attention"
    })
  );

  const movers = buildRankedSequences(currentSummary, previousSummary, context.campaigns)
    .sort((a, b) => {
      if (a.change !== null && a.change !== undefined && b.change !== null && b.change !== undefined) return b.change - a.change;
      if (a.change !== null && a.change !== undefined) return -1;
      if (b.change !== null && b.change !== undefined) return 1;
      return b.replies - a.replies;
    })
    .slice(0, 4);

  return {
    page: "overview",
    range: responseRange(range),
    generatedAt: new Date().toISOString(),
    hasData: currentSummary.sent > 0 || currentSummary.targeted > 0,
    metrics,
    trends: currentSummary.trends,
    outcomeMix: buildOutcomeMix(currentSummary),
    journey: buildJourney(currentSummary, false),
    bestDays: buildBestDays(currentSummary, range.timeZone),
    topMovers: movers
  };
}

function buildHeatmap(summary: PeriodSummary, timeZone: string): AnalysisHeatmapCell[] {
  const cells = new Map<string, AnalysisHeatmapCell>();
  const orderedDays = [1, 2, 3, 4, 5, 6, 0];
  orderedDays.forEach((dayIndex, displayIndex) => {
    HEATMAP_BLOCKS.forEach((block, blockIndex) => {
      cells.set(`${dayIndex}:${blockIndex}`, {
        day: DAY_LABELS[dayIndex],
        dayIndex: displayIndex,
        block,
        blockIndex,
        sent: 0,
        replies: 0,
        replyRate: 0,
        intensity: 0,
        meetsMinimum: false
      });
    });
  });
  for (const activity of summary.activities) {
    const { weekdayIndex, blockIndex } = analysisHeatmapBucket(activity.sentAt, timeZone);
    const cell = cells.get(`${weekdayIndex}:${blockIndex}`);
    if (!cell) continue;
    cell.sent += 1;
    if (activity.repliedAt) cell.replies += 1;
  }
  let maxQualifiedRate = 0;
  for (const cell of cells.values()) {
    cell.replyRate = calculateRate(cell.replies, cell.sent);
    cell.meetsMinimum = cell.sent >= ANALYSIS_MIN_RANKING_SENDS;
    if (cell.meetsMinimum) maxQualifiedRate = Math.max(maxQualifiedRate, cell.replyRate);
  }
  for (const cell of cells.values()) {
    cell.intensity = cell.meetsMinimum && maxQualifiedRate > 0 ? roundRate(cell.replyRate / maxQualifiedRate, 2) : 0;
  }
  return [...cells.values()].sort((a, b) => a.dayIndex - b.dayIndex || a.blockIndex - b.blockIndex);
}

function buildScheduleBreakdown(summary: PeriodSummary, campaigns: CampaignContext[]): AnalysisBreakdownItem[] {
  const campaignById = mapById(campaigns);
  const counts = new Map<string, number>([
    ["Immediate", 0],
    ["Once", 0],
    ["Recurring", 0]
  ]);
  for (const activity of summary.activities) {
    const schedule = normalizeAnalysisScheduleType(activity.campaignId ? campaignById.get(activity.campaignId)?.scheduleType : null);
    const label = schedule[0].toUpperCase() + schedule.slice(1);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, value], index) => ({
    name,
    value,
    percent: calculateRate(value, summary.sent),
    tone: CHART_TONES[index]
  }));
}

function buildEngagement(
  range: AnalysisRange,
  context: Awaited<ReturnType<typeof loadContext>>
): AnalysisEngagementResponse {
  const { currentSummary, previousSummary } = context;
  return {
    page: "engagement",
    range: responseRange(range),
    generatedAt: new Date().toISOString(),
    hasData: currentSummary.sent > 0 || currentSummary.targeted > 0,
    metrics: buildCoreMetrics(currentSummary, previousSummary, true),
    trends: currentSummary.trends,
    clickAvailable: currentSummary.clicked > 0,
    journey: buildJourney(currentSummary, true),
    heatmap: buildHeatmap(currentSummary, range.timeZone),
    scheduleTypes: buildScheduleBreakdown(currentSummary, context.campaigns)
  };
}

function activeCampaignIds(period: PeriodData, summary: PeriodSummary) {
  const ids = new Set(summary.activities.flatMap((item) => (item.campaignId ? [item.campaignId] : [])));
  for (const run of period.runs) ids.add(run.campaignId);
  return ids;
}

function buildStatusMix(period: PeriodData): AnalysisBreakdownItem[] {
  const counts = new Map<string, number>();
  for (const run of period.runs) {
    const name = run.status === "WAITING_FOR_SLOT" ? "Waiting" : run.status[0] + run.status.slice(1).toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const total = period.runs.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({ name, value, percent: calculateRate(value, total), tone: CHART_TONES[index % CHART_TONES.length] }));
}

function buildSequencePoints(summary: PeriodSummary, period: PeriodData, campaigns: CampaignContext[]): AnalysisSequencePoint[] {
  const campaignById = mapById(campaigns);
  const activity = groupSequenceActivity(summary, campaigns);
  const targetedByCampaign = new Map<string, number>();
  const latestStatusByCampaign = new Map<string, string>();
  for (const run of [...period.runs].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())) {
    targetedByCampaign.set(run.campaignId, (targetedByCampaign.get(run.campaignId) ?? 0) + run.totalRecipients);
    if (!latestStatusByCampaign.has(run.campaignId)) latestStatusByCampaign.set(run.campaignId, run.status);
  }
  return [...activity.entries()].map(([campaignId, row]) => ({
    name: campaignById.get(campaignId)?.name ?? "Untitled sequence",
    sent: row.sent,
    replies: row.replies,
    replyRate: calculateRate(row.replies, row.sent),
    targeted: targetedByCampaign.get(campaignId) ?? row.sent,
    status: latestStatusByCampaign.get(campaignId) ?? campaignById.get(campaignId)?.status ?? "Unknown"
  }));
}

function buildTemplatePerformance(summary: PeriodSummary, campaigns: CampaignContext[]): AnalysisTemplateItem[] {
  const campaignById = mapById(campaigns);
  const grouped = new Map<string, { name: string; sent: number; replies: number; campaigns: Set<string> }>();
  for (const activity of summary.activities) {
    const campaign = activity.campaignId ? campaignById.get(activity.campaignId) : null;
    if (!campaign) continue;
    const row = grouped.get(campaign.templateId) ?? {
      name: campaign.templateName,
      sent: 0,
      replies: 0,
      campaigns: new Set<string>()
    };
    row.sent += 1;
    if (activity.repliedAt) row.replies += 1;
    row.campaigns.add(campaign.id);
    grouped.set(campaign.templateId, row);
  }
  return [...grouped.values()]
    .filter((row) => row.sent >= ANALYSIS_MIN_RANKING_SENDS)
    .map((row) => ({
      name: row.name,
      sent: row.sent,
      replies: row.replies,
      replyRate: calculateRate(row.replies, row.sent),
      usageCount: row.campaigns.size
    }))
    .sort((a, b) => b.replyRate - a.replyRate)
    .slice(0, 6);
}

function buildStandoutRuns(summary: PeriodSummary, period: PeriodData, campaigns: CampaignContext[]) {
  const campaignById = mapById(campaigns);
  const runById = mapById(period.runs);
  const grouped = new Map<string, { sent: number; replies: number }>();
  for (const activity of summary.activities) {
    if (!activity.campaignRunId) continue;
    const row = grouped.get(activity.campaignRunId) ?? { sent: 0, replies: 0 };
    row.sent += 1;
    if (activity.repliedAt) row.replies += 1;
    grouped.set(activity.campaignRunId, row);
  }
  return [...grouped.entries()]
    .filter(([, row]) => row.sent >= ANALYSIS_MIN_RANKING_SENDS)
    .map(([runId, row]) => {
      const run = runById.get(runId);
      const campaign = run ? campaignById.get(run.campaignId) : null;
      return {
        name: campaign?.name ?? "Untitled sequence",
        sent: row.sent,
        replies: row.replies,
        replyRate: calculateRate(row.replies, row.sent),
        detail: run
          ? `Run ${formatAnalysisInstant(run.createdAt, period.timeZone, { month: "short", day: "numeric" })}`
          : "Selected-period run"
      };
    })
    .sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent)
    .slice(0, 5);
}

function buildSequences(
  range: AnalysisRange,
  context: Awaited<ReturnType<typeof loadContext>>
): AnalysisSequencesResponse {
  const { current, previous, currentSummary, previousSummary, campaigns } = context;
  const currentIds = activeCampaignIds(current, currentSummary);
  for (const campaign of campaigns) {
    if (inRange(campaign.createdAt, current.start, current.endExclusive)) currentIds.add(campaign.id);
  }
  const previousIds = activeCampaignIds(previous, previousSummary);
  const ranked = buildRankedSequences(currentSummary, previousSummary, campaigns);
  const sequencePoints = buildSequencePoints(currentSummary, current, campaigns);
  const runningNow = campaigns.filter(
    (campaign) => currentIds.has(campaign.id) && (campaign.status === "RUNNING" || current.runs.some((run) => run.campaignId === campaign.id && run.status === "RUNNING"))
  ).length;
  const needsReviewIds = new Set<string>();
  for (const point of sequencePoints) {
    const campaign = campaigns.find((item) => item.name === point.name);
    if (campaign && ((point.sent >= ANALYSIS_MIN_RANKING_SENDS && point.replyRate < 5) || point.status === "FAILED")) {
      needsReviewIds.add(campaign.id);
    }
  }
  for (const job of current.jobs) {
    const failure = classifyAnalysisFailure(job);
    if (failure?.disposition !== "permanent") continue;
    const run = current.runs.find((item) => item.id === job.campaignRunId);
    if (run) needsReviewIds.add(run.campaignId);
  }
  const best = ranked[0] ?? null;
  const previousRanked = buildRankedSequences(previousSummary, { ...previousSummary, activities: [] }, campaigns);

  return {
    page: "sequences",
    range: responseRange(range),
    generatedAt: new Date().toISOString(),
    hasData: currentIds.size > 0,
    metrics: [
      metric({
        key: "total-sequences",
        label: "Total sequences",
        value: currentIds.size,
        format: "number",
        detail: "Active in selected range",
        info: "Distinct sequences created or carrying run/send activity in the selected date range.",
        comparison: buildCountComparison(currentIds.size, previousIds.size),
        tone: "green",
        icon: "sequence"
      }),
      metric({
        key: "running",
        label: "Running now",
        value: runningNow,
        format: "number",
        detail: currentIds.size ? `${calculateRate(runningNow, currentIds.size).toFixed(1)}% of selected sequences` : "No selected sequences",
        info: "Selected-period sequences whose current campaign or latest selected run state is Running.",
        tone: "blue",
        icon: "play"
      }),
      metric({
        key: "best-rate",
        label: "Best reply rate",
        value: best?.replyRate ?? 0,
        format: "percent",
        detail: best?.name ?? `Requires at least ${ANALYSIS_MIN_RANKING_SENDS} sends`,
        info: `Highest unique-recipient reply rate among sequences with at least ${ANALYSIS_MIN_RANKING_SENDS} confirmed sends.`,
        comparison: best ? buildRateComparison(best.replyRate, previousRanked[0]?.replyRate ?? 0) : undefined,
        tone: "purple",
        icon: "trend",
        unavailable: !best
      }),
      metric({
        key: "needs-review",
        label: "Needs review",
        value: needsReviewIds.size,
        format: "number",
        detail: "Failures or low reply rate",
        info: "Sequences with permanent recipient failures, a failed state, or under 5% replies after the minimum sample.",
        tone: "orange",
        icon: "attention"
      })
    ],
    topSequences: ranked.slice(0, 6),
    sequencePoints,
    templates: buildTemplatePerformance(currentSummary, campaigns),
    statusMix: buildStatusMix(current),
    standoutRuns: buildStandoutRuns(currentSummary, current, campaigns)
  };
}

function buildFailureBreakdown(summary: PeriodSummary) {
  const total = [...summary.failureCounts.values()].reduce((sum, value) => sum + value, 0);
  return [...summary.failureCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      percent: calculateRate(value, total),
      tone: CHART_TONES[index % CHART_TONES.length]
    }))
    .slice(0, 8);
}

function buildOperationalEvents(period: PeriodData): AnalysisOperationalPoint[] {
  const points = new Map<string, AnalysisOperationalPoint>();
  const keys = enumerateAnalysisDateKeys(
    instantToAnalysisDateKey(period.start, period.timeZone),
    instantToAnalysisDateKey(period.endExclusive, period.timeZone)
  );
  for (const key of keys) {
    points.set(key, { date: key, label: dateLabel(key, keys.length, period.timeZone), retries: 0, pauses: 0, resumed: 0 });
  }
  for (const job of period.jobs) {
    if (job.retryCount <= 0) continue;
    const point = points.get(instantToAnalysisDateKey(job.updatedAt, period.timeZone));
    if (point) point.retries += job.retryCount;
  }
  for (const run of period.runs) {
    const pausedAt = getSnapshotString(run.progressSnapshot, "pausedAt");
    if (pausedAt) {
      const point = points.get(instantToAnalysisDateKey(new Date(pausedAt), period.timeZone));
      if (point) point.pauses += 1;
    }
  }
  for (const event of period.auditEvents) {
    const point = points.get(instantToAnalysisDateKey(event.createdAt, period.timeZone));
    if (!point) continue;
    if (event.action.includes("limit_reached") || event.action.includes("paused")) point.pauses += 1;
    if (event.action.includes("resumed")) point.resumed += 1;
  }
  return [...points.values()];
}

function buildAttention(
  current: PeriodSummary,
  previous: PeriodSummary,
  senders: SenderContext[]
): AnalysisAttentionItem[] {
  const items: AnalysisAttentionItem[] = [];
  const invalid = current.failureCounts.get("Invalid recipient") ?? 0;
  const invalidRate = calculateRate(invalid, Math.max(current.sent + current.permanent + current.retryable, 1));
  if (invalid > 0 && invalidRate >= 5) {
    items.push({
      title: "High invalid recipients",
      detail: `${invalid.toLocaleString()} recipients (${invalidRate.toFixed(1)}%)`,
      action: "Review list hygiene",
      tone: "orange"
    });
  }
  if (current.safetyPauses > previous.safetyPauses && current.safetyPauses > 0) {
    items.push({
      title: "Increased safety pauses",
      detail: `${current.safetyPauses} vs ${previous.safetyPauses} prior period`,
      action: "Review rolling sender capacity",
      tone: "purple"
    });
  }
  if (current.permanent > previous.permanent && current.permanent > 0) {
    items.push({
      title: "Rising permanent failures",
      detail: `${current.permanent} vs ${previous.permanent} prior period`,
      action: "Check recipient and sender health",
      tone: "red"
    });
  }
  const reconnectCount = senders.filter((sender) => !sender.connected || ["RECONNECT_REQUIRED", "PERMISSION_REQUIRED", "RENEWAL_FAILED"].includes(sender.gmailWatchStatus ?? "")).length;
  if (reconnectCount > 0) {
    items.push({
      title: "Sender reconnect needed",
      detail: `${reconnectCount} sender${reconnectCount === 1 ? "" : "s"} require attention`,
      action: "Reconnect from Account",
      tone: "orange"
    });
  }
  const mappingSkips = current.failureCounts.get("Missing variables") ?? 0;
  if (mappingSkips > 0) {
    items.push({
      title: "Mapping-related skips",
      detail: `${mappingSkips} recipients missing variables`,
      action: "Review mapping and template variables",
      tone: "red"
    });
  }
  return items.slice(0, 4);
}

async function loadCurrentPacing(userId: string) {
  const now = new Date();
  const jobs = await prisma.recipientJob.findMany({
    where: {
      campaignRun: { campaign: { userId } },
      status: "PENDING",
      OR: [{ nextRetryAt: { gt: now } }, { campaignRun: { status: "PAUSED" } }]
    },
    select: { metadata: true, nextRetryAt: true }
  });
  const pacingJobs = jobs.filter((job) => {
    const blockedBy = readAnalysisMetadata(job.metadata).blockedBy;
    return ["DAILY_SEND_LIMIT", "GMAIL_SENDER_LIMIT", "GMAIL_SENDER_PACING"].includes(String(blockedBy));
  });
  const recoveryDates = pacingJobs
    .flatMap((job) => (job.nextRetryAt ? [job.nextRetryAt] : []))
    .sort((a, b) => a.getTime() - b.getTime());
  return { count: pacingJobs.length, nextRecoveryAt: recoveryDates[0]?.toISOString() ?? null };
}

async function buildReliability(
  userId: string,
  range: AnalysisRange,
  context: Awaited<ReturnType<typeof loadContext>>
): Promise<AnalysisReliabilityResponse> {
  const { currentSummary, previousSummary } = context;
  const currentPacing = await loadCurrentPacing(userId);
  const metrics: AnalysisMetric[] = [
    metric({
      key: "successful",
      label: "Successful sends",
      value: currentSummary.sent,
      format: "number",
      detail: "Confirmed sends only",
      info: "Confirmed Gmail sends only. Failed, invalid, suppressed, skipped, and pacing-wait recipients are excluded.",
      comparison: buildCountComparison(currentSummary.sent, previousSummary.sent),
      tone: "green",
      icon: "check"
    }),
    metric({
      key: "retryable",
      label: "Retryable issues",
      value: currentSummary.retryable,
      format: "number",
      detail: "Temporary diagnostics",
      info: "Recipient jobs with explicitly retryable provider or system diagnostics. Benign pacing waits are excluded.",
      comparison: buildCountComparison(currentSummary.retryable, previousSummary.retryable),
      tone: "orange",
      icon: "retry"
    }),
    metric({
      key: "permanent",
      label: "Permanent failures",
      value: currentSummary.permanent,
      format: "number",
      detail: "Non-retryable recipients",
      info: "Non-retryable recipient or provider failures. Suppressions and Gmail safety/pacing waits are excluded.",
      comparison: buildCountComparison(currentSummary.permanent, previousSummary.permanent),
      tone: "red",
      icon: "failure"
    }),
    metric({
      key: "pauses",
      label: "Safety pauses",
      value: currentSummary.safetyPauses,
      format: "number",
      detail: "Daily-limit or sender-limit pauses",
      info: "Runs paused by Sendloom safety controls. These waits never count as permanent recipient failures.",
      comparison: buildCountComparison(currentSummary.safetyPauses, previousSummary.safetyPauses),
      tone: "purple",
      icon: "pause"
    })
  ];

  return {
    page: "reliability",
    range: responseRange(range),
    generatedAt: new Date().toISOString(),
    hasData: currentSummary.sent > 0 || currentSummary.failureCounts.size > 0 || context.current.runs.length > 0,
    metrics,
    failureReasons: buildFailureBreakdown(currentSummary),
    runStates: buildStatusMix(context.current),
    operationalEvents: buildOperationalEvents(context.current),
    pacing: {
      waitingRecipients: currentPacing.count,
      sendWindowPauses: currentSummary.safetyPauses,
      nextRecoveryAt: currentPacing.nextRecoveryAt
    },
    attention: buildAttention(currentSummary, previousSummary, context.senders)
  };
}

function senderHealth(sender: SenderContext, pacingSenderIds: Set<string>): AnalysisSenderItem["health"] {
  if (!sender.connected || ["RECONNECT_REQUIRED", "PERMISSION_REQUIRED", "RENEWAL_FAILED"].includes(sender.gmailWatchStatus ?? "") || sender.lastReplySyncError) {
    return "Reconnect needed";
  }
  if (pacingSenderIds.has(sender.id)) return "Pacing wait";
  if (sender.lastReplySyncAt || sender.bounceLastSyncedAt || sender.gmailWatchStatus === "ACTIVE") return "Synced";
  return "Healthy";
}

function buildRecentSenderChanges(
  range: AnalysisRange,
  senders: SenderContext[],
  period: PeriodData,
  pacingSenderIds: Set<string>
): AnalysisSenderChange[] {
  const changes: AnalysisSenderChange[] = [];
  for (const sender of senders) {
    if (
      inRange(sender.updatedAt, range.start, range.endExclusive) &&
      (!sender.connected || ["RECONNECT_REQUIRED", "PERMISSION_REQUIRED", "RENEWAL_FAILED"].includes(sender.gmailWatchStatus ?? ""))
    ) {
      changes.push({
        title: "Gmail reconnect required",
        detail: `${sender.fromEmail} · ${sender.lastReplySyncError ? "Reply synchronization needs attention." : "The Gmail connection needs attention."}`,
        at: sender.updatedAt.toISOString(),
        tone: "orange"
      });
    }
    if (sender.lastReplySyncAt && inRange(sender.lastReplySyncAt, range.start, range.endExclusive)) {
      changes.push({
        title: "Gmail replies synchronized successfully",
        detail: `${sender.fromEmail} · The latest reply sync completed.`,
        at: sender.lastReplySyncAt.toISOString(),
        tone: "blue"
      });
    }
    if (sender.bounceLastSyncedAt && inRange(sender.bounceLastSyncedAt, range.start, range.endExclusive)) {
      changes.push({
        title: "Delivery-health status refreshed",
        detail: `${sender.fromEmail} · Recent bounce status synchronized.`,
        at: sender.bounceLastSyncedAt.toISOString(),
        tone: "green"
      });
    }
    if (pacingSenderIds.has(sender.id)) {
      const run = period.runs.find((candidate) => getSnapshotString(candidate.progressSnapshot, "pausedSenderProfileId") === sender.id);
      if (run) {
        changes.push({
          title: "Sender entered a pacing wait",
          detail: `${sender.fromEmail} · Waiting for Gmail sender capacity.`,
          at: getSnapshotString(run.progressSnapshot, "pausedAt") ?? run.updatedAt.toISOString(),
          tone: "purple"
        });
      }
    }
  }
  const seen = new Set<string>();
  return changes
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .filter((change) => {
      const key = `${change.title}\u0000${change.detail}\u0000${change.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

async function buildSenders(
  userId: string,
  range: AnalysisRange,
  context: Awaited<ReturnType<typeof loadContext>>
): Promise<AnalysisSendersResponse> {
  const { currentSummary, previousSummary, senders } = context;
  const senderActivity = new Map<string, { sent: number; opened: number; replied: number }>();
  for (const activity of currentSummary.activities) {
    if (!activity.senderProfileId) continue;
    const row = senderActivity.get(activity.senderProfileId) ?? { sent: 0, opened: 0, replied: 0 };
    row.sent += 1;
    if (activity.openedAt) row.opened += 1;
    if (activity.repliedAt) row.replied += 1;
    senderActivity.set(activity.senderProfileId, row);
  }
  const pacingSenderIds = new Set<string>();
  for (const run of context.current.runs) {
    const reason = getSnapshotString(run.progressSnapshot, "pauseReason");
    const senderId = getSnapshotString(run.progressSnapshot, "pausedSenderProfileId");
    if (senderId && ["DAILY_SEND_LIMIT", "GMAIL_SENDER_LIMIT"].includes(reason ?? "")) pacingSenderIds.add(senderId);
  }

  const senderResults: Array<{ item: AnalysisSenderItem; connected: boolean }> = await Promise.all(
    senders.map(async (sender) => {
      const activity = senderActivity.get(sender.id) ?? { sent: 0, opened: 0, replied: 0 };
      let window: Awaited<ReturnType<typeof getGmailDailySendWindow>> | null = null;
      if (sender.connected) {
        try {
          window = await getGmailDailySendWindow({ userId, senderProfileId: sender.id });
        } catch (error) {
          console.error("[analysis] Could not load sender capacity.", { senderProfileId: sender.id, error });
        }
      }
      const limit = window?.limit ?? 0;
      const used = window?.sentLast24h ?? 0;
      return {
        connected: sender.connected,
        item: {
          name: sender.name,
          email: sender.fromEmail,
          sent: activity.sent,
          opened: activity.opened,
          replied: activity.replied,
          replyRate: calculateRate(activity.replied, activity.sent),
          capacity: {
            limit,
            used,
            remaining: window?.remaining ?? (sender.connected ? limit : 0),
            percentUsed: calculateRate(used, limit),
            resetAt: window?.resetAt ?? null,
            available: Boolean(window?.ledgerAvailable && sender.connected)
          },
          health: senderHealth(sender, pacingSenderIds)
        }
      };
    })
  );
  const senderItems = senderResults.map((sender) => sender.item);
  const connected = senderResults.filter((sender) => sender.connected).map((sender) => sender.item);
  const totalCapacity = connected.reduce((sum, sender) => sum + sender.capacity.limit, 0);
  const remainingCapacity = connected.reduce((sum, sender) => sum + sender.capacity.remaining, 0);
  const previousConnected = senders.filter(
    (sender) => sender.connected && sender.createdAt < range.previousEndExclusive
  ).length;
  const healthCounts = new Map<string, number>();
  for (const sender of senderItems) healthCounts.set(sender.health, (healthCounts.get(sender.health) ?? 0) + 1);

  return {
    page: "senders",
    range: responseRange(range),
    generatedAt: new Date().toISOString(),
    hasData: senderItems.length > 0,
    metrics: [
      metric({
        key: "connected",
        label: "Connected senders",
        value: connected.length,
        format: "number",
        detail: `${senderItems.length} sender profile${senderItems.length === 1 ? "" : "s"}`,
        info: "Sender profiles with an active stored Gmail connection. Credentials are never returned to this page.",
        comparison: buildCountComparison(connected.length, previousConnected),
        tone: "green",
        icon: "sender"
      }),
      metric({
        key: "total-sent",
        label: "Total sent",
        value: currentSummary.sent,
        format: "number",
        detail: "Confirmed in selected range",
        info: "Unique confirmed Gmail recipient sends in the selected range, grouped by connected sender.",
        comparison: buildCountComparison(currentSummary.sent, previousSummary.sent),
        tone: "blue",
        icon: "send"
      }),
      metric({
        key: "reply-rate",
        label: "Avg reply rate",
        value: currentSummary.replyRate,
        format: "percent",
        detail: `${currentSummary.replied.toLocaleString()} unique ${currentSummary.replied === 1 ? "recipient" : "recipients"} replied`,
        info: "Unique recipients who replied divided by confirmed sends across all connected senders in the selected period.",
        comparison: buildRateComparison(currentSummary.replyRate, previousSummary.replyRate),
        tone: "purple",
        icon: "reply"
      }),
      metric({
        key: "capacity",
        label: "Remaining capacity",
        value: calculateRate(remainingCapacity, totalCapacity),
        format: "percent",
        detail: `${remainingCapacity.toLocaleString()} / ${totalCapacity.toLocaleString()} rolling 24h`,
        info: "Current remaining rolling 24-hour Gmail safety capacity using the configured per-sender limit.",
        tone: "orange",
        icon: "capacity",
        unavailable: totalCapacity === 0
      })
    ],
    senders: senderItems,
    health: [...healthCounts.entries()].map(([name, value], index) => ({
      name,
      value,
      percent: calculateRate(value, senderItems.length),
      tone: CHART_TONES[index % CHART_TONES.length]
    })),
    recentChanges: buildRecentSenderChanges(range, senders, context.current, pacingSenderIds),
    capacityLimit: Math.max(0, ...senderItems.map((sender) => sender.capacity.limit))
  };
}

export async function getAnalysisPageData(args: {
  userId: string;
  page: AnalysisPage;
  range: AnalysisRange;
}): Promise<AnalysisResponse> {
  const context = await loadContext(args.userId, args.range);
  switch (args.page) {
    case "overview":
      return buildOverview(args.range, context);
    case "engagement":
      return buildEngagement(args.range, context);
    case "sequences":
      return buildSequences(args.range, context);
    case "reliability":
      return buildReliability(args.userId, args.range, context);
    case "senders":
      return buildSenders(args.userId, args.range, context);
  }
}
