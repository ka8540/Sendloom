import type { Route } from "next";
import Link from "next/link";
import { after } from "next/server";
import type { CampaignStatus, RecipientJobStatus, RunStatus } from "@prisma/client";
import {
  ArrowRight,
  Check,
  FileSpreadsheet,
  SendHorizontal,
  Sparkles
} from "lucide-react";

import { requireOperatorUser } from "@/lib/auth";
import { getGmailDailySendWindow } from "@/lib/daily-send-limit";
import { prisma } from "@/lib/db";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { AnalyticsPulse, type PulseHealthSlice } from "@/components/dashboard/analytics-pulse";
import { buildActivityItems } from "@/components/dashboard/activity-builder";
import { formatCompactNumber, formatRelativeTime, buildTrend, humanizeEnum } from "@/components/dashboard/formatters";
import { OverviewSummary, type SendWindowSender, type TemplateFormatSlice } from "@/components/dashboard/overview-summary";
import { OverviewTourLauncher } from "@/components/dashboard/overview-tour-launcher";
import { SequencePanel } from "@/components/dashboard/sequence-panel";
import { buildSequenceOutcomePresentation } from "@/components/dashboard/sequence-outcome";
import type {
  SequenceMetric,
  SequenceRowData,
  SequenceScheduleType
} from "@/components/dashboard/types";
import { processPendingCampaignWork, readDailyLimitPauseInfo, resumeCampaignRunsBlockedByDailyLimit } from "@/services/campaigns";
import { listHunterDomainSearchesForUser } from "@/services/hunter-domain-searches";
import {
  summarizeOverviewRun,
  type RecipientOverviewInput
} from "@/lib/recipient-overview-disposition";
import styles from "./overview-command-center.module.css";

const PROCESSING_RUN_STATUSES: RunStatus[] = ["QUEUED", "RUNNING"];
const OPEN_RUN_STATUSES: RunStatus[] = ["QUEUED", "WAITING_FOR_SLOT", "RUNNING"];
const DONE_RUN_STATUSES = new Set<RunStatus>(["COMPLETED", "FAILED", "CANCELLED"]);
const OVERVIEW_OUTCOME_STATUSES: RecipientJobStatus[] = [
  "FAILED",
  "RETRYING",
  "SUPPRESSED",
  "INVALID",
  "BOUNCED",
  "COMPLAINED"
];

function getDeliveredCount(run?: {
  sentCount?: number | null;
  openedCount?: number | null;
  clickedCount?: number | null;
} | null) {
  return (run?.sentCount ?? 0) + (run?.openedCount ?? 0) + (run?.clickedCount ?? 0);
}

function getProcessedCount(run?: {
  sentCount?: number | null;
  openedCount?: number | null;
  clickedCount?: number | null;
  failedCount?: number | null;
  suppressedCount?: number | null;
  invalidCount?: number | null;
} | null) {
  return (
    getDeliveredCount(run) +
    (run?.failedCount ?? 0) +
    (run?.suppressedCount ?? 0) +
    (run?.invalidCount ?? 0)
  );
}

function hasKnownRunMetrics(
  run:
    | {
        status?: RunStatus | null;
        totalRecipients?: number | null;
      }
    | null
    | undefined,
  processedCount: number
) {
  if (!run || !run.totalRecipients || run.totalRecipients <= 0) {
    return false;
  }

  return !OPEN_RUN_STATUSES.includes(run.status ?? "COMPLETED") || processedCount > 0;
}

export default async function OverviewCommandCenter() {
  const user = await requireOperatorUser();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  await resumeCampaignRunsBlockedByDailyLimit(now);

  const [
    processedImportCount,
    importCountThisWeek,
    mappedProcessedImportCount,
    campaignCount,
    templateCount,
    templateCountThisWeek,
    templateFormatGroups,
    activeSequenceCount,
    validatedSequenceCount,
    sentPreviousDay,
    recentCampaigns,
    recentRuns,
    recentImports,
    recentTemplates,
    connectedSenders,
    userSendWindow
  ] = await Promise.all([
    prisma.import.count({
      where: {
        userId: user.id,
        status: "PROCESSED"
      }
    }),
    prisma.import.count({
      where: {
        userId: user.id,
        createdAt: {
          gte: weekAgo
        }
      }
    }),
    // Processed imports that already have a field mapping — i.e. ready to launch.
    prisma.import.count({
      where: {
        userId: user.id,
        status: "PROCESSED",
        mappings: { some: {} }
      }
    }),
    prisma.campaign.count({
      where: {
        userId: user.id
      }
    }),
    prisma.template.count({
      where: {
        userId: user.id
      }
    }),
    prisma.template.count({
      where: {
        userId: user.id,
        updatedAt: {
          gte: weekAgo
        }
      }
    }),
    // Template count by format, for the Templates card breakdown.
    prisma.template.groupBy({
      by: ["format"],
      where: { userId: user.id },
      _count: true
    }),
    prisma.campaign.count({
      where: {
        userId: user.id,
        OR: [
          { status: "RUNNING" },
          {
            runs: {
              some: {
                status: { in: PROCESSING_RUN_STATUSES },
                executionSlotClaimedAt: { not: null }
              }
            }
          }
        ]
      }
    }),
    prisma.campaign.count({
      where: {
        userId: user.id,
        lastValidatedAt: {
          not: null
        }
      }
    }),
    prisma.campaignRun.aggregate({
      where: {
        campaign: { userId: user.id },
        updatedAt: {
          gte: twoDaysAgo,
          lt: dayAgo
        }
      },
      _sum: { sentCount: true }
    }),
    prisma.campaign.findMany({
      where: {
        userId: user.id
      },
      orderBy: {
        updatedAt: "desc"
      },
      include: {
        import: {
          select: {
            fileName: true
          }
        },
        template: {
          select: {
            name: true
          }
        },
        senderProfile: {
          select: {
            name: true,
            fromEmail: true
          }
        },
        runs: {
          orderBy: {
            createdAt: "desc"
          },
          take: 2,
          select: {
            id: true,
            status: true,
            totalRecipients: true,
            sentCount: true,
            failedCount: true,
            suppressedCount: true,
            invalidCount: true,
            openedCount: true,
            clickedCount: true,
            createdAt: true,
            updatedAt: true,
            progressSnapshot: true
          }
        }
      }
    }),
    prisma.campaignRun.findMany({
      where: {
        campaign: {
          userId: user.id
        }
      },
      take: 5,
      orderBy: {
        updatedAt: "desc"
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true
          }
        },
        recipientJobs: {
          where: { status: { in: OVERVIEW_OUTCOME_STATUSES } },
          select: {
            status: true,
            metadata: true,
            lastError: true
          }
        }
      }
    }),
    prisma.import.findMany({
      where: {
        userId: user.id
      },
      take: 4,
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        id: true,
        fileName: true,
        rowCount: true,
        status: true,
        updatedAt: true
      }
    }),
    prisma.template.findMany({
      where: {
        userId: user.id
      },
      take: 4,
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        id: true,
        name: true,
        format: true,
        updatedAt: true
      }
    }),
    prisma.senderProfile.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fromEmail: true,
        name: true,
        oauthRefreshToken: true
      }
    }),
    getGmailDailySendWindow({ userId: user.id })
  ]);

  const sendWindowSenders: SendWindowSender[] = await Promise.all(
    connectedSenders.map(async (sender) => ({
      senderProfileId: sender.id,
      senderEmail: sender.fromEmail,
      senderName: sender.name,
      connected: Boolean(sender.oauthRefreshToken),
      window: await getGmailDailySendWindow({
        userId: user.id,
        senderProfileId: sender.id
      })
    }))
  );

  const blockedSenderProfileIds = new Set(
    sendWindowSenders.filter((sender) => sender.window.isBlocked).map((sender) => sender.senderProfileId)
  );
  const blockedResumeBySenderProfileId = new Map<string, string | null>(
    sendWindowSenders
      .filter((sender) => sender.window.isBlocked)
      .map((sender) => [sender.senderProfileId, sender.window.resetAt])
  );

  // For each campaign, determine which run to display metrics from.
  // If the latest run is QUEUED/RUNNING with 0 processed and a completed run exists,
  // use the completed run so recurring sequences show real metrics instead of zeros.
  const campaignDisplayRunInfo = new Map<
    string,
    { displayRun: (typeof recentCampaigns)[0]["runs"][0] | null; isFromPreviousRun: boolean }
  >();
  for (const campaign of recentCampaigns) {
    const activeRun = campaign.runs.find((r) => OPEN_RUN_STATUSES.includes(r.status)) ?? null;
    const completedRun = campaign.runs.find((r) => DONE_RUN_STATUSES.has(r.status)) ?? null;
    let displayRun: (typeof campaign.runs)[0] | null = null;
    let isFromPreviousRun = false;
    if (activeRun) {
      const activeProcessed = getProcessedCount(activeRun);
      if (activeProcessed === 0 && completedRun) {
        displayRun = completedRun;
        isFromPreviousRun = true;
      } else {
        displayRun = activeRun;
      }
    } else {
      displayRun = completedRun;
    }
    campaignDisplayRunInfo.set(campaign.id, { displayRun, isFromPreviousRun });
  }

  const latestRunIds = recentCampaigns.flatMap((campaign) => {
    const info = campaignDisplayRunInfo.get(campaign.id);
    return info?.displayRun ? [info.displayRun.id] : [];
  });
  const [latestRunCountRows, latestRunRecipientRows] = latestRunIds.length
    ? await Promise.all([
        prisma.recipientJob.groupBy({
          by: ["campaignRunId", "status"],
          where: { campaignRunId: { in: latestRunIds } },
          _count: true
        }),
        prisma.recipientJob.findMany({
          where: {
            campaignRunId: { in: latestRunIds },
            status: { in: OVERVIEW_OUTCOME_STATUSES }
          },
          select: {
            campaignRunId: true,
            status: true,
            metadata: true,
            lastError: true
          }
        })
      ])
    : [[], []];
  const latestRunCounts = new Map<string, Record<string, number>>();
  const latestRunRecipients = new Map<string, RecipientOverviewInput[]>();

  for (const row of latestRunCountRows) {
    const counts = latestRunCounts.get(row.campaignRunId) ?? {};
    counts[row.status] = row._count;
    latestRunCounts.set(row.campaignRunId, counts);
  }

  for (const row of latestRunRecipientRows) {
    const recipients = latestRunRecipients.get(row.campaignRunId) ?? [];
    recipients.push(row);
    latestRunRecipients.set(row.campaignRunId, recipients);
  }

  const overviewCampaigns = recentCampaigns.map((campaign) => {
    const actualLatestRun = campaign.runs[0] ?? null;
    const { displayRun, isFromPreviousRun } = campaignDisplayRunInfo.get(campaign.id) ?? {
      displayRun: null,
      isFromPreviousRun: false
    };
    const latestRunCountsByStatus = displayRun ? latestRunCounts.get(displayRun.id) : null;
    const overviewDispositionCounts = displayRun
      ? summarizeOverviewRun({
          recipientJobs: latestRunRecipients.get(displayRun.id),
          totalRecipients: displayRun.totalRecipients,
          sentCount: displayRun.sentCount,
          openedCount: displayRun.openedCount,
          clickedCount: displayRun.clickedCount,
          failedCount: displayRun.failedCount,
          suppressedCount: displayRun.suppressedCount,
          invalidCount: displayRun.invalidCount
        })
      : null;
    const displayRunSnapshot = displayRun
      ? {
          ...displayRun,
          sentCount: latestRunCountsByStatus ? (latestRunCountsByStatus.SENT ?? 0) : displayRun.sentCount,
          openedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.OPENED ?? 0) : displayRun.openedCount,
          clickedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.CLICKED ?? 0) : displayRun.clickedCount,
          failedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.FAILED ?? 0) : displayRun.failedCount,
          suppressedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.SUPPRESSED ?? 0) : displayRun.suppressedCount,
          invalidCount: latestRunCountsByStatus ? (latestRunCountsByStatus.INVALID ?? 0) : displayRun.invalidCount,
          overviewDispositionCounts
        }
      : null;

    return {
      ...campaign,
      latestRun: displayRunSnapshot,
      actualLatestRunStatus: actualLatestRun?.status ?? null,
      isFromPreviousRun
    };
  });

  if (
    activeSequenceCount > 0 ||
    recentCampaigns.some((campaign) => campaign.runs.some((run) => run.status === "WAITING_FOR_SLOT"))
  ) {
    after(async () => {
      await processPendingCampaignWork({
        maxDurationMs: 20_000
      });
    });
  }

  const sentLastDayCount = userSendWindow.sentLast24h;
  const sentPreviousDayCount = sentPreviousDay._sum.sentCount ?? 0;
  const sentTrend = buildTrend(sentLastDayCount, sentPreviousDayCount, "day");
  const runTotals = overviewCampaigns.reduce(
    (totals, campaign) => {
      const latestRun = campaign.latestRun;

      if (!latestRun) {
        return totals;
      }

      totals.delivered += getDeliveredCount(latestRun);
      totals.needsAttention += latestRun.overviewDispositionCounts?.needsAttention ?? 0;
      totals.recipients += latestRun.totalRecipients;

      return totals;
    },
    {
      delivered: 0,
      needsAttention: 0,
      recipients: 0
    }
  );
  // The delivered/issues percentage split itself is derived inside the
  // AnalyticsPulse client component (computeDeliverySplit), so the paired
  // delivered-with-issues presentation has a single owner.
  const analyticsIssueCount = runTotals.needsAttention;

  const sequenceRows: SequenceRowData[] = overviewCampaigns.map((campaign) => {
    const latestRun = campaign.latestRun; // display run (metrics)
    const actualLatestRun = campaign.runs[0] ?? null;
    const actualRunStatus = campaign.actualLatestRunStatus; // real latest run status (for status badge / actions)
    const dailyLimitInfo = readDailyLimitPauseInfo(actualLatestRun?.progressSnapshot ?? null);
    const senderResumesAt = blockedResumeBySenderProfileId.get(campaign.senderProfileId) ?? null;
    const isSenderBlocked = blockedSenderProfileIds.has(campaign.senderProfileId);
    const isActiveRun = OPEN_RUN_STATUSES.includes(actualRunStatus ?? "COMPLETED");
    const actualProcessedCount = getProcessedCount(actualLatestRun);
    const actualTotalRecipients = actualLatestRun?.totalRecipients ?? 0;
    const dailyLimitPauseStillBlocked = Boolean(dailyLimitInfo) && isSenderBlocked;
    const hasActualRecipientWorkRemaining = actualLatestRun
      ? actualTotalRecipients <= 0
        ? isActiveRun || dailyLimitPauseStillBlocked
        : actualProcessedCount < actualTotalRecipients
      : false;
    const deliveredCount = getDeliveredCount(latestRun);
    const dispositionCounts = latestRun?.overviewDispositionCounts ?? {
      sent: 0,
      skipped: 0,
      needsAttention: 0,
      pending: 0
    };
    const processedCount = latestRun
      ? deliveredCount + dispositionCounts.skipped + dispositionCounts.needsAttention
      : 0;
    const totalRecipients = latestRun?.totalRecipients ?? 0;
    const isRunWaitingForDailyLimit =
      hasActualRecipientWorkRemaining && (dailyLimitPauseStillBlocked || (isActiveRun && isSenderBlocked));
    const dailyLimitBlock =
      isRunWaitingForDailyLimit
        ? {
            resumesAt: dailyLimitInfo?.pauseResumesAt ?? senderResumesAt ?? null
          }
        : null;
    const status = dailyLimitBlock
      ? { label: "Paused · safety limit", tone: "paused" as const }
      : deriveSequenceStatus(campaign.status, actualRunStatus);
    const runMetricsKnown = hasKnownRunMetrics(latestRun, processedCount);
    const progressPercent =
      totalRecipients > 0
        ? Math.min(100, Math.max(0, Math.round((processedCount / totalRecipients) * 100)))
        : actualRunStatus === "COMPLETED" || campaign.status === "COMPLETED"
          ? 100
          : 0;
    // Compact card metrics: show real numbers whenever we have a run that isn't an
    // active run still syncing its first counts. Active + unknown metrics = "syncing"
    // (values render as "—"); a genuinely zero metric still renders as "0".
    const metricsKnown = Boolean(latestRun) && (!isActiveRun || runMetricsKnown);
    const isSyncing = Boolean(latestRun) && isActiveRun && !runMetricsKnown;
    const metricNumber = (value: number) => (metricsKnown ? formatCompactNumber(value) : "—");
    const processedValue = !metricsKnown
      ? "—"
      : totalRecipients > 0
        ? `${formatCompactNumber(processedCount)}/${formatCompactNumber(totalRecipients)}`
        : formatCompactNumber(processedCount);
    const outcome = buildSequenceOutcomePresentation(dispositionCounts);
    const metrics: SequenceMetric[] = [
      { key: "processed", label: "Processed", value: processedValue },
      { key: "delivered", label: "Delivered", value: metricNumber(deliveredCount) },
      { key: "opened", label: "Opened", value: metricNumber(latestRun?.openedCount ?? 0) },
      {
        key: outcome.metric.key,
        label: outcome.metric.label,
        value: metricsKnown ? formatCompactNumber(outcome.metric.count) : "—",
        tone: metricsKnown ? outcome.metric.tone : undefined
      }
    ];
    const health: SequenceRowData["health"] = actualRunStatus === "WAITING_FOR_SLOT"
      ? {
          label: "Starts automatically",
          tone: "idle",
          hint: "This sequence will start automatically when an execution slot becomes available."
        }
      : dailyLimitBlock
      ? { label: "Safety pause", tone: "idle" }
      : isSyncing
        ? { label: "Syncing metrics", tone: "syncing" }
        : !latestRun
          ? campaign.lastValidatedAt
            ? { label: "Ready to launch", tone: "idle" }
            : { label: "Needs validation", tone: "idle" }
          : status.tone === "failed" && dispositionCounts.needsAttention === 0
            ? {
                label: "Needs attention",
                tone: "issues",
                ariaLabel: "This sequence requires attention."
              }
            : {
                ...outcome.health,
                label:
                  outcome.health.tone === "clean"
                    ? outcome.health.label
                    : outcome.health.label.replace(/^\d+/, (count) => formatCompactNumber(Number(count)))
              };
    const lastActivityAt = latestRun?.updatedAt ?? campaign.updatedAt;
    const isPausedRun = actualRunStatus === "PAUSED" || Boolean(dailyLimitBlock);
    // Exclude PAUSED and daily-limit blocked — those don't get a Relaunch action.
    const canRelaunch =
      Boolean(campaign.lastValidatedAt) &&
      !OPEN_RUN_STATUSES.includes(actualRunStatus ?? "COMPLETED") &&
      !isPausedRun;

    return {
      id: campaign.id,
      href: `/sequences/${campaign.id}` as Route,
      name: campaign.name,
      statusLabel: status.label,
      statusTone: status.tone,
      summary: `${campaign.import.fileName} · ${campaign.template.name} · ${campaign.senderProfile.name}`,
      meta: {
        list: campaign.import.fileName,
        template: campaign.template.name,
        sender: campaign.senderProfile.name
      },
      scheduleType: normalizeScheduleType(campaign.scheduleType),
      progressPercent,
      metrics,
      health,
      lastActivityLabel: formatRelativeTime(lastActivityAt),
      lastActivityAt: lastActivityAt.toISOString(),
      updatedAtValue: lastActivityAt.getTime(),
      isValidated: Boolean(campaign.lastValidatedAt),
      needsAttention: status.tone === "failed" || dispositionCounts.needsAttention > 0,
      canRelaunch,
      isActiveRun,
      isPausedRun,
      dailyLimitBlock
    };
  });
  const needsAttentionCount = sequenceRows.filter((row) => row.needsAttention).length;

  // Discover + Finder activity sources. These are read defensively so a missing
  // table or transient read error degrades the feed gracefully (empty) rather
  // than breaking the whole Overview page. Each is scoped to the current user.
  const [
    recentProspectSearchRows,
    recentDiscoverExpansionRows,
    recentDomainSearchSummaries,
    recentActivityAuditRows,
    recentDeliveryFailureRows
  ] =
    await Promise.all([
      prisma.prospectSearch
        .findMany({
          where: { userId: user.id },
          take: 6,
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            requestedCompany: true,
            status: true,
            totalProcessed: true,
            requestedTitles: true,
            requestedLocations: true,
            updatedAt: true,
            company: { select: { _count: { select: { positions: true } } } }
          }
        })
        .catch(() => []),
      prisma.discoverSearchExpansion
        .findMany({
          where: { userId: user.id, status: "READY", addedCount: { gt: 0 } },
          take: 4,
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            addedCount: true,
            searchId: true,
            updatedAt: true,
            search: { select: { requestedCompany: true } }
          }
        })
        .catch(() => []),
      listHunterDomainSearchesForUser(user.id, 6).catch(() => []),
      // Activities with no durable domain record: individual Finder lookups and
      // prepared Discover exports. Only these two safe actions are read.
      prisma.auditLog
        .findMany({
          where: {
            actorUserId: user.id,
            action: { in: ["hunter.email_search", "discover.results_exported"] }
          },
          take: 8,
          orderBy: { createdAt: "desc" },
          select: { id: true, action: true, metadata: true, createdAt: true }
        })
        .catch(() => []),
      // Confirmed permanent delivery failures recorded by Gmail bounce
      // monitoring. Only the row id + timestamp are read — never the address.
      prisma.suppression
        .findMany({
          where: { userId: user.id, source: "gmail-dsn", reason: { in: ["HARD_BOUNCE", "INVALID_EMAIL"] } },
          take: 4,
          orderBy: { updatedAt: "desc" },
          select: { id: true, updatedAt: true }
        })
        .catch(() => [])
    ]);

  const activityItems = buildActivityItems({
    recentRuns,
    recentImports,
    recentTemplates,
    recentProspectSearches: recentProspectSearchRows.map((row) => ({
      id: row.id,
      company: row.requestedCompany,
      status: row.status,
      peopleCount: row.totalProcessed,
      roleGroupCount: row.company?._count.positions ?? 0,
      titles: parseActivityStringList(row.requestedTitles),
      locations: parseActivityStringList(row.requestedLocations),
      updatedAt: row.updatedAt
    })),
    recentDiscoverExpansions: recentDiscoverExpansionRows.map((row) => ({
      id: row.id,
      company: row.search.requestedCompany,
      searchId: row.searchId,
      addedCount: row.addedCount,
      updatedAt: row.updatedAt
    })),
    recentDomainSearches: recentDomainSearchSummaries.map((summary) => ({
      id: summary.id,
      domain: summary.domain,
      resultCount: summary.resultCount,
      updatedAt: new Date(summary.updatedAt)
    })),
    recentActivityAuditEvents: recentActivityAuditRows.map((row) => ({
      id: row.id,
      action: row.action,
      metadata: row.metadata,
      createdAt: row.createdAt
    })),
    recentDeliveryFailures: recentDeliveryFailureRows.map((row) => ({
      id: row.id,
      updatedAt: row.updatedAt
    }))
  });
  const sequenceHealth = buildSequenceHealth(sequenceRows);

  // ----- Summary-card data -----
  // Active-status breakdown is derived from the campaigns already loaded above
  // (no extra query); the rest reuse the scoped counts fetched for this user.
  const activeBreakdown = overviewCampaigns.reduce(
    (acc, campaign) => {
      const runStatus = campaign.actualLatestRunStatus;
      if (runStatus === "RUNNING") {
        acc.running += 1;
      } else if (runStatus === "QUEUED") {
        acc.queued += 1;
      } else if (runStatus === "PAUSED" || campaign.status === "PAUSED") {
        acc.paused += 1;
      } else if (campaign.status === "SCHEDULED") {
        acc.scheduled += 1;
      }
      return acc;
    },
    { running: 0, queued: 0, paused: 0, scheduled: 0 }
  );
  const summaryActive = {
    activeNow: activeBreakdown.running + activeBreakdown.queued,
    total: campaignCount,
    ...activeBreakdown
  };
  const summaryLists = {
    processed: processedImportCount,
    ready: Math.min(processedImportCount, mappedProcessedImportCount),
    needsMapping: Math.max(0, processedImportCount - mappedProcessedImportCount),
    recent: importCountThisWeek
  };
  const summaryTemplates = {
    total: templateCount,
    formats: buildTemplateFormatSummary(templateFormatGroups),
    updatedThisWeek: templateCountThisWeek
  };

  // Snapshot of what is currently rendered, derived only from data already
  // loaded above, so the contextual help tours never hit the backend. Drives
  // which one-time onboarding phase (if any) auto-opens for this visit.
  const gmailNearOrBlocked =
    userSendWindow.isBlocked ||
    (userSendWindow.limit > 0 && userSendWindow.sentLast24h >= Math.max(1, Math.floor(userSendWindow.limit * 0.8)));
  const hasFlaggedSequence = sequenceRows.some(
    (row) => row.needsAttention || row.isPausedRun || Boolean(row.dailyLimitBlock)
  );
  const tourState = {
    hasImports: processedImportCount > 0,
    hasTemplates: templateCount > 0,
    hasSequences: campaignCount > 0,
    hasActiveSequences: activeSequenceCount > 0,
    hasRecentSequences: sequenceRows.length > 0,
    hasActivity: activityItems.length > 0,
    hasAttentionItems: needsAttentionCount > 0 || gmailNearOrBlocked || hasFlaggedSequence,
    hasGmailSenders: sendWindowSenders.some((sender) => sender.connected),
    hasMultipleSequencePages: sequenceRows.length > 5
  };

  const isBlankWorkspace = campaignCount === 0 && processedImportCount === 0;

  return (
    <div className={styles.page}>
      {/* One command panel: identity + live stat tiles on the left, the action
          card on the right. The action card stacks the next-move CTAs over the
          interactive analytics — nothing breaks out into sibling cards. */}
      <section className={styles.hero} data-overview-tour="page-intro">
        <div className={styles.heroContent}>
          <span className={styles.heroEyebrow}>
            <span className={styles.heroPulse} />
            Command center
          </span>
          <h1 className={styles.heroTitle}>Overview</h1>
          <p className={styles.heroCopy}>Launch, import, or review what needs attention.</p>
          <div className={styles.heroHighlights}>
            <div className={styles.heroHighlight}>
              <span className={styles.heroHighlightLabel}>Active now</span>
              <strong className={styles.heroHighlightValue}>{formatCompactNumber(activeSequenceCount)}</strong>
              <span className={styles.heroHighlightMeta}>Running or queued</span>
            </div>
            <div className={styles.heroHighlight}>
              <span className={styles.heroHighlightLabel}>Sent · 24h</span>
              <strong className={styles.heroHighlightValue}>{formatCompactNumber(sentLastDayCount)}</strong>
              <span className={styles.heroHighlightMeta}>{sentTrend.label}</span>
            </div>
            <div
              className={styles.heroHighlight}
              data-tone={needsAttentionCount > 0 ? "warn" : "ok"}
              data-overview-tour="needs-attention"
            >
              <span className={styles.heroHighlightLabel}>Attention</span>
              <strong className={styles.heroHighlightValue}>{formatCompactNumber(needsAttentionCount)}</strong>
              <span className={styles.heroHighlightMeta}>{needsAttentionCount ? "Review required" : "All clear"}</span>
            </div>
          </div>
        </div>

        <div className={styles.heroActions}>
          {isBlankWorkspace ? (
            <div
              className={`${styles.heroActionCard} ${styles.heroEmptyCard}`}
              data-overview-tour="workspace-health"
            >
              <span className={styles.heroEmptyBadge}>
                <Sparkles aria-hidden="true" />
                Getting started
              </span>
              <strong className={styles.heroActionTitle}>Start your outreach system</strong>
              <p className={styles.heroActionCopy}>Import a list, create a template, then launch your first sequence.</p>
              <ol className={styles.heroEmptySteps}>
                <li data-done="false">
                  <span className={styles.heroEmptyStepMark}>1</span>
                  Import a list
                </li>
                <li data-done={templateCount > 0 ? "true" : "false"}>
                  <span className={styles.heroEmptyStepMark}>
                    {templateCount > 0 ? <Check aria-hidden="true" /> : 2}
                  </span>
                  Create a template
                  {templateCount > 0 ? <em>Done</em> : null}
                </li>
                <li data-done="false">
                  <span className={styles.heroEmptyStepMark}>3</span>
                  Launch a sequence
                </li>
              </ol>
              <div className={styles.heroButtons}>
                <Link href="/imports" className={styles.heroCta}>
                  <FileSpreadsheet aria-hidden="true" />
                  <span>Import List</span>
                </Link>
                <Link href="/campaigns" className={`${styles.heroCta} ${styles.heroCtaGhost}`}>
                  <SendHorizontal aria-hidden="true" />
                  <span>Create Sequence</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className={styles.heroActionCard}>
              <div className={styles.heroActionHead}>
                <strong className={styles.heroActionTitle}>Pick the next move</strong>
                <span className={styles.heroActionChip}>
                  {formatCompactNumber(validatedSequenceCount)} validated
                </span>
              </div>
              <div className={styles.heroButtons}>
                <Link href="/campaigns" className={styles.heroCta}>
                  <SendHorizontal aria-hidden="true" />
                  <span>Create Sequence</span>
                </Link>
                <Link href="/imports" className={`${styles.heroCta} ${styles.heroCtaGhost}`}>
                  <FileSpreadsheet aria-hidden="true" />
                  <span>Import List</span>
                </Link>
              </div>
              <div
                className={styles.heroInsights}
                aria-label="Workspace analytics summary"
                data-overview-tour="workspace-health"
              >
                <AnalyticsPulse
                  targeted={runTotals.recipients}
                  delivered={runTotals.delivered}
                  issues={analyticsIssueCount}
                  sequenceTotal={sequenceRows.length}
                  health={sequenceHealth}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      <OverviewSummary
        active={summaryActive}
        lists={summaryLists}
        templates={summaryTemplates}
        sendWindow={{ combined: userSendWindow, senders: sendWindowSenders }}
      />

      <section className={styles.mainGrid}>
        <div className={styles.sequenceSection} data-overview-tour="recent-sequences">
          <div className={styles.sectionTop}>
            <div>
              <span className={styles.sectionKicker}>Recent sequences</span>
              <h2 className={styles.sectionTitle}>Jump back in</h2>
              <p className={styles.sectionCopy}>Open, relaunch, or clean up recent runs.</p>
            </div>
            <div className={styles.sectionTopMeta}>
              <Link href="/campaigns" className={styles.sectionLink} data-overview-tour="view-all-sequences">
                View all sequences
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>

          {sequenceRows.length ? (
            <SequencePanel rows={sequenceRows} />
          ) : (
            <div className={styles.sequenceEmpty}>
              <Sparkles aria-hidden="true" />
              <div>
                <strong>No sequences yet</strong>
                <p>Import a list and create your first sequence to turn this dashboard into a live control surface.</p>
              </div>
              <Link href="/campaigns" className={styles.sequenceEmptyCta}>
                Create Sequence
              </Link>
            </div>
          )}
        </div>

        <ActivityFeed items={activityItems} />
      </section>

      <OverviewTourLauncher state={tourState} />
    </div>
  );
}

const TEMPLATE_FORMAT_ORDER = ["HTML", "PLAIN_TEXT", "JSON"] as const;
const TEMPLATE_FORMAT_LABEL: Record<string, string> = {
  HTML: "HTML",
  PLAIN_TEXT: "Plain text",
  JSON: "JSON"
};

// Collapse the Template.format groupBy into ordered, non-empty slices for the
// Templates card. Known formats keep a friendly label and canonical order;
// anything unexpected falls back to its raw value so nothing is dropped.
function buildTemplateFormatSummary(
  groups: Array<{ format: string; _count: number }>
): TemplateFormatSlice[] {
  const counts = new Map<string, number>();
  for (const group of groups) {
    counts.set(group.format, (counts.get(group.format) ?? 0) + group._count);
  }

  const slices: TemplateFormatSlice[] = [];
  for (const format of TEMPLATE_FORMAT_ORDER) {
    const count = counts.get(format) ?? 0;
    if (count > 0) {
      slices.push({ key: format, label: TEMPLATE_FORMAT_LABEL[format] ?? format, count });
    }
    counts.delete(format);
  }
  for (const [format, count] of counts) {
    if (count > 0) {
      slices.push({ key: format, label: TEMPLATE_FORMAT_LABEL[format] ?? format, count });
    }
  }
  return slices;
}

// Normalize the raw Campaign.scheduleType column into the closed set the UI
// filter understands. Legacy rows created before scheduling existed (or any
// unexpected value) fall back to "immediate" so the dashboard never crashes on
// stale data.
function normalizeScheduleType(scheduleType: string | null | undefined): SequenceScheduleType {
  switch (scheduleType) {
    case "once":
      return "once";
    case "recurring":
      return "recurring";
    case "immediate":
    default:
      return "immediate";
  }
}

function deriveSequenceStatus(campaignStatus: CampaignStatus, runStatus?: RunStatus | null) {
  if (runStatus === "WAITING_FOR_SLOT" || campaignStatus === "WAITING_FOR_SLOT") {
    return { label: "Waiting for slot", tone: "waiting" as const };
  }
  if (runStatus === "RUNNING" || runStatus === "QUEUED") {
    return {
      label: runStatus === "QUEUED" ? "Queued" : "Running",
      tone: "running" as const
    };
  }

  if (runStatus === "FAILED") {
    return {
      label: "Needs attention",
      tone: "failed" as const
    };
  }

  if (runStatus === "COMPLETED") {
    return {
      label: "Completed",
      tone: "completed" as const
    };
  }

  if (campaignStatus === "SCHEDULED") {
    return {
      label: "Scheduled",
      tone: "scheduled" as const
    };
  }

  if (campaignStatus === "PAUSED") {
    return {
      label: "Paused",
      tone: "paused" as const
    };
  }

  if (campaignStatus === "FAILED" || campaignStatus === "CANCELLED") {
    return {
      label: humanizeEnum(campaignStatus),
      tone: "failed" as const
    };
  }

  if (campaignStatus === "COMPLETED") {
    return {
      label: "Completed",
      tone: "completed" as const
    };
  }

  return {
    label: humanizeEnum(campaignStatus),
    tone: "draft" as const
  };
}

function buildSequenceHealth(rows: SequenceRowData[]): PulseHealthSlice[] {
  const total = rows.length;
  const values = [
    {
      key: "running" as const,
      label: "Running",
      value: rows.filter((row) => row.statusTone === "running").length
    },
    {
      key: "done" as const,
      label: "Done",
      value: rows.filter((row) => row.statusTone === "completed").length
    },
    {
      key: "review" as const,
      label: "Review",
      value: rows.filter((row) => row.needsAttention).length
    },
    {
      key: "ready" as const,
      label: "Ready",
      value: rows.filter((row) => row.isValidated && row.statusTone !== "running" && row.statusTone !== "completed").length
    }
  ];

  return values.map((item) => ({
    ...item,
    // Non-zero slices keep a 4% floor so tiny counts stay visible/clickable.
    percent: item.value > 0 ? Math.max(4, getPercent(item.value, total)) : 0
  }));
}

function getPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((value / total) * 100));
}

// Safely coerce a Prisma JSON column (requestedTitles / requestedLocations) into
// a string list for the activity builder, dropping any non-string entries.
function parseActivityStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
