import type { CSSProperties } from "react";
import type { Route } from "next";
import Link from "next/link";
import { after } from "next/server";
import type { CampaignStatus, ImportStatus, RunStatus } from "@prisma/client";
import {
  ArrowRight,
  BarChart3,
  FileSpreadsheet,
  PieChart,
  SendHorizontal,
  Sparkles,
  ScrollText
} from "lucide-react";

import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { formatCompactNumber, formatRelativeTime, buildTrend, humanizeEnum } from "@/components/dashboard/formatters";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SequencePanel } from "@/components/dashboard/sequence-panel";
import type { ActivityItem, SequenceRowData } from "@/components/dashboard/types";
import { processPendingCampaignWork } from "@/services/campaigns";
import styles from "./overview-command-center.module.css";

const ACTIVE_RUN_STATUSES: RunStatus[] = ["QUEUED", "RUNNING"];
const DONE_RUN_STATUSES = new Set<RunStatus>(["COMPLETED", "FAILED", "CANCELLED"]);
const FAILURE_RUN_STATUSES: RunStatus[] = ["FAILED"];

function getDeliveredCount(run?: {
  sentCount?: number | null;
  openedCount?: number | null;
  clickedCount?: number | null;
} | null) {
  return (run?.sentCount ?? 0) + (run?.openedCount ?? 0) + (run?.clickedCount ?? 0);
}

function getIssueCount(run?: {
  failedCount?: number | null;
  suppressedCount?: number | null;
  invalidCount?: number | null;
} | null) {
  return (run?.failedCount ?? 0) + (run?.suppressedCount ?? 0) + (run?.invalidCount ?? 0);
}

function getProcessedCount(run?: {
  sentCount?: number | null;
  openedCount?: number | null;
  clickedCount?: number | null;
  failedCount?: number | null;
  suppressedCount?: number | null;
  invalidCount?: number | null;
} | null) {
  return getDeliveredCount(run) + getIssueCount(run);
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

  return !ACTIVE_RUN_STATUSES.includes(run.status ?? "COMPLETED") || processedCount > 0;
}

export default async function OverviewCommandCenter() {
  const user = await requireOperatorUser();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const [
    processedImportCount,
    importCountThisWeek,
    importCountPreviousWeek,
    campaignCount,
    campaignCountThisWeek,
    campaignCountPreviousWeek,
    templateCount,
    templateCountThisWeek,
    templateCountPreviousWeek,
    activeSequenceCount,
    validatedSequenceCount,
    needsAttentionCount,
    sentLastDay,
    sentPreviousDay,
    recentCampaigns,
    recentRuns,
    recentImports,
    recentTemplates
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
    prisma.import.count({
      where: {
        userId: user.id,
        createdAt: {
          gte: twoWeeksAgo,
          lt: weekAgo
        }
      }
    }),
    prisma.campaign.count({
      where: {
        userId: user.id
      }
    }),
    prisma.campaign.count({
      where: {
        userId: user.id,
        createdAt: {
          gte: weekAgo
        }
      }
    }),
    prisma.campaign.count({
      where: {
        userId: user.id,
        createdAt: {
          gte: twoWeeksAgo,
          lt: weekAgo
        }
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
    prisma.template.count({
      where: {
        userId: user.id,
        updatedAt: {
          gte: twoWeeksAgo,
          lt: weekAgo
        }
      }
    }),
    prisma.campaign.count({
      where: {
        userId: user.id,
        OR: [{ status: "RUNNING" }, { runs: { some: { status: { in: ACTIVE_RUN_STATUSES } } } }]
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
    prisma.campaign.count({
      where: {
        userId: user.id,
        OR: [{ status: "FAILED" }, { runs: { some: { status: { in: FAILURE_RUN_STATUSES } } } }]
      }
    }),
    prisma.campaignRun.aggregate({
      where: {
        campaign: { userId: user.id },
        updatedAt: {
          gte: dayAgo
        }
      },
      _sum: { sentCount: true }
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
            updatedAt: true
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
    })
  ]);

  // For each campaign, determine which run to display metrics from.
  // If the latest run is QUEUED/RUNNING with 0 processed and a completed run exists,
  // use the completed run so recurring sequences show real metrics instead of zeros.
  const campaignDisplayRunInfo = new Map<
    string,
    { displayRun: (typeof recentCampaigns)[0]["runs"][0] | null; isFromPreviousRun: boolean }
  >();
  for (const campaign of recentCampaigns) {
    const activeRun = campaign.runs.find((r) => ACTIVE_RUN_STATUSES.includes(r.status)) ?? null;
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
  const latestRunCountRows = latestRunIds.length
    ? await prisma.recipientJob.groupBy({
        by: ["campaignRunId", "status"],
        where: {
          campaignRunId: {
            in: latestRunIds
          }
        },
        _count: true
      })
    : [];
  const latestRunCounts = new Map<string, Record<string, number>>();

  for (const row of latestRunCountRows) {
    const counts = latestRunCounts.get(row.campaignRunId) ?? {};
    counts[row.status] = row._count;
    latestRunCounts.set(row.campaignRunId, counts);
  }

  const overviewCampaigns = recentCampaigns.map((campaign) => {
    const actualLatestRun = campaign.runs[0] ?? null;
    const { displayRun, isFromPreviousRun } = campaignDisplayRunInfo.get(campaign.id) ?? {
      displayRun: null,
      isFromPreviousRun: false
    };
    const latestRunCountsByStatus = displayRun ? latestRunCounts.get(displayRun.id) : null;
    const displayRunSnapshot = displayRun
      ? {
          ...displayRun,
          sentCount: latestRunCountsByStatus ? (latestRunCountsByStatus.SENT ?? 0) : displayRun.sentCount,
          openedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.OPENED ?? 0) : displayRun.openedCount,
          clickedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.CLICKED ?? 0) : displayRun.clickedCount,
          failedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.FAILED ?? 0) : displayRun.failedCount,
          suppressedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.SUPPRESSED ?? 0) : displayRun.suppressedCount,
          invalidCount: latestRunCountsByStatus ? (latestRunCountsByStatus.INVALID ?? 0) : displayRun.invalidCount
        }
      : null;

    return {
      ...campaign,
      latestRun: displayRunSnapshot,
      actualLatestRunStatus: actualLatestRun?.status ?? null,
      isFromPreviousRun
    };
  });

  if (activeSequenceCount > 0) {
    after(async () => {
      await processPendingCampaignWork({
        maxDurationMs: 20_000
      });
    });
  }

  const sentLastDayCount = sentLastDay._sum.sentCount ?? 0;
  const sentPreviousDayCount = sentPreviousDay._sum.sentCount ?? 0;
  const sentTrend = buildTrend(sentLastDayCount, sentPreviousDayCount, "day");
  const runTotals = overviewCampaigns.reduce(
    (totals, campaign) => {
      const latestRun = campaign.latestRun;

      if (!latestRun) {
        return totals;
      }

      totals.delivered += getDeliveredCount(latestRun);
      totals.failed += latestRun.failedCount;
      totals.invalid += latestRun.invalidCount;
      totals.suppressed += latestRun.suppressedCount;
      totals.recipients += latestRun.totalRecipients;

      return totals;
    },
    {
      delivered: 0,
      failed: 0,
      invalid: 0,
      suppressed: 0,
      recipients: 0
    }
  );
  const analyticsIssueCount = runTotals.failed + runTotals.invalid;
  const eligibleRecipientCount = Math.max(
    0,
    Math.max(runTotals.recipients - runTotals.suppressed, runTotals.delivered + analyticsIssueCount)
  );
  const deliveryMix = buildDeliveryMix({
    delivered: runTotals.delivered,
    issues: analyticsIssueCount
  });
  const analyticsPulse = buildAnalyticsPulse({
    delivered: runTotals.delivered,
    issues: analyticsIssueCount,
    eligibleRecipients: eligibleRecipientCount
  });

  const sequenceRows: SequenceRowData[] = overviewCampaigns.map((campaign) => {
    const latestRun = campaign.latestRun; // display run (metrics)
    const actualRunStatus = campaign.actualLatestRunStatus; // real latest run status (for status badge / actions)
    const status = deriveSequenceStatus(campaign.status, actualRunStatus);
    const deliveredCount = getDeliveredCount(latestRun);
    const processedCount = getProcessedCount(latestRun);
    const totalRecipients = latestRun?.totalRecipients ?? 0;
    const issueCount = getIssueCount(latestRun);
    const runMetricsKnown = hasKnownRunMetrics(latestRun, processedCount);
    const isActiveRun = ACTIVE_RUN_STATUSES.includes(actualRunStatus ?? "COMPLETED");
    const progressPercent =
      totalRecipients > 0
        ? Math.min(100, Math.max(0, Math.round((processedCount / totalRecipients) * 100)))
        : actualRunStatus === "COMPLETED" || campaign.status === "COMPLETED"
          ? 100
          : 0;
    const progressLabel =
      totalRecipients > 0
        ? runMetricsKnown
          ? `${formatCompactNumber(processedCount)} of ${formatCompactNumber(totalRecipients)} recipients processed`
          : actualRunStatus === "QUEUED"
            ? `Queued for ${formatCompactNumber(totalRecipients)} recipients`
            : `Sending to ${formatCompactNumber(totalRecipients)} recipients`
        : latestRun
          ? `${humanizeEnum(latestRun.status)} run`
          : "Awaiting first launch";
    const deliveryLabel = latestRun
      ? runMetricsKnown
        ? `${formatCompactNumber(deliveredCount)} delivered`
        : isActiveRun
          ? "Metrics syncing"
          : `${formatCompactNumber(deliveredCount)} delivered`
      : campaign.lastValidatedAt
        ? "Validated and ready"
        : "Needs validation";
    const deliveryDetail = latestRun
      ? runMetricsKnown
        ? issueCount
          ? `${formatCompactNumber(issueCount)} delivery issues · ${formatCompactNumber(latestRun.openedCount)} opens`
          : `${formatCompactNumber(latestRun.openedCount)} opens · clean delivery`
        : isActiveRun
          ? "Waiting for activity"
          : `${formatCompactNumber(latestRun.openedCount)} opens · clean delivery`
      : `${campaign.template.name} · ${campaign.senderProfile.fromEmail}`;
    const lastActivityAt = latestRun?.updatedAt ?? campaign.updatedAt;
    const canRelaunch = Boolean(campaign.lastValidatedAt) && !ACTIVE_RUN_STATUSES.includes(actualRunStatus ?? "COMPLETED");

    return {
      id: campaign.id,
      href: `/sequences/${campaign.id}` as Route,
      name: campaign.name,
      statusLabel: status.label,
      statusTone: status.tone,
      summary: `${campaign.import.fileName} · ${campaign.template.name} · ${campaign.senderProfile.name}`,
      progressPercent,
      progressLabel,
      deliveryLabel,
      deliveryDetail,
      lastActivityLabel: formatRelativeTime(lastActivityAt),
      lastActivityAt: lastActivityAt.toISOString(),
      updatedAtValue: lastActivityAt.getTime(),
      isValidated: Boolean(campaign.lastValidatedAt),
      needsAttention: status.tone === "failed",
      canRelaunch,
      isActiveRun
    };
  });

  const activityItems = buildActivityItems({
    recentRuns,
    recentImports,
    recentTemplates
  });
  const sequenceHealth = buildSequenceHealth(sequenceRows);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <span className={styles.heroEyebrow}>
            <span className={styles.heroPulse} />
            Command center
          </span>
          <h1 className={styles.heroTitle}>Overview</h1>
          <p className={styles.heroCopy}>
            Move from signal to action in one surface. Launch new sequences, jump into live runs, and keep imports and
            templates moving without hunting through tabs.
          </p>
          <div className={styles.heroHighlights}>
            <div className={styles.heroHighlight}>
              <span className={styles.heroHighlightLabel}>Active now</span>
              <strong className={styles.heroHighlightValue}>{formatCompactNumber(activeSequenceCount)}</strong>
              <span className={styles.heroHighlightMeta}>Running or queued</span>
            </div>
            <div className={styles.heroHighlight}>
              <span className={styles.heroHighlightLabel}>Sent last 24h</span>
              <strong className={styles.heroHighlightValue}>{formatCompactNumber(sentLastDayCount)}</strong>
              <span className={styles.heroHighlightMeta}>{sentTrend.label}</span>
            </div>
            <div className={styles.heroHighlight}>
              <span className={styles.heroHighlightLabel}>Needs attention</span>
              <strong className={styles.heroHighlightValue}>{formatCompactNumber(needsAttentionCount)}</strong>
              <span className={styles.heroHighlightMeta}>{needsAttentionCount ? "Review required" : "All clear"}</span>
            </div>
          </div>
        </div>

        <div className={styles.heroActions}>
          <div className={styles.heroActionCard}>
            <strong>Pick the next move</strong>
            <p>Create a new sequence, import a fresh list, or jump straight into a recent run from the table below.</p>
            <div className={styles.heroButtons}>
              <Link href="/campaigns" className={`button ${styles.heroButtonPrimary}`}>
                <SendHorizontal aria-hidden="true" />
                Create Sequence
              </Link>
              <Link href="/imports" className={`button secondary ${styles.heroButtonSecondary}`}>
                <FileSpreadsheet aria-hidden="true" />
                Import List
              </Link>
            </div>
            <div className={styles.heroFootnote}>
              <strong>{formatCompactNumber(validatedSequenceCount)} validated</strong>
              <span>{sentTrend.label}</span>
            </div>
            <div className={styles.heroInsights} aria-label="Workspace analytics summary">
              <div className={styles.insightTitleRow}>
                <span>
                  <BarChart3 aria-hidden="true" />
                  Analytics pulse
                </span>
                <strong>{formatCompactNumber(runTotals.recipients)} targeted</strong>
              </div>

              <div className={styles.deliveryInsight}>
                <div
                  className={styles.deliveryDonut}
                  style={{ "--chart-background": deliveryMix.gradient } as CSSProperties}
                  aria-label={`Delivery success is ${deliveryMix.cleanRate ?? "unavailable"}`}
                  role="img"
                >
                  <span className={styles.deliveryDonutText}>
                    <strong>{deliveryMix.cleanRate ?? "—"}</strong>
                    <small>success</small>
                  </span>
                </div>
                <div className={styles.deliveryLegend}>
                  {deliveryMix.segments.map((segment) => (
                    <div key={segment.label} className={styles.deliveryLegendItem}>
                      <span
                        className={styles.deliveryLegendSwatch}
                        style={{ "--segment-color": segment.color } as CSSProperties}
                      />
                      <span>{segment.label}</span>
                      <strong>{formatCompactNumber(segment.value)}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.funnelChart}>
                {analyticsPulse.map((item) => (
                  <div key={item.label} className={styles.funnelRow}>
                    <div className={styles.funnelMeta}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                    <div className={styles.funnelTrack} aria-hidden="true">
                      <span
                        className={styles.funnelFill}
                        style={
                          {
                            "--bar-value": `${item.percent}%`,
                            "--bar-color": item.color
                          } as CSSProperties
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.healthChart}>
                <div className={styles.healthHeader}>
                  <span>
                    <PieChart aria-hidden="true" />
                    Sequence health
                  </span>
                  <strong>{formatCompactNumber(sequenceRows.length)}</strong>
                </div>
                <div className={styles.healthSegments} aria-hidden="true">
                  {sequenceHealth.map((item) => (
                    <span
                      key={item.label}
                      className={styles.healthSegment}
                      style={
                        {
                          "--segment-value": `${item.percent}%`,
                          "--segment-color": item.color
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
                <div className={styles.healthLegend}>
                  {sequenceHealth.map((item) => (
                    <span key={item.label}>
                      {item.label}
                      <strong>{formatCompactNumber(item.value)}</strong>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.metricsGrid}>
        <MetricCard
          icon={SendHorizontal}
          label="Active sequences"
          value={formatCompactNumber(activeSequenceCount)}
          detail={`Running or queued sequences across ${formatCompactNumber(campaignCount)} total workflows.`}
          trend={buildTrend(campaignCountThisWeek, campaignCountPreviousWeek, "week")}
          href="/campaigns"
          emphasis
        />
        <MetricCard
          icon={FileSpreadsheet}
          label="Lists ready"
          value={formatCompactNumber(processedImportCount)}
          detail="Processed imports available to map, validate, and launch."
          trend={buildTrend(importCountThisWeek, importCountPreviousWeek, "week")}
          href="/imports"
        />
        <MetricCard
          icon={ScrollText}
          label="Templates live"
          value={formatCompactNumber(templateCount)}
          detail="Playable email assets currently available across the workspace."
          trend={buildTrend(templateCountThisWeek, templateCountPreviousWeek, "week")}
          href="/templates"
        />
      </section>

      <section className={styles.mainGrid}>
        <div className={styles.sequenceSection}>
          <div className={styles.sectionTop}>
            <div>
              <span className={styles.sectionKicker}>Recent sequences</span>
              <h2 className={styles.sectionTitle}>Jump into the work that moved last</h2>
              <p className={styles.sectionCopy}>
                Every row is a live entry point. Hover to relaunch or remove, or click anywhere to open the full sequence detail screen.
              </p>
            </div>
            <div className={styles.sectionTopMeta}>
              <Link href="/campaigns" className={styles.sectionLink}>
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
              <Link href="/campaigns" className="button">
                Create Sequence
              </Link>
            </div>
          )}
        </div>

        <ActivityFeed items={activityItems} />
      </section>
    </div>
  );
}

function deriveSequenceStatus(campaignStatus: CampaignStatus, runStatus?: RunStatus | null) {
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

function buildDeliveryMix(totals: {
  delivered: number;
  issues: number;
}) {
  const segments = [
    { label: "Delivered", value: totals.delivered, color: "var(--accent)" },
    { label: "Issues", value: totals.issues, color: "#d96952" }
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return {
    segments,
    gradient: buildConicGradient(segments, total),
    cleanRate: total > 0 ? formatPercent(totals.delivered, total) : null
  };
}

function buildAnalyticsPulse(totals: {
  delivered: number;
  issues: number;
  eligibleRecipients: number;
}) {
  const coveragePercent = getNullablePercent(totals.delivered, totals.eligibleRecipients);
  const successPercent = getNullablePercent(totals.delivered, totals.delivered + totals.issues);
  const issueRate = getNullablePercent(totals.issues, totals.delivered + totals.issues);

  return [
    {
      label: "Delivered",
      value: formatCompactNumber(totals.delivered),
      percent: coveragePercent ?? 0,
      color: "var(--accent)"
    },
    {
      label: "Delivery success",
      value: successPercent === null ? "—" : `${successPercent}%`,
      percent: successPercent ?? 0,
      color: "var(--success)"
    },
    {
      label: "Issues",
      value: formatCompactNumber(totals.issues),
      percent: issueRate ?? 0,
      color: "#d96952"
    }
  ];
}

function buildSequenceHealth(rows: SequenceRowData[]) {
  const total = rows.length;
  const values = [
    {
      label: "Running",
      value: rows.filter((row) => row.statusTone === "running").length,
      color: "var(--accent)"
    },
    {
      label: "Done",
      value: rows.filter((row) => row.statusTone === "completed").length,
      color: "var(--success)"
    },
    {
      label: "Review",
      value: rows.filter((row) => row.needsAttention).length,
      color: "#d96952"
    },
    {
      label: "Ready",
      value: rows.filter((row) => row.isValidated && row.statusTone !== "running" && row.statusTone !== "completed").length,
      color: "var(--warning)"
    }
  ];

  return values.map((item) => ({
    ...item,
    percent: item.value > 0 ? Math.max(4, getPercent(item.value, total)) : 0
  }));
}

function buildConicGradient(segments: Array<{ value: number; color: string }>, total: number) {
  if (total <= 0) {
    return "conic-gradient(color-mix(in srgb, var(--button-secondary-bg) 88%, transparent) 0% 100%)";
  }

  let cursor = 0;
  const stops = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const next = cursor + (segment.value / total) * 100;
      const stop = `${segment.color} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`;
      cursor = next;
      return stop;
    });

  return `conic-gradient(${stops.join(", ")})`;
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

  return getPercent(value, total);
}

function formatPercent(value: number, total: number) {
  return `${getPercent(value, total)}%`;
}

function buildActivityItems({
  recentRuns,
  recentImports,
  recentTemplates
}: {
  recentRuns: Array<{
    id: string;
    status: RunStatus;
    sentCount: number;
    failedCount: number;
    suppressedCount: number;
    invalidCount: number;
    totalRecipients: number;
    updatedAt: Date;
    campaign: {
      id: string;
      name: string;
    };
  }>;
  recentImports: Array<{
    id: string;
    fileName: string;
    rowCount: number;
    status: ImportStatus;
    updatedAt: Date;
  }>;
  recentTemplates: Array<{
    id: string;
    name: string;
    format: string;
    updatedAt: Date;
  }>;
}): ActivityItem[] {
  const runItems: ActivityItem[] = recentRuns.map((run) => {
    const issueCount = run.failedCount + run.suppressedCount + run.invalidCount;
    return {
      id: `run-${run.id}`,
      href: `/sequences/${run.campaign.id}` as Route,
      title:
        run.status === "RUNNING"
          ? `${run.campaign.name} is sending`
          : run.status === "FAILED"
            ? `${run.campaign.name} hit an issue`
            : `${run.campaign.name} updated`,
      description:
        run.totalRecipients > 0
          ? `${formatCompactNumber(run.sentCount)} sent, ${formatCompactNumber(issueCount)} issues across ${formatCompactNumber(run.totalRecipients)} recipients`
          : `${humanizeEnum(run.status)} run activity recorded.`,
      timeLabel: formatRelativeTime(run.updatedAt),
      timeValue: run.updatedAt.toISOString(),
      kind: "run",
      tone: run.status === "FAILED" ? "warning" : run.status === "RUNNING" ? "accent" : "success"
    };
  });

  const importItems: ActivityItem[] = recentImports.map((entry) => ({
    id: `import-${entry.id}`,
    href: "/imports",
    title: `${entry.fileName} is ${entry.status === "PROCESSED" ? "ready" : humanizeEnum(entry.status).toLowerCase()}`,
    description:
      entry.status === "PROCESSED"
        ? `${formatCompactNumber(entry.rowCount)} rows are ready for mapping and launch.`
        : `Import status changed to ${humanizeEnum(entry.status).toLowerCase()}.`,
    timeLabel: formatRelativeTime(entry.updatedAt),
    timeValue: entry.updatedAt.toISOString(),
    kind: "import",
    tone: entry.status === "FAILED" ? "warning" : "muted"
  }));

  const templateItems: ActivityItem[] = recentTemplates.map((entry) => ({
    id: `template-${entry.id}`,
    href: "/templates",
    title: `${entry.name} updated`,
    description: `${entry.format.toUpperCase()} copy refreshed and ready to reuse.`,
    timeLabel: formatRelativeTime(entry.updatedAt),
    timeValue: entry.updatedAt.toISOString(),
    kind: "template",
    tone: "muted"
  }));

  const sortableItems = [
    ...runItems.map((item, index) => ({ ...item, sortAt: recentRuns[index]?.updatedAt.getTime() ?? 0 })),
    ...importItems.map((item, index) => ({ ...item, sortAt: recentImports[index]?.updatedAt.getTime() ?? 0 })),
    ...templateItems.map((item, index) => ({ ...item, sortAt: recentTemplates[index]?.updatedAt.getTime() ?? 0 }))
  ];

  return sortableItems
    .sort((left, right) => right.sortAt - left.sortAt)
    .slice(0, 7)
    .map(({ sortAt: _, ...item }) => item);
}
