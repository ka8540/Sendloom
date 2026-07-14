import Link from "next/link";
import { after } from "next/server";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  MailCheck,
  Plus,
  Reply,
  Send,
  ShieldCheck
} from "lucide-react";

import { ActiveRunRefresher } from "@/components/active-run-refresher";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { requireOperatorUser } from "@/lib/auth";
import { getGmailDailySendWindow } from "@/lib/daily-send-limit";
import { prisma } from "@/lib/db";
import {
  buildSequenceAttentionItems,
  countSequenceFilters,
  type SequenceListItem
} from "@/lib/sequence-dashboard";
import { processPendingCampaignWork } from "@/services/campaigns";
import { SequenceDashboard } from "./sequence-dashboard";
import styles from "./page.module.css";

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getDeliveredCount(run?: {
  sentCount?: number | null;
  openedCount?: number | null;
  clickedCount?: number | null;
} | null) {
  return (run?.sentCount ?? 0) + (run?.openedCount ?? 0) + (run?.clickedCount ?? 0);
}

// Skipped recipients (SUPPRESSED — invalid addresses, unsubscribes, blocks)
// are deliberate exclusions, not delivery issues, so they never count toward
// the Health "issues" number. Only failed/invalid sends do.
function getIssueCount(run?: {
  failedCount?: number | null;
  invalidCount?: number | null;
} | null) {
  return (run?.failedCount ?? 0) + (run?.invalidCount ?? 0);
}

function getProcessedCount(run?: {
  sentCount?: number | null;
  openedCount?: number | null;
  clickedCount?: number | null;
  failedCount?: number | null;
  suppressedCount?: number | null;
  invalidCount?: number | null;
} | null) {
  return getDeliveredCount(run) + getIssueCount(run) + (run?.suppressedCount ?? 0);
}

function hasKnownRunMetrics(
  run:
    | {
        status?: string | null;
        totalRecipients?: number | null;
      }
    | null
    | undefined,
  processedCount: number
) {
  if (!run || !run.totalRecipients || run.totalRecipients <= 0) {
    return false;
  }

  return !["QUEUED", "WAITING_FOR_SLOT", "RUNNING"].includes(run.status ?? "") || processedCount > 0;
}

function getPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

const ACTIVE_RUN_STATUSES = new Set(["QUEUED", "WAITING_FOR_SLOT", "RUNNING", "PAUSED"]);
const COMPLETED_RUN_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

type RunSummary = {
  id: string;
  status: string;
  totalRecipients: number;
  sentCount: number | null;
  openedCount: number | null;
  clickedCount: number | null;
  failedCount: number | null;
  suppressedCount: number | null;
  invalidCount: number | null;
  repliedCount: number | null;
  updatedAt: Date;
  scheduledFor: Date | null;
};

function selectDisplayRun(runs: RunSummary[]): { run: RunSummary | null; isFromPreviousRun: boolean } {
  const activeRun = runs.find((r) => ACTIVE_RUN_STATUSES.has(r.status)) ?? null;
  const completedRun = runs.find((r) => COMPLETED_RUN_STATUSES.has(r.status)) ?? null;

  if (!activeRun) {
    return { run: completedRun, isFromPreviousRun: false };
  }

  // If the active run has no processed recipients yet and a previous completed run exists,
  // show the completed run's metrics while indicating the next run is queued/scheduled.
  const activeProcessed =
    (activeRun.sentCount ?? 0) +
    (activeRun.openedCount ?? 0) +
    (activeRun.clickedCount ?? 0) +
    (activeRun.failedCount ?? 0) +
    (activeRun.suppressedCount ?? 0) +
    (activeRun.invalidCount ?? 0);

  if (activeProcessed === 0 && completedRun) {
    return { run: completedRun, isFromPreviousRun: true };
  }

  return { run: activeRun, isFromPreviousRun: false };
}

const countFormatter = new Intl.NumberFormat("en-US");

export default async function CampaignsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOperatorUser();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const gmailStatus = getSearchParam(resolvedSearchParams, "gmail");
  const gmailError = getSearchParam(resolvedSearchParams, "gmail_error");
  const [campaigns, repliesCount, scheduledRunCount, sendWindow] = await Promise.all([
    prisma.campaign.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        import: {
          select: {
            fileName: true,
            rowCount: true
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
        runs: { orderBy: { createdAt: "desc" }, take: 2 }
      }
    }),
    prisma.inboundReply.count({ where: { senderProfile: { userId: user.id } } }),
    prisma.campaignRun.count({
      where: {
        campaign: { userId: user.id },
        status: { in: ["QUEUED", "WAITING_FOR_SLOT"] }
      }
    }),
    getGmailDailySendWindow({ userId: user.id })
  ]);

  if (
    campaigns.some(
      (campaign) =>
        campaign.status === "RUNNING" ||
        campaign.runs.some((run) => ["QUEUED", "WAITING_FOR_SLOT", "RUNNING"].includes(run.status))
    )
  ) {
    after(async () => {
      await processPendingCampaignWork({
        maxDurationMs: 20_000
      });
    });
  }

  const hasLiveActivity =
    campaigns.some(
      (campaign) =>
        campaign.status === "RUNNING" ||
        campaign.status === "WAITING_FOR_SLOT" ||
        campaign.runs.some(
          (run) => ["QUEUED", "RUNNING"].includes(run.status) && Boolean(run.executionSlotClaimedAt)
        )
    );

  // Determine which run to show metrics from for each campaign.
  // If the latest run is queued/unstarted and a previous completed run exists, show that instead.
  // The dashboard filters, searches, and paginates these plain items client-side,
  // so moving between pages or states never re-renders the route.
  const campaignDisplayRuns = new Map(
    campaigns.map((campaign) => [campaign.id, selectDisplayRun(campaign.runs as RunSummary[])])
  );

  const latestRunIds = campaigns.flatMap((campaign) => {
    const { run } = campaignDisplayRuns.get(campaign.id)!;
    return run ? [run.id] : [];
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

  const sequenceItems: SequenceListItem[] = campaigns.map((campaign) => {
    const latestRun = campaign.runs[0] ?? null;
    const { run: displayRun } = campaignDisplayRuns.get(campaign.id)!;
    const displayRunCountsByStatus = displayRun ? latestRunCounts.get(displayRun.id) : null;
    const displayRunSnapshot = displayRun
      ? {
          ...displayRun,
          sentCount: displayRunCountsByStatus ? (displayRunCountsByStatus.SENT ?? 0) : displayRun.sentCount,
          openedCount: displayRunCountsByStatus ? (displayRunCountsByStatus.OPENED ?? 0) : displayRun.openedCount,
          clickedCount: displayRunCountsByStatus ? (displayRunCountsByStatus.CLICKED ?? 0) : displayRun.clickedCount,
          failedCount: displayRunCountsByStatus ? (displayRunCountsByStatus.FAILED ?? 0) : displayRun.failedCount,
          suppressedCount: displayRunCountsByStatus
            ? (displayRunCountsByStatus.SUPPRESSED ?? 0)
            : displayRun.suppressedCount,
          invalidCount: displayRunCountsByStatus ? (displayRunCountsByStatus.INVALID ?? 0) : displayRun.invalidCount
        }
      : null;
    const deliveredCount = getDeliveredCount(displayRunSnapshot);
    const processedCount = getProcessedCount(displayRunSnapshot);
    const runMetricsKnown = hasKnownRunMetrics(displayRunSnapshot, processedCount);

    return {
      id: campaign.id,
      name: campaign.name,
      campaignStatus: campaign.status,
      latestRunStatus: latestRun?.status ?? null,
      listName: campaign.import.fileName,
      templateName: campaign.template.name,
      senderName: campaign.senderProfile.name,
      senderEmail: campaign.senderProfile.fromEmail,
      enrolledCount: displayRun?.totalRecipients ?? campaign.import.rowCount,
      healthPercent:
        runMetricsKnown && displayRunSnapshot
          ? getPercent(deliveredCount, displayRunSnapshot.totalRecipients)
          : null,
      progressPercent:
        displayRunSnapshot && displayRunSnapshot.totalRecipients > 0
          ? getPercent(processedCount, displayRunSnapshot.totalRecipients)
          : 0,
      failedCount: displayRunSnapshot?.failedCount ?? 0,
      invalidCount: displayRunSnapshot?.invalidCount ?? 0,
      deliveredCount,
      // OPENED and CLICKED are exclusive recipient statuses, so opens = both.
      opensCount: (displayRunSnapshot?.openedCount ?? 0) + (displayRunSnapshot?.clickedCount ?? 0),
      repliedCount: displayRunSnapshot?.repliedCount ?? 0,
      createdAtIso: campaign.createdAt.toISOString(),
      updatedAtIso: campaign.updatedAt.toISOString()
    };
  });

  const filterCounts = countSequenceFilters(sequenceItems);
  const attentionItems = buildSequenceAttentionItems(sequenceItems);
  const visibleAttentionItems = attentionItems.slice(0, 3);
  const hiddenAttentionCount = attentionItems.length - visibleAttentionItems.length;

  const summaryCards = [
    {
      id: "active",
      label: "Active",
      value: countFormatter.format(filterCounts.active),
      unit: filterCounts.active === 1 ? "sequence" : "sequences",
      icon: <Send aria-hidden="true" />
    },
    {
      id: "replies",
      label: "Replies",
      value: countFormatter.format(repliesCount),
      unit: "received",
      icon: <Reply aria-hidden="true" />
    },
    {
      id: "sent",
      label: "Sent",
      value: sendWindow.ledgerAvailable ? countFormatter.format(sendWindow.sentLast24h) : "—",
      unit: sendWindow.ledgerAvailable ? "emails · last 24h" : "unavailable",
      icon: <MailCheck aria-hidden="true" />
    },
    {
      id: "scheduled",
      label: "Scheduled",
      value: countFormatter.format(scheduledRunCount),
      unit: scheduledRunCount === 1 ? "run queued" : "runs queued",
      icon: <CalendarClock aria-hidden="true" />
    }
  ];

  return (
    <div className={styles.page}>
      <ActiveRunRefresher active={hasLiveActivity} intervalMs={4_000} />
      {gmailError ? <ErrorToastOnMount message={gmailError} title="Gmail connection failed" /> : null}
      {gmailStatus === "connected" ? (
        <div className={styles.flashNotice}>
          <CheckCircle2 aria-hidden="true" />
          <span>Gmail reconnected. You can use that sender again.</span>
        </div>
      ) : null}

      <header className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1>Sequences</h1>
          <p>Track delivery, replies, and runs that need attention.</p>
        </div>
        <Link className={`button ${styles.newSequenceButton}`} href="/campaigns/new">
          <Plus aria-hidden="true" />
          <span>New sequence</span>
        </Link>
      </header>

      <section className={styles.overviewGrid} aria-label="Sequence overview">
        <dl className={styles.summaryCards}>
          {summaryCards.map((card) => (
            <div key={card.id} className={styles.summaryCard}>
              <dt>
                <span className={styles.summaryIcon}>{card.icon}</span>
                <span>{card.label}</span>
              </dt>
              <dd>
                <span className={styles.summaryValue}>{card.value}</span>
                <span className={styles.summaryUnit}>{card.unit}</span>
              </dd>
            </div>
          ))}
        </dl>

        <aside className={styles.healthPanel} aria-label="Sequences health">
          <div className={styles.healthHeading}>
            <h2>Sequences health</h2>
            {attentionItems.length ? (
              <span className={styles.healthCount}>{attentionItems.length}</span>
            ) : null}
          </div>

          {attentionItems.length ? (
            <ul className={styles.healthList}>
              {visibleAttentionItems.map((entry) => (
                <li key={entry.id} className={styles.healthItem} data-severity={entry.severity}>
                  <div className={styles.healthItemBody}>
                    <strong>
                      {entry.name} — {entry.title}
                    </strong>
                    <p>{entry.detail}</p>
                  </div>
                  <div className={styles.healthItemFooter}>
                    <Link className={styles.healthReviewLink} href={`/campaigns/${entry.id}`}>
                      Review sequence
                    </Link>
                    <span className={styles.healthSeverity} data-severity={entry.severity}>
                      <AlertTriangle aria-hidden="true" />
                      {entry.severity === "critical" ? "Critical" : "Warning"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.healthAllClear}>
              <ShieldCheck aria-hidden="true" />
              <div>
                <strong>All clear</strong>
                <p>No sequences need attention right now.</p>
              </div>
            </div>
          )}

          {hiddenAttentionCount > 0 ? (
            <p className={styles.healthMore}>
              +{hiddenAttentionCount} more under the Needs attention filter below.
            </p>
          ) : null}
        </aside>
      </section>

      <SequenceDashboard items={sequenceItems} />
    </div>
  );
}
