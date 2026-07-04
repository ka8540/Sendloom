import Link from "next/link";
import { after } from "next/server";
import {
  CalendarClock,
  CheckCircle2,
  Mail,
  RefreshCcw,
  SendHorizontal,
  Sparkles,
  Users
} from "lucide-react";

import { ActiveRunRefresher } from "@/components/active-run-refresher";
import { CampaignCardActions } from "@/components/campaign-card-actions";
import { CampaignBuilder } from "@/components/campaign-builder";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { LocalDateTime } from "@/components/local-date-time";
import { BounceMonitoringStatus } from "@/components/senders/bounce-monitoring-status";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveBounceMonitoringStatus } from "@/services/bounces";
import { processPendingCampaignWork } from "@/services/campaigns";
import { formatSequenceStatus } from "@/lib/sequence-status";
import { SequenceBoard } from "./sequence-board";
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

function humanize(value?: string | null) {
  if (!value) {
    return "Not set";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
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
      detail,
      fullDetail: detail
    };
  }

  if (scheduleType === "recurring") {
    const recurringConfig = scheduleConfig && "frequency" in scheduleConfig ? scheduleConfig : null;
    const frequencyLabel = recurringConfig?.frequency === "daily" ? "Daily" : "Weekly";
    const timeLabel = recurringConfig?.time ?? "09:00";
    const dayLabel =
      recurringConfig?.frequency === "weekly" ? ` · ${formatWeeklyDayLabel(recurringConfig)}` : "";
    const detail = `${frequencyLabel}${dayLabel}`;
    const secondaryDetail = recurringConfig?.timeZone ? `${timeLabel} · ${recurringConfig.timeZone}` : timeLabel;

    return {
      label: "Recurring",
      detail,
      secondaryDetail,
      fullDetail: `${detail} · ${secondaryDetail}`
    };
  }

  const detail = "Starts as soon as you launch it";

  return {
    label: "Send now",
    detail,
    fullDetail: detail
  };
}

const PAGE_SIZE = 10;

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
  const scheduledSequences = campaigns.filter((campaign) => campaign.scheduleType !== "immediate").length;
  const validatedSequences = campaigns.filter((campaign) => Boolean(campaign.lastValidatedAt)).length;

  // Determine which run to show metrics from for each campaign.
  // If the latest run is queued/unstarted and a previous completed run exists, show that instead.
  // All campaigns are computed here; the board paginates client-side so prev/next never
  // re-renders the route.
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

  const sequenceCards = campaigns.map((campaign) => {
    const latestRun = campaign.runs[0]; // most-recent run — used for status label only
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
    const deliveredCount = getDeliveredCount(displayRunSnapshot);
    const issueCount = getIssueCount(displayRunSnapshot);
    const processedCount = getProcessedCount(displayRunSnapshot);
    const runMetricsKnown = hasKnownRunMetrics(displayRunSnapshot, processedCount);
    const recipientCount = displayRun?.totalRecipients ?? campaign.import.rowCount;
    const deliveryHealthPercent =
      runMetricsKnown && displayRunSnapshot
        ? getPercent(deliveredCount, displayRunSnapshot.totalRecipients)
        : null;
    const progressPercent =
      displayRunSnapshot && displayRunSnapshot.totalRecipients > 0
        ? getPercent(processedCount, displayRunSnapshot.totalRecipients)
        : 0;
    const openedPercent =
      runMetricsKnown && displayRunSnapshot
        ? getPercent(displayRunSnapshot.openedCount ?? 0, displayRunSnapshot.totalRecipients)
        : null;
    const delivery = formatDeliveryLabel(campaign.scheduleType, campaign.scheduleConfig as ScheduleConfig | null);
    const latestRunSummary = displayRun
      ? runMetricsKnown
        ? `${formatCount(deliveredCount)}/${formatCount(displayRun.totalRecipients)} delivered${isFromPreviousRun ? " (last run)" : ""}`
        : "Metrics syncing"
      : "No run started yet";
    // For the "Latest run" row, show the actual most-recent run's status
    const latestRunValue = latestRun?.updatedAt?.toISOString() ?? null;
    const validatedAtValue = campaign.lastValidatedAt?.toISOString() ?? null;
    const healthDetail = displayRun
      ? runMetricsKnown
        ? isFromPreviousRun
          ? `Last run · ${formatCount(deliveredCount)} delivered`
          : latestRunSummary
        : "Waiting for activity"
      : campaign.lastValidatedAt
        ? "Validated and ready"
        : "Awaiting first run";
    const healthValue = displayRun
      ? deliveryHealthPercent === null
        ? "—"
        : `${deliveryHealthPercent}%`
      : campaign.lastValidatedAt
        ? "Ready"
        : "—";
    const performanceMetric =
      displayRun
        ? {
            label: "Opened",
            value: openedPercent === null ? "—" : `${openedPercent}%`,
            detail:
              openedPercent === null
                ? isFromPreviousRun ? "Next run queued" : "Waiting for activity"
                : `${formatCount(displayRunSnapshot?.openedCount ?? 0)} opens${isFromPreviousRun ? " (last run)" : ""}`
          }
        : {
            label: "Delivered",
            value: "—",
            detail: "No run yet"
          };

    return (
      <article key={campaign.id} className={styles.sequenceRow}>
        <Link
          href={`/campaigns/${campaign.id}`}
          className={styles.sequenceContentLink}
          aria-label={`Open sequence ${campaign.name}`}
        >
          <div className={styles.sequenceMainGrid}>
            <div className={styles.sequencePrimary}>
              <div className={styles.sequenceIdentity}>
                <div className={styles.sequenceIcon}>
                  <SendHorizontal aria-hidden="true" />
                </div>
                <div className={styles.sequenceTitleBlock}>
                  <div className={styles.sequenceHeader}>
                    <h3 className={styles.sequenceTitle} title={campaign.name}>
                      {campaign.name}
                    </h3>
                    <span className="badge" title={campaign.status === "WAITING_FOR_SLOT" ? "This sequence will start automatically when an execution slot becomes available." : undefined}>
                      {formatSequenceStatus(campaign.status)}
                    </span>
                  </div>

                  <div className={styles.sequenceMetaRow}>
                    <span className={styles.metaPill} title={campaign.import.fileName}>
                      <Users aria-hidden="true" />
                      <span>{campaign.import.fileName}</span>
                    </span>
                    <span
                      className={styles.metaPill}
                      title={`${campaign.senderProfile.name} <${campaign.senderProfile.fromEmail}>`}
                    >
                      <Mail aria-hidden="true" />
                      <span>{campaign.senderProfile.name}</span>
                    </span>
                    <span className={styles.metaPill} title={campaign.template.name}>
                      <CheckCircle2 aria-hidden="true" />
                      <span>{campaign.template.name}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className={`${styles.metricCell} ${styles.metricHealth}`}>
              <span>Health</span>
              <strong>{healthValue}</strong>
              <div className={styles.metricTrack} aria-hidden="true">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              <small>{healthDetail}</small>
            </div>

            <div className={`${styles.metricCell} ${styles.metricEnrolled}`}>
              <span>Enrolled</span>
              <strong>{formatCount(recipientCount)}</strong>
              <small>Recipients</small>
            </div>

            <div className={`${styles.metricCell} ${styles.metricPerformance}`}>
              <span>{performanceMetric.label}</span>
              <strong>{performanceMetric.value}</strong>
              <small>{performanceMetric.detail}</small>
            </div>
          </div>

          <div className={styles.sequenceDetails}>
            <div className={styles.detailItem}>
              <span>Delivery</span>
              <strong title={delivery.fullDetail}>{delivery.label}</strong>
              <small>{delivery.fullDetail}</small>
            </div>

            <div className={styles.detailItem}>
              <span>Latest run</span>
              <strong>{latestRun ? formatSequenceStatus(latestRun.status) : "Waiting to launch"}</strong>
              <small>{latestRunValue ? <LocalDateTime value={latestRunValue} /> : "No delivery activity yet"}</small>
            </div>

            <div className={styles.detailItem}>
              <span>Validation</span>
              <strong>{validatedAtValue ? "Validated" : "Needs validation"}</strong>
              <small>{validatedAtValue ? <LocalDateTime value={validatedAtValue} /> : "Before next send"}</small>
            </div>

            <div className={styles.detailItem}>
              <span>Health</span>
              <strong>{latestRunSummary}</strong>
              <small>
                {displayRun && runMetricsKnown
                  ? issueCount
                    ? `${formatCount(issueCount)} issue${issueCount === 1 ? "" : "s"}`
                    : "Clean delivery"
                  : "No confirmed delivery yet"}
              </small>
            </div>
          </div>
        </Link>

        <div className={styles.sequenceActions}>
          <CampaignCardActions campaignId={campaign.id} campaignName={campaign.name} />
        </div>
      </article>
    );
  });

  return (
    <div className={styles.page}>
      <ActiveRunRefresher active={hasLiveActivity} intervalMs={4_000} />
      {gmailError ? <ErrorToastOnMount message={gmailError} title="Gmail connection failed" /> : null}
      <section className={styles.topGrid}>
        {gmailStatus === "connected" ? (
          <div className={styles.flashNotice}>
            <CheckCircle2 aria-hidden="true" />
            <span>Gmail reconnected. You can use that sender again.</span>
          </div>
        ) : null}
        <article className={styles.builderCard}>
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

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <Sparkles aria-hidden="true" />
          </div>
          <div>
            <span>Total sequences</span>
            <strong>{campaigns.length}</strong>
            <p>Everything currently configured in your workspace.</p>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <RefreshCcw aria-hidden="true" />
          </div>
          <div>
            <span>Validated</span>
            <strong>{validatedSequences}</strong>
            <p>Sequences with a recent validation pass.</p>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <CalendarClock aria-hidden="true" />
          </div>
          <div>
            <span>Scheduled</span>
            <strong>{scheduledSequences}</strong>
            <p>Run once or recurring sends queued on a schedule.</p>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <SendHorizontal aria-hidden="true" />
          </div>
          <div>
            <span>Active now</span>
            <strong>{activeSequences}</strong>
            <p>Runs that are currently queued or processing.</p>
          </div>
        </article>
      </section>

      <SequenceBoard cards={sequenceCards} totalCount={campaigns.length} pageSize={PAGE_SIZE} />
    </div>
  );
}
