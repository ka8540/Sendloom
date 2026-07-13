import { after } from "next/server";
import { CheckCircle2, Mail, RefreshCcw } from "lucide-react";

import { ActiveRunRefresher } from "@/components/active-run-refresher";
import { CampaignBuilder } from "@/components/campaign-builder";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { BounceMonitoringStatus } from "@/components/senders/bounce-monitoring-status";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { summarizeOverviewRun } from "@/lib/recipient-overview-disposition";
import { resolveBounceMonitoringStatus } from "@/services/bounces";
import { processPendingCampaignWork } from "@/services/campaigns";
import { formatSequenceStatus } from "@/lib/sequence-status";
import { computeSequenceFlags } from "./sequence-insights";
import { SequencesCommandCenter, type SequenceBoardItem } from "./sequences-command-center";
import styles from "./page.module.css";

type ScheduleConfig =
  | {
      type: "immediate";
    }
  | {
      type: "once";
      scheduledFor?: string;
      timeZone?: string;
    }
  | {
      type: "recurring";
      frequency?: "daily" | "weekly";
      time?: string;
      dayOfWeek?: number;
      daysOfWeek?: number[];
      timeZone?: string;
    };

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const shortDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function getScheduleWeekdays(scheduleConfig?: ScheduleConfig | null) {
  if (!scheduleConfig || !("frequency" in scheduleConfig)) {
    return [1];
  }

  const days = scheduleConfig.daysOfWeek?.length ? scheduleConfig.daysOfWeek : [scheduleConfig.dayOfWeek ?? 1];
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort((left, right) => left - right);
}

function formatWeeklyDayLabel(scheduleConfig?: ScheduleConfig | null) {
  const days = getScheduleWeekdays(scheduleConfig);
  return days.length === 1 ? dayNames[days[0] ?? 1] : days.map((day) => shortDayNames[day]).join(", ");
}

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
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

function formatDateTime(value?: Date | string | null, timeZone?: string) {
  if (!value) {
    return "Not available";
  }

  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone, timeZoneName: "short" as const } : {})
  }).format(date);
}

function formatDeliveryLabel(scheduleType?: string | null, scheduleConfig?: ScheduleConfig | null) {
  if (scheduleType === "once") {
    const onceConfig = scheduleConfig && "scheduledFor" in scheduleConfig ? scheduleConfig : null;
    const detail = onceConfig?.scheduledFor ? formatDateTime(onceConfig.scheduledFor, onceConfig.timeZone) : "Waiting for schedule";

    return {
      label: "Run once",
      detail
    };
  }

  if (scheduleType === "recurring") {
    const recurringConfig = scheduleConfig && "frequency" in scheduleConfig ? scheduleConfig : null;
    const frequencyLabel = recurringConfig?.frequency === "daily" ? "Daily" : "Weekly";
    const timeLabel = recurringConfig?.time ?? "09:00";
    const dayLabel =
      recurringConfig?.frequency === "weekly" ? ` · ${formatWeeklyDayLabel(recurringConfig)}` : "";
    const secondaryDetail = recurringConfig?.timeZone ? `${timeLabel} · ${recurringConfig.timeZone}` : timeLabel;

    return {
      label: "Recurring",
      detail: `${frequencyLabel}${dayLabel} · ${secondaryDetail}`
    };
  }

  return {
    label: "Send now",
    detail: "Starts as soon as you launch it"
  };
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

  const activeSequences = campaigns.filter(
    (campaign) =>
      campaign.status === "RUNNING" ||
      campaign.runs.some(
        (run) => ["QUEUED", "RUNNING"].includes(run.status) && Boolean(run.executionSlotClaimedAt)
      )
  ).length;
  const hasLiveActivity = activeSequences > 0 || campaigns.some((campaign) => campaign.status === "WAITING_FOR_SLOT");

  // Determine which run to show metrics from for each campaign.
  // If the latest run is queued/unstarted and a previous completed run exists, show that instead.
  // Every sequence is serialized here; the command center filters, searches, and
  // paginates client-side so interactions never re-render the route.
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

  const boardItems: SequenceBoardItem[] = campaigns.map((campaign) => {
    const latestRun = campaign.runs[0] ?? null; // most-recent run — used for status context
    const { run: displayRun, isFromPreviousRun } = campaignDisplayRuns.get(campaign.id)!;
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

    // Shared Overview classification: address/compliance exclusions are calm
    // Skipped outcomes; only real failures count as issues.
    const outcome = displayRunSnapshot
      ? summarizeOverviewRun({
          totalRecipients: displayRunSnapshot.totalRecipients,
          sentCount: displayRunSnapshot.sentCount ?? 0,
          openedCount: displayRunSnapshot.openedCount ?? 0,
          clickedCount: displayRunSnapshot.clickedCount ?? 0,
          failedCount: displayRunSnapshot.failedCount ?? 0,
          suppressedCount: displayRunSnapshot.suppressedCount ?? 0,
          invalidCount: displayRunSnapshot.invalidCount ?? 0
        })
      : null;
    const processedCount = outcome ? outcome.sent + outcome.skipped + outcome.needsAttention : 0;
    const metricsKnown = hasKnownRunMetrics(displayRunSnapshot, processedCount);
    const totalRecipients = displayRunSnapshot?.totalRecipients ?? 0;
    const issues = metricsKnown && outcome ? outcome.needsAttention : 0;
    const delivery = formatDeliveryLabel(campaign.scheduleType, campaign.scheduleConfig as ScheduleConfig | null);
    const flags = computeSequenceFlags({
      status: campaign.status,
      latestRunStatus: latestRun?.status ?? null,
      issueCount: issues
    });

    return {
      id: campaign.id,
      name: campaign.name,
      statusLabel: formatSequenceStatus(campaign.status),
      flags,
      listName: campaign.import.fileName,
      templateName: campaign.template.name,
      senderName: campaign.senderProfile.name,
      senderEmail: campaign.senderProfile.fromEmail,
      scheduleLabel: delivery.label,
      scheduleDetail: delivery.detail,
      enrolled: displayRun?.totalRecipients ?? campaign.import.rowCount,
      totalRecipients,
      delivered: metricsKnown && outcome ? outcome.sent : 0,
      opened: metricsKnown ? (displayRunSnapshot?.openedCount ?? 0) : 0,
      skipped: metricsKnown && outcome ? outcome.skipped : 0,
      issues,
      pendingCount: metricsKnown && outcome ? outcome.pending : 0,
      healthPercent: metricsKnown && outcome ? getPercent(outcome.sent, totalRecipients) : null,
      openedPercent: metricsKnown ? getPercent(displayRunSnapshot?.openedCount ?? 0, totalRecipients) : null,
      metricsKnown,
      isFromPreviousRun,
      latestRunStatusLabel: latestRun ? formatSequenceStatus(latestRun.status) : null,
      latestRunAt: latestRun?.updatedAt?.toISOString() ?? null,
      validatedAt: campaign.lastValidatedAt?.toISOString() ?? null,
      isPaused: flags.paused,
      canPause: flags.active
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

      <header className={styles.hero}>
        <div className={styles.heroText}>
          <h1>Sequences</h1>
          <p>Track launches, delivery health, and sequences that need attention.</p>
        </div>
        <a className="button" href="#create-sequence">
          Create sequence
        </a>
      </header>

      <SequencesCommandCenter items={boardItems} />

      <section className={styles.buildGrid} id="create-sequence">
        <article className={styles.builderCard}>
          <div className={styles.panelHeading}>
            <span className={styles.kicker}>Build</span>
            <h2>Create a sequence</h2>
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

        <article className={styles.senderCard}>
          <div className={styles.panelHeading}>
            <span className={styles.kicker}>Senders</span>
            <h2>Send from Gmail</h2>
            <p>
              Connected senders can launch sequences right away. If Google revoked access, reconnect the account first.
            </p>
          </div>
          <div className={styles.senderList}>
            {connectedSenders.length ? (
              connectedSenders.map((sender) => (
                <div key={sender.id} className={styles.senderItem}>
                  <div className={styles.senderIcon}>
                    <Mail aria-hidden="true" />
                  </div>
                  <div>
                    <strong>{sender.name}</strong>
                    <div className="muted">{sender.fromEmail}</div>
                    <BounceMonitoringStatus
                      senderId={sender.id}
                      status={resolveBounceMonitoringStatus(sender)}
                      backfillCompleted={Boolean(sender.bounceBackfillCompletedAt)}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.emptyNote}>
                {disconnectedSenders.length
                  ? "Reconnect Gmail to keep sending from this workspace."
                  : "Connect a Gmail account to send emails."}
              </div>
            )}
            {disconnectedSenders.length ? (
              <div className={styles.senderSection}>
                <div className={styles.senderSectionTitle}>Needs reconnect</div>
                {disconnectedSenders.map((sender) => (
                  <div key={sender.id} className={`${styles.senderItem} ${styles.senderItemWarning}`}>
                    <div className={styles.senderIcon}>
                      <RefreshCcw aria-hidden="true" />
                    </div>
                    <div>
                      <strong>{sender.name}</strong>
                      <div className="muted">{sender.fromEmail}</div>
                    </div>
                    <a
                      className="button secondary"
                      href={`/api/auth/google/connect?email=${encodeURIComponent(sender.fromEmail)}&next=${encodeURIComponent("/campaigns")}`}
                    >
                      Reconnect
                    </a>
                  </div>
                ))}
              </div>
            ) : null}
            <a className="button" href="/api/auth/google/connect">
              {connectedSenders.length ? "Connect another Gmail" : "Connect Gmail"}
            </a>
          </div>
        </article>
      </section>
    </div>
  );
}
