import type { Route } from "next";
import Link from "next/link";
import type { CampaignStatus, ImportStatus, RunStatus } from "@prisma/client";
import { ArrowRight, FileSpreadsheet, SendHorizontal, Sparkles, ScrollText } from "lucide-react";

import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { formatCompactNumber, formatDateTime, formatRelativeTime, buildTrend, humanizeEnum } from "@/components/dashboard/formatters";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SequencePanel } from "@/components/dashboard/sequence-panel";
import type { ActivityItem, SequenceRowData } from "@/components/dashboard/types";
import styles from "./overview-command-center.module.css";

const ACTIVE_RUN_STATUSES: RunStatus[] = ["QUEUED", "RUNNING"];
const FAILURE_RUN_STATUSES: RunStatus[] = ["FAILED"];

function getDeliveredCount(run?: {
  sentCount?: number | null;
  openedCount?: number | null;
  clickedCount?: number | null;
} | null) {
  return (run?.sentCount ?? 0) + (run?.openedCount ?? 0) + (run?.clickedCount ?? 0);
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
          take: 1,
          select: {
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

  const sentLastDayCount = sentLastDay._sum.sentCount ?? 0;
  const sentPreviousDayCount = sentPreviousDay._sum.sentCount ?? 0;
  const sentTrend = buildTrend(sentLastDayCount, sentPreviousDayCount, "day");

  const sequenceRows: SequenceRowData[] = recentCampaigns.map((campaign) => {
    const latestRun = campaign.runs[0] ?? null;
    const status = deriveSequenceStatus(campaign.status, latestRun?.status);
    const deliveredCount = getDeliveredCount(latestRun);
    const processedCount =
      deliveredCount +
      (latestRun?.failedCount ?? 0) +
      (latestRun?.suppressedCount ?? 0) +
      (latestRun?.invalidCount ?? 0);
    const totalRecipients = latestRun?.totalRecipients ?? 0;
    const issueCount =
      (latestRun?.failedCount ?? 0) +
      (latestRun?.suppressedCount ?? 0) +
      (latestRun?.invalidCount ?? 0);
    const progressPercent =
      totalRecipients > 0
        ? Math.max(6, Math.min(100, Math.round((processedCount / totalRecipients) * 100)))
        : latestRun?.status === "COMPLETED" || campaign.status === "COMPLETED"
          ? 100
          : 0;
    const progressLabel =
      totalRecipients > 0
        ? `${formatCompactNumber(processedCount)} of ${formatCompactNumber(totalRecipients)} recipients processed`
        : latestRun
          ? `${humanizeEnum(latestRun.status)} run`
          : "Awaiting first launch";
    const deliveryLabel = latestRun
      ? `${formatCompactNumber(deliveredCount)} delivered`
      : campaign.lastValidatedAt
        ? "Validated and ready"
        : "Needs validation";
    const deliveryDetail = latestRun
      ? issueCount
        ? `${formatCompactNumber(issueCount)} delivery issues · ${formatCompactNumber(latestRun.openedCount)} opens`
        : `${formatCompactNumber(latestRun.openedCount)} opens · clean delivery`
      : `${campaign.template.name} · ${campaign.senderProfile.fromEmail}`;
    const lastActivityAt = latestRun?.updatedAt ?? campaign.updatedAt;
    const canRelaunch = Boolean(campaign.lastValidatedAt) && !ACTIVE_RUN_STATUSES.includes(latestRun?.status ?? "COMPLETED");

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
      lastActivityDetail: formatDateTime(lastActivityAt),
      updatedAtValue: lastActivityAt.getTime(),
      isValidated: Boolean(campaign.lastValidatedAt),
      needsAttention: status.tone === "failed",
      canRelaunch
    };
  });

  const activityItems = buildActivityItems({
    recentRuns,
    recentImports,
    recentTemplates
  });

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
            </div>
            <div className={styles.heroHighlight}>
              <span className={styles.heroHighlightLabel}>Sent last 24h</span>
              <strong className={styles.heroHighlightValue}>{formatCompactNumber(sentLastDayCount)}</strong>
            </div>
            <div className={styles.heroHighlight}>
              <span className={styles.heroHighlightLabel}>Needs attention</span>
              <strong className={styles.heroHighlightValue}>{formatCompactNumber(needsAttentionCount)}</strong>
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
      timeDetail: formatDateTime(run.updatedAt),
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
    timeDetail: formatDateTime(entry.updatedAt),
    kind: "import",
    tone: entry.status === "FAILED" ? "warning" : "muted"
  }));

  const templateItems: ActivityItem[] = recentTemplates.map((entry) => ({
    id: `template-${entry.id}`,
    href: "/templates",
    title: `${entry.name} updated`,
    description: `${entry.format.toUpperCase()} copy refreshed and ready to reuse.`,
    timeLabel: formatRelativeTime(entry.updatedAt),
    timeDetail: formatDateTime(entry.updatedAt),
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
