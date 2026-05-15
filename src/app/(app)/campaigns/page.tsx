import Link from "next/link";
import { after } from "next/server";
import { redirect } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  CheckCircle2,
  Mail,
  RefreshCcw,
  SendHorizontal,
  Sparkles,
  Users
} from "lucide-react";

import { CampaignCardActions } from "@/components/campaign-card-actions";
import { CampaignBuilder } from "@/components/campaign-builder";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { LocalDateTime } from "@/components/local-date-time";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processPendingCampaignWork } from "@/services/campaigns";
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

  return !["QUEUED", "RUNNING"].includes(run.status ?? "") || processedCount > 0;
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

export default async function CampaignsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOperatorUser();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const gmailStatus = getSearchParam(resolvedSearchParams, "gmail");
  const gmailError = getSearchParam(resolvedSearchParams, "gmail_error");
  const requestedPage = Array.isArray(resolvedSearchParams.page)
    ? resolvedSearchParams.page[0]
    : resolvedSearchParams.page;
  const parsedPage = requestedPage ? Number.parseInt(requestedPage, 10) : 1;
  const currentPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
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
        runs: { orderBy: { createdAt: "desc" }, take: 1 }
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
        campaign.runs.some((run) => ["QUEUED", "RUNNING"].includes(run.status))
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
      campaign.runs.some((run) => ["QUEUED", "RUNNING"].includes(run.status))
  ).length;
  const scheduledSequences = campaigns.filter((campaign) => campaign.scheduleType !== "immediate").length;
  const validatedSequences = campaigns.filter((campaign) => Boolean(campaign.lastValidatedAt)).length;
  const totalPages = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));

  if (currentPage > totalPages) {
    redirect(currentPage === 1 ? "/campaigns" : `/campaigns?page=${totalPages}`);
  }

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pagedCampaigns = campaigns.slice(startIndex, startIndex + PAGE_SIZE);
  const latestRunIds = pagedCampaigns.flatMap((campaign) => (campaign.runs[0] ? [campaign.runs[0].id] : []));
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
  const showingFrom = campaigns.length ? startIndex + 1 : 0;
  const showingTo = Math.min(startIndex + PAGE_SIZE, campaigns.length);

  return (
    <div className={styles.page}>
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

      <section className={styles.sequenceSection}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.kicker}>Sequence board</span>
            <h2>Sequences</h2>
            <p>Delivery posture, latest run, and setup context at a glance.</p>
          </div>
          <div className={styles.sectionMeta}>
            <Users aria-hidden="true" />
            <span>{campaigns.length} total</span>
          </div>
        </div>

        {campaigns.length ? (
          <div className={styles.sequenceList}>
            {pagedCampaigns.map((campaign) => {
              const latestRun = campaign.runs[0];
              const latestRunCountsByStatus = latestRun ? latestRunCounts.get(latestRun.id) : null;
              const latestRunSnapshot = latestRun
                ? {
                    ...latestRun,
                    sentCount: latestRunCountsByStatus ? (latestRunCountsByStatus.SENT ?? 0) : latestRun.sentCount,
                    openedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.OPENED ?? 0) : latestRun.openedCount,
                    clickedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.CLICKED ?? 0) : latestRun.clickedCount,
                    failedCount: latestRunCountsByStatus ? (latestRunCountsByStatus.FAILED ?? 0) : latestRun.failedCount,
                    suppressedCount: latestRunCountsByStatus
                      ? (latestRunCountsByStatus.SUPPRESSED ?? 0)
                      : latestRun.suppressedCount,
                    invalidCount: latestRunCountsByStatus ? (latestRunCountsByStatus.INVALID ?? 0) : latestRun.invalidCount
                  }
                : null;
              const deliveredCount = getDeliveredCount(latestRunSnapshot);
              const issueCount = getIssueCount(latestRunSnapshot);
              const processedCount = getProcessedCount(latestRunSnapshot);
              const runMetricsKnown = hasKnownRunMetrics(latestRunSnapshot, processedCount);
              const recipientCount = latestRun?.totalRecipients ?? campaign.import.rowCount;
              const deliveryHealthPercent =
                runMetricsKnown && latestRunSnapshot
                  ? getPercent(deliveredCount, latestRunSnapshot.totalRecipients)
                  : null;
              const progressPercent =
                latestRunSnapshot && latestRunSnapshot.totalRecipients > 0
                  ? getPercent(processedCount, latestRunSnapshot.totalRecipients)
                  : 0;
              const openedPercent =
                runMetricsKnown && latestRunSnapshot
                  ? getPercent(latestRunSnapshot.openedCount, latestRunSnapshot.totalRecipients)
                  : null;
              const delivery = formatDeliveryLabel(campaign.scheduleType, campaign.scheduleConfig as ScheduleConfig | null);
              const latestRunSummary = latestRun
                ? runMetricsKnown
                  ? `${formatCount(deliveredCount)}/${formatCount(latestRun.totalRecipients)} delivered`
                  : "Metrics syncing"
                : "No run started yet";
              const latestRunValue = latestRun?.updatedAt?.toISOString() ?? null;
              const validatedAtValue = campaign.lastValidatedAt?.toISOString() ?? null;
              const healthDetail = latestRun
                ? runMetricsKnown
                  ? latestRunSummary
                  : "Waiting for activity"
                : campaign.lastValidatedAt
                  ? "Validated and ready"
                  : "Awaiting first run";
              const healthValue = latestRun
                ? deliveryHealthPercent === null
                  ? "—"
                  : `${deliveryHealthPercent}%`
                : campaign.lastValidatedAt
                  ? "Ready"
                  : "—";
              const performanceMetric =
                latestRun
                  ? {
                      label: "Opened",
                      value: openedPercent === null ? "—" : `${openedPercent}%`,
                      detail:
                        openedPercent === null
                          ? "Waiting for activity"
                          : `${formatCount(latestRunSnapshot?.openedCount ?? 0)} opens`
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
                              <span className="badge">{humanize(campaign.status)}</span>
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
                        <strong>{latestRun ? humanize(latestRun.status) : "Waiting to launch"}</strong>
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
                          {latestRun && runMetricsKnown
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
            })}

            {totalPages > 1 ? (
              <div className={styles.paginationBar}>
                <span className={styles.paginationSummary}>
                  Showing {showingFrom}-{showingTo} of {campaigns.length}
                </span>
                <div className={styles.paginationControls}>
                  {currentPage > 1 ? (
                    <Link className={styles.paginationButton} href={currentPage - 1 === 1 ? "/campaigns" : `/campaigns?page=${currentPage - 1}`}>
                      <ChevronLeft aria-hidden="true" />
                    </Link>
                  ) : (
                    <span className={styles.paginationButton} aria-disabled="true">
                      <ChevronLeft aria-hidden="true" />
                    </span>
                  )}

                  <span className={styles.paginationPage}>
                    Page {currentPage} of {totalPages}
                  </span>

                  {currentPage < totalPages ? (
                    <Link className={styles.paginationButton} href={`/campaigns?page=${currentPage + 1}`}>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  ) : (
                    <span className={styles.paginationButton} aria-disabled="true">
                      <ChevronRight aria-hidden="true" />
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>No sequences yet</strong>
            <p>Create your first sequence above to see delivery activity, timing, and validation status here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
