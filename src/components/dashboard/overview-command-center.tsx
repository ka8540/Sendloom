import type { Route } from "next";
import Link from "next/link";
import { after } from "next/server";
import type { CampaignStatus, RecipientJobStatus, RunStatus } from "@prisma/client";
import {
  Activity,
  ArrowRight,
  CirclePlus,
  FileText,
  FileUp,
  Plus,
  Send,
  TriangleAlert,
  Upload,
  UsersRound
} from "lucide-react";

import { requireOperatorUser } from "@/lib/auth";
import { getGmailDailySendWindow } from "@/lib/daily-send-limit";
import { prisma } from "@/lib/db";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { buildActivityItems } from "@/components/dashboard/activity-builder";
import { formatCompactNumber, formatRelativeTime, buildTrend, humanizeEnum } from "@/components/dashboard/formatters";
import { SendWindowCard, type SendWindowSender } from "@/components/dashboard/overview-send-window";
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
    // Template count by format. Kept alongside the other workspace counts so the
    // shared query batch stays stable for the future Analytics page.
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

  // ----- Summary-strip data -----
  // Lists ready = processed imports that already carry a field mapping, i.e.
  // ready to map into a sequence and launch. Reuses the scoped counts above.
  const readyListCount = Math.min(processedImportCount, mappedProcessedImportCount);

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

  return (
    <div className={styles.page}>
      {/* Compact page header: identity on the left, the two primary workspace
          actions on the right. No hero block — the operational summary strip
          below carries the at-a-glance numbers. */}
      <header className={styles.pageHeader} data-overview-tour="page-intro">
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>Overview</h1>
          <p className={styles.pageSubtitle}>Here’s what’s happening with your outreach.</p>
        </div>
        <div className={styles.pageActions}>
          <Link href="/campaigns" className={styles.primaryAction}>
            <Plus aria-hidden="true" />
            <span>Create Sequence</span>
          </Link>
          <Link href="/imports" className={styles.secondaryAction}>
            <Upload aria-hidden="true" />
            <span>Import List</span>
          </Link>
        </div>
      </header>

      {/* One restrained strip, four operational sections split by hairlines.
          Gmail send capacity intentionally lives only in the right-column card. */}
      <section className={styles.summaryStrip} aria-label="Workspace summary" data-overview-tour="workspace-health">
        <Link href="/campaigns" className={styles.summaryCell} data-overview-tour="active-sequences">
          <div className={styles.summaryBody}>
            <span className={styles.summaryLabel} data-tone="accent">
              <span className={styles.summaryDot} aria-hidden="true" />
              Active sequences
            </span>
            <strong className={styles.summaryValue}>{formatCompactNumber(activeSequenceCount)}</strong>
            <span className={styles.summaryMeta}>Running or queued</span>
          </div>
          <span className={styles.summaryIcon} data-tone="accent">
            <Activity aria-hidden="true" />
          </span>
        </Link>

        <Link href="/campaigns" className={styles.summaryCell}>
          <div className={styles.summaryBody}>
            <span className={styles.summaryLabel} data-tone="info">
              <span className={styles.summaryDot} aria-hidden="true" />
              Sent (24h)
            </span>
            <strong className={styles.summaryValue}>{formatCompactNumber(sentLastDayCount)}</strong>
            <span className={styles.summaryMeta}>{sentTrend.label}</span>
          </div>
          <span className={styles.summaryIcon} data-tone="info">
            <Send aria-hidden="true" />
          </span>
        </Link>

        <Link
          href="/campaigns"
          className={styles.summaryCell}
          data-tone={needsAttentionCount > 0 ? "warn" : "ok"}
          data-overview-tour="needs-attention"
        >
          <div className={styles.summaryBody}>
            <span className={styles.summaryLabel} data-tone="warn">
              <span className={styles.summaryDot} aria-hidden="true" />
              Needs attention
            </span>
            <strong className={styles.summaryValue}>{formatCompactNumber(needsAttentionCount)}</strong>
            <span className={styles.summaryMeta}>{needsAttentionCount ? "Action required" : "All clear"}</span>
          </div>
          <span className={styles.summaryIcon} data-tone="warn">
            <TriangleAlert aria-hidden="true" />
          </span>
        </Link>

        <Link href="/imports" className={styles.summaryCell} data-overview-tour="lists-ready">
          <div className={styles.summaryBody}>
            <span className={styles.summaryLabel} data-tone="lists">
              <span className={styles.summaryDot} aria-hidden="true" />
              Lists ready
            </span>
            <strong className={styles.summaryValue}>{formatCompactNumber(readyListCount)}</strong>
            <span className={styles.summaryMeta}>Ready to launch</span>
          </div>
          <span className={styles.summaryIcon} data-tone="lists">
            <UsersRound aria-hidden="true" />
          </span>
        </Link>
      </section>

      <div className={styles.mainGrid}>
        <div className={styles.mainColumn}>
          <section className={styles.quickSection} aria-label="Quick actions" data-overview-tour="quick-actions">
            <div className={styles.sectionIntro}>
              <h2 className={styles.sectionTitle}>Quick actions</h2>
              <p className={styles.sectionCopy}>Start something new.</p>
            </div>
            <div className={styles.quickGrid}>
              <Link href="/campaigns" className={styles.quickCard}>
                <span className={styles.quickIcon} data-tone="accent">
                  <CirclePlus aria-hidden="true" />
                </span>
                <span className={styles.quickText}>
                  <strong className={styles.quickTitle}>Create sequence</strong>
                  <span className={styles.quickCopy}>Build a new outreach sequence</span>
                </span>
                <ArrowRight className={styles.quickArrow} aria-hidden="true" />
              </Link>
              <Link href="/imports" className={styles.quickCard}>
                <span className={styles.quickIcon} data-tone="info">
                  <FileUp aria-hidden="true" />
                </span>
                <span className={styles.quickText}>
                  <strong className={styles.quickTitle}>Import list</strong>
                  <span className={styles.quickCopy}>Upload a CSV or spreadsheet</span>
                </span>
                <ArrowRight className={styles.quickArrow} aria-hidden="true" />
              </Link>
              <Link href="/templates" className={styles.quickCard}>
                <span className={styles.quickIcon} data-tone="warn">
                  <FileText aria-hidden="true" />
                </span>
                <span className={styles.quickText}>
                  <strong className={styles.quickTitle}>Create template</strong>
                  <span className={styles.quickCopy}>Design your email template</span>
                </span>
                <ArrowRight className={styles.quickArrow} aria-hidden="true" />
              </Link>
            </div>
          </section>

          <SequencePanel rows={sequenceRows} />
        </div>

        <aside className={styles.sideColumn}>
          <SendWindowCard combined={userSendWindow} senders={sendWindowSenders} />
          <ActivityFeed items={activityItems} />
        </aside>
      </div>

      <OverviewTourLauncher state={tourState} />
    </div>
  );
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

// Safely coerce a Prisma JSON column (requestedTitles / requestedLocations) into
// a string list for the activity builder, dropping any non-string entries.
function parseActivityStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
