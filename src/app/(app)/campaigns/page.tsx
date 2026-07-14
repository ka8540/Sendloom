import { after } from "next/server";
import { CheckCircle2, Mail, RefreshCcw } from "lucide-react";

import { ActiveRunRefresher } from "@/components/active-run-refresher";
import { CampaignBuilder } from "@/components/campaign-builder";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { BounceMonitoringStatus } from "@/components/senders/bounce-monitoring-status";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { SequenceListItem } from "@/lib/sequence-dashboard";
import { resolveBounceMonitoringStatus } from "@/services/bounces";
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

export default async function CampaignsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOperatorUser();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const gmailStatus = getSearchParam(resolvedSearchParams, "gmail");
  const gmailError = getSearchParam(resolvedSearchParams, "gmail_error");
  const [imports, mappings, templates, senders, campaigns] = await Promise.all([
    prisma.import.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.mapping.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.template.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
    prisma.senderProfile.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" }
    }),
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
    })
  ]);
  const latestMappings = new Map<string, (typeof mappings)[number]>();
  const connectedSenders = senders.filter((sender) => Boolean(sender.oauthRefreshToken));
  const disconnectedSenders = senders.filter((sender) => !sender.oauthRefreshToken);

  for (const mapping of mappings) {
    if (!latestMappings.has(mapping.importId)) {
      latestMappings.set(mapping.importId, mapping);
    }
  }

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
      issueCount: getIssueCount(displayRunSnapshot)
    };
  });

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

      <section className={styles.topGrid}>
        <article className={styles.builderCard} id="create-sequence">
          <div className={styles.panelHeading}>
            <span className={styles.kicker}>Build</span>
            <h1>Create a sequence</h1>
            <p>Pick a contact list, template, sender, and send timing without leaving the dashboard.</p>
          </div>
          <CampaignBuilder
            imports={imports.map((entry) => ({ id: entry.id, label: entry.fileName }))}
            mappings={imports.flatMap((entry) => {
              const mapping = latestMappings.get(entry.id);
              if (!mapping) {
                return [];
              }

              return [
                {
                  id: mapping.id,
                  importId: entry.id,
                  label: `${entry.fileName} field set`
                }
              ];
            })}
            templates={templates.map((entry) => ({ id: entry.id, label: entry.name }))}
            senders={connectedSenders.map((entry) => ({ id: entry.id, label: `${entry.name} <${entry.fromEmail}>` }))}
            disconnectedSenderCount={disconnectedSenders.length}
            reconnectHref={
              disconnectedSenders[0]
                ? `/api/auth/google/connect?email=${encodeURIComponent(disconnectedSenders[0].fromEmail)}&next=${encodeURIComponent("/campaigns")}`
                : undefined
            }
          />
        </article>

        <aside className={styles.senderPanel} aria-label="Send from Gmail">
          <div className={styles.senderPanelHeading}>
            <span className={styles.kicker}>Senders</span>
            <h2>Send from Gmail</h2>
          </div>

          <div className={styles.senderList}>
            {connectedSenders.length ? (
              connectedSenders.map((sender) => (
                <div key={sender.id} className={styles.senderRow}>
                  <div className={styles.senderIcon}>
                    <Mail aria-hidden="true" />
                  </div>
                  <div className={styles.senderMeta}>
                    <div className={styles.senderNameRow}>
                      <strong>{sender.name}</strong>
                      <span className={styles.senderChip}>Connected</span>
                    </div>
                    <span className={styles.senderEmail}>{sender.fromEmail}</span>
                    <BounceMonitoringStatus
                      senderId={sender.id}
                      status={resolveBounceMonitoringStatus(sender)}
                      backfillCompleted={Boolean(sender.bounceBackfillCompletedAt)}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.senderEmpty}>
                {disconnectedSenders.length
                  ? "Reconnect Gmail to keep sending from this workspace."
                  : "Connect a Gmail account to send emails."}
              </div>
            )}

            {disconnectedSenders.map((sender) => (
              <div key={sender.id} className={`${styles.senderRow} ${styles.senderRowWarning}`}>
                <div className={styles.senderIcon}>
                  <RefreshCcw aria-hidden="true" />
                </div>
                <div className={styles.senderMeta}>
                  <div className={styles.senderNameRow}>
                    <strong>{sender.name}</strong>
                    <span className={`${styles.senderChip} ${styles.senderChipWarning}`}>Reconnect</span>
                  </div>
                  <span className={styles.senderEmail}>{sender.fromEmail}</span>
                </div>
                <a
                  className="button secondary"
                  href={`/api/auth/google/connect?email=${encodeURIComponent(sender.fromEmail)}&next=${encodeURIComponent("/campaigns")}`}
                >
                  Reconnect
                </a>
              </div>
            ))}

            <a className="button" href="/api/auth/google/connect">
              {connectedSenders.length ? "Connect another Gmail" : "Connect Gmail"}
            </a>
          </div>
        </aside>
      </section>

      <SequenceDashboard items={sequenceItems} />
    </div>
  );
}
