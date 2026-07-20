import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  CalendarClock,
  Eye,
  FileStack,
  Mail,
  RefreshCcw,
  SendHorizontal,
  ShieldAlert,
  Users
} from "lucide-react";

import { ActiveRunRefresher } from "@/components/active-run-refresher";
import { CampaignBounceCheckButton } from "@/components/campaign-bounce-check-button";
import { CampaignLaunchButton } from "@/components/campaign-launch-button";
import { CampaignPauseResumeButton } from "@/components/campaign-pause-resume-button";
import { CampaignScheduleEditor } from "@/components/campaign-schedule-editor";
import { CampaignSetupEditor } from "@/components/campaign-setup-editor";
import { CampaignDetailDeleteButton } from "@/components/campaign-detail-delete-button";
import { CampaignRetryFailedButton } from "@/components/campaign-retry-failed-button";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { GmailReconnectNotice } from "@/components/incident/gmail-reconnect-notice";
import { LocalDateTime } from "@/components/local-date-time";
import { getAttachmentPreviewKind } from "@/lib/attachments";
import { requireOperatorUser } from "@/lib/auth";
import { getValidationChecksFromSnapshot } from "@/lib/campaign-health";
import { SCHEDULE_EDIT_DISABLED_MESSAGE, canEditCampaignSchedule } from "@/lib/campaign-schedule-edit";
import { isCampaignSetupLocked } from "@/lib/campaign-setup-lock";
import { prisma } from "@/lib/db";
import { getGmailDailySendWindow } from "@/lib/daily-send-limit";
import { RECIPIENT_ACTIVITY_PAGE_SIZE, buildRecipientActivityItem } from "@/lib/recipient-activity";
import { summarizeRecipientOverviewDispositions } from "@/lib/recipient-overview-disposition";
import { canShowRetryFailedAction, isManuallyRetriableFailedJob } from "@/lib/retry-eligibility";
import { formatSequenceStatus } from "@/lib/sequence-status";
import { RecipientActivity } from "@/components/recipient-activity";
import { processPendingCampaignWork, readDailyLimitPauseInfo, validateCampaign } from "@/services/campaigns";
import { syncRepliesForSenderProfile } from "@/services/replies";
import styles from "./page.module.css";

export const maxDuration = 60;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type CampaignTemplateSnapshot = {
  attachments?: Array<{
    fileName: string;
    contentType?: string | null;
  }>;
};

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

function formatWeeklyDayLabel(scheduleConfig?: ScheduleConfig | null, style: "long" | "short" = "long") {
  const days = getScheduleWeekdays(scheduleConfig);
  const labels = style === "long" ? dayNames : shortDayNames;
  return days.length === 1 ? labels[days[0] ?? 1] : days.map((day) => shortDayNames[day]).join(", ");
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

function formatScheduleLabel(scheduleType?: string | null, scheduleConfig?: ScheduleConfig | null) {
  if (scheduleType === "once") {
    const onceConfig = scheduleConfig && "scheduledFor" in scheduleConfig ? scheduleConfig : null;
    return `Scheduled for ${formatDateTime(onceConfig?.scheduledFor, onceConfig?.timeZone)}`;
  }

  if (scheduleType === "recurring") {
    const recurringConfig = scheduleConfig && "frequency" in scheduleConfig ? scheduleConfig : null;
    const frequencyLabel = recurringConfig?.frequency === "daily" ? "Daily" : "Weekly";
    const timeLabel = recurringConfig?.time ?? "09:00";
    const dayLabel =
      recurringConfig?.frequency === "weekly" ? ` on ${formatWeeklyDayLabel(recurringConfig)}` : "";
    const zoneLabel = recurringConfig?.timeZone ? ` (${recurringConfig.timeZone})` : "";

    return `${frequencyLabel}${dayLabel} at ${timeLabel}${zoneLabel}`;
  }

  return "Sends immediately when launched";
}

function getScheduleConfig(scheduleType?: string | null, scheduleConfig?: ScheduleConfig | null): ScheduleConfig {
  if (scheduleType === "once") {
    const onceConfig = scheduleConfig && "scheduledFor" in scheduleConfig ? scheduleConfig : null;

    return {
      type: "once",
      scheduledFor: onceConfig?.scheduledFor,
      timeZone: onceConfig?.timeZone
    };
  }

  if (scheduleType === "recurring") {
    const recurringConfig = scheduleConfig && "frequency" in scheduleConfig ? scheduleConfig : null;

    return {
      type: "recurring",
      frequency: recurringConfig?.frequency,
      time: recurringConfig?.time,
      dayOfWeek: recurringConfig?.dayOfWeek,
      daysOfWeek: recurringConfig?.daysOfWeek,
      timeZone: recurringConfig?.timeZone
    };
  }

  return { type: "immediate" };
}

async function validate(campaignId: string) {
  "use server";

  const user = await requireOperatorUser();
  await validateCampaign(campaignId, user.id);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function CampaignDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOperatorUser();
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const gmailStatus = getSearchParam(resolvedSearchParams, "gmail");
  const gmailError = getSearchParam(resolvedSearchParams, "gmail_error");
  const gmailSender = getSearchParam(resolvedSearchParams, "gmail_sender");
  const launchError = getSearchParam(resolvedSearchParams, "launch_error");
  const gmailErrorMessage = gmailError ? `${gmailError}${gmailSender ? ` Reconnect ${gmailSender} before sending again.` : ""}` : null;
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: {
      id,
      userId: user.id
    },
    include: {
      import: true,
      template: true,
      senderProfile: true,
      runs: {
        orderBy: { createdAt: "desc" },
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
          scheduledFor: true,
          startedAt: true,
          updatedAt: true,
          progressSnapshot: true
        }
      }
    }
  });
  const latestRun = campaign.runs[0] ?? null; // most-recent run — drives UI state (locks, buttons, auto-refresh)

  // Determine which run to pull metrics from. If the latest run is queued/unstarted
  // and a previous completed run exists, show that completed run's data instead of zeros.
  const ACTIVE_STATUSES = new Set(["QUEUED", "WAITING_FOR_SLOT", "RUNNING", "PAUSED"]);
  const DONE_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
  const latestActiveRun = campaign.runs.find((r) => ACTIVE_STATUSES.has(r.status)) ?? null;
  const latestCompletedRun = campaign.runs.find((r) => DONE_STATUSES.has(r.status)) ?? null;

  let displayRun: typeof latestRun | null = latestRun;
  let isFromPreviousRun = false;

  if (latestActiveRun) {
    const activeProcessed =
      (latestActiveRun.sentCount ?? 0) +
      (latestActiveRun.openedCount ?? 0) +
      (latestActiveRun.clickedCount ?? 0) +
      (latestActiveRun.failedCount ?? 0) +
      (latestActiveRun.suppressedCount ?? 0) +
      (latestActiveRun.invalidCount ?? 0);

    if (activeProcessed === 0 && latestCompletedRun) {
      displayRun = latestCompletedRun;
      isFromPreviousRun = true;
    } else {
      displayRun = latestActiveRun;
    }
  } else {
    displayRun = latestCompletedRun;
  }

  if (latestRun && campaign.senderProfile.oauthRefreshToken) {
    try {
      await syncRepliesForSenderProfile(campaign.senderProfileId, {
        force: true,
        maxMessages: 25
      });
    } catch (error) {
      console.error("[campaign-detail] Reply sync failed.", error);
    }
  }

  const [imports, mappings, templates, senders, recipientJobCount, replyCountAggregate, recipientStatusCounts] =
    await Promise.all([
    prisma.import.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        fileName: true,
        rowCount: true
      }
    }),
    prisma.mapping.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        importId: true,
        variableMap: true,
        reservedFieldMap: true
      }
    }),
    prisma.template.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        format: true
      }
    }),
    prisma.senderProfile.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        fromEmail: true,
        oauthRefreshToken: true
      }
    }),
    displayRun
      ? prisma.recipientJob.count({
          where: {
            campaignRunId: displayRun.id
          }
        })
      : Promise.resolve(0),
    displayRun
      ? prisma.recipientJob.aggregate({
          where: {
            campaignRunId: displayRun.id
          },
          _sum: {
            replyCount: true
          }
        })
      : Promise.resolve({
          _sum: {
            replyCount: 0
          }
        }),
    displayRun
      ? prisma.recipientJob.groupBy({
          by: ["status"],
          where: {
            campaignRunId: displayRun.id
          },
          _count: true
        })
      : Promise.resolve([]),
  ]);

  const senderNeedsReconnect = !campaign.senderProfile.oauthRefreshToken;
  const isActiveRun = latestRun ? ["QUEUED", "WAITING_FOR_SLOT", "RUNNING"].includes(latestRun.status) : false;
  const isWaitingForSlot = latestRun?.status === "WAITING_FOR_SLOT" || campaign.status === "WAITING_FOR_SLOT";
  const isPausedRun = latestRun?.status === "PAUSED" || campaign.status === "PAUSED";
  const dailyLimitPauseInfo = readDailyLimitPauseInfo(latestRun?.progressSnapshot ?? null);
  const senderSendWindow = await getGmailDailySendWindow({
    userId: user.id,
    senderProfileId: campaign.senderProfileId
  });
  const dailyLimitActive = senderSendWindow.isBlocked;
  const dailyLimitResumeIso =
    dailyLimitActive ? (dailyLimitPauseInfo?.pauseResumesAt ?? senderSendWindow.resetAt ?? null) : null;
  const setupLocked = isCampaignSetupLocked({
    campaignStatus: campaign.status,
    latestRunStatus: latestRun?.status ?? null
  });
  const attachments = ((campaign.templateSnapshot as CampaignTemplateSnapshot).attachments ?? []).filter(
    (attachment) => attachment.fileName
  );
  // Truthful Needs-attention count: classify recipients with the shared
  // overview disposition helper so permanently-invalid addresses (a Skipped
  // outcome, even on legacy rows still stored as FAILED) never inflate the
  // failure metric. Only genuine send failures and retries count here.
  const dispositionJobs = displayRun
    ? await prisma.recipientJob.findMany({
        where: { campaignRunId: displayRun.id },
        select: { status: true, metadata: true, lastError: true }
      })
    : [];
  const dispositionCounts = summarizeRecipientOverviewDispositions(dispositionJobs);
  const issueCount = dispositionCounts.needsAttention;
  const skippedCount = dispositionCounts.skipped;
  const recipientStatusCountMap = new Map(recipientStatusCounts.map((entry) => [entry.status, entry._count]));
  const replyCount = replyCountAggregate._sum.replyCount ?? 0;
  // Delivered comes from the same per-recipient classification as the other
  // cards, so an address that later hard-bounced (a Skipped outcome, even if a
  // false "open" left the row in an engagement status) never counts as
  // delivered — the three cards always add up truthfully.
  const deliveredCount = dispositionCounts.sent;
  const launchButtonLabel = dailyLimitActive
    ? "Waiting for Gmail safety window"
    : isWaitingForSlot
      ? "Waiting for slot"
    : isActiveRun
      ? "Run is processing"
      : isPausedRun
        ? "Sequence paused"
        : latestRun
          ? "Relaunch sequence"
          : "Launch sequence";
  const validationButtonLabel = campaign.lastValidatedAt ? "Refresh validation" : "Validate sequence";
  const validationVisibleLabel = campaign.lastValidatedAt ? "Refresh" : "Validate";
  const pauseButtonLabel = isPausedRun ? "Relaunch sequence" : "Pause sequence";
  // Retry-failed action: only surfaces when the latest run has finished and still
  // has retryable failed recipients, with nothing actively sending, paused, or
  // blocked. The eligible count is computed off the run's own recipient jobs.
  const latestRunStatus = latestRun?.status ?? null;
  const retryGateOpen =
    Boolean(latestRun) &&
    DONE_STATUSES.has(latestRunStatus ?? "") &&
    !isActiveRun &&
    !isPausedRun &&
    !senderNeedsReconnect &&
    !dailyLimitActive &&
    (latestRun?.failedCount ?? 0) > 0;
  let retryableFailedCount = 0;
  if (retryGateOpen && latestRun) {
    const failedJobs = await prisma.recipientJob.findMany({
      where: { campaignRunId: latestRun.id, status: "FAILED" },
      select: { status: true, metadata: true }
    });
    retryableFailedCount = failedJobs.filter(isManuallyRetriableFailedJob).length;
  }
  const canRetryFailed = canShowRetryFailedAction({
    latestRunStatus,
    isActiveRun,
    isPausedRun,
    senderConnected: !senderNeedsReconnect,
    dailyLimitActive,
    retryableFailedCount
  });
  const scheduleConfig = getScheduleConfig(campaign.scheduleType, campaign.scheduleConfig as ScheduleConfig | null);
  const scheduleLabel = formatScheduleLabel(campaign.scheduleType, scheduleConfig);
  const latestRunValue = latestRun?.updatedAt?.toISOString() ?? null;
  const validatedAtValue = campaign.lastValidatedAt?.toISOString() ?? null;
  const validationChecks = getValidationChecksFromSnapshot(campaign.validationSnapshot);
  const blockingValidationChecks = validationChecks.filter(
    (check) => check.severity === "BLOCKER" || check.severity === "ERROR"
  );
  const sequenceStatusLabel =
    issueCount > 0 && !isActiveRun && !isPausedRun
      ? "Needs attention"
      : formatSequenceStatus(campaign.status);
  const sequenceStatusTone =
    issueCount > 0 && !isActiveRun && !isPausedRun
      ? "attention"
      : isPausedRun
        ? "paused"
        : isActiveRun || isWaitingForSlot
          ? "active"
          : campaign.status === "COMPLETED"
            ? "completed"
            : "neutral";
  const validationStateLabel = blockingValidationChecks.length
    ? `${blockingValidationChecks.length} blocker${blockingValidationChecks.length === 1 ? "" : "s"}`
    : validatedAtValue
      ? "Validated"
      : "Not validated";
  const reconnectHref = `/api/auth/google/connect?email=${encodeURIComponent(campaign.senderProfile.fromEmail)}&next=${encodeURIComponent(`/campaigns/${campaign.id}`)}`;
  // First page of recipient activity — later pages load client-side without a route navigation.
  const initialRecipientJobs = displayRun
    ? await prisma.recipientJob.findMany({
        where: {
          campaignRunId: displayRun.id
        },
        orderBy: { updatedAt: "desc" },
        take: RECIPIENT_ACTIVITY_PAGE_SIZE,
        select: {
          id: true,
          recipientEmail: true,
          recipientName: true,
          status: true,
          lastError: true,
          metadata: true,
          retryCount: true,
          updatedAt: true,
          nextRetryAt: true
        }
      })
    : [];
  const recipientActivityItems = initialRecipientJobs.map(buildRecipientActivityItem);
  const canEditSchedule = canEditCampaignSchedule({
    campaignStatus: campaign.status,
    // When showing a previous run's metrics, the actual latest (QUEUED) run has 0 jobs.
    latestRunRecipientJobCount: isFromPreviousRun ? 0 : recipientJobCount,
    latestRunScheduledFor: latestRun?.scheduledFor ?? null,
    latestRunStartedAt: latestRun?.startedAt ?? null,
    latestRunStatus: latestRun?.status ?? null
  });
  const latestMappingsByImport = new Map<string, (typeof mappings)[number]>();

  for (const mapping of mappings) {
    if (!latestMappingsByImport.has(mapping.importId)) {
      latestMappingsByImport.set(mapping.importId, mapping);
    }
  }

  const importOptions = imports.map((entry) => {
    const mapping = latestMappingsByImport.get(entry.id);
    const variableMap =
      mapping?.variableMap && typeof mapping.variableMap === "object" && !Array.isArray(mapping.variableMap)
        ? (mapping.variableMap as Record<string, string>)
        : {};
    const fieldCount = Object.keys(variableMap).length;

    return {
      id: entry.id,
      label: entry.fileName,
      description: mapping
        ? `${entry.rowCount} contacts • ${fieldCount} mapped field${fieldCount === 1 ? "" : "s"}`
        : `${entry.rowCount} contacts • configure template fields first`,
      disabled: !mapping
    };
  });

  const templateOptions = templates.map((template) => ({
    id: template.id,
    label: template.name,
    description: `${humanize(template.format)} template`
  }));

  const senderOptions = senders.map((sender) => ({
    id: sender.id,
    label: sender.name || sender.fromEmail,
    description: sender.oauthRefreshToken
      ? sender.fromEmail
      : `${sender.fromEmail} • reconnect required`,
    disabled: !sender.oauthRefreshToken
  }));

  const initialSetup = {
    name: campaign.name,
    importId: campaign.importId,
    templateId: campaign.templateId,
    senderProfileId: campaign.senderProfileId,
    attachments: attachments.map((attachment, index) => ({
      id: `existing-${index}`,
      sourceIndex: index,
      fileName: attachment.fileName,
      contentType: attachment.contentType ?? null,
      previewKind: getAttachmentPreviewKind(attachment.fileName, attachment.contentType ?? null),
      previewUrl: `/api/campaigns/${campaign.id}/attachments/${index}`,
      downloadUrl: `/api/campaigns/${campaign.id}/attachments/${index}?download=1`
    }))
  };

  if (isActiveRun) {
    after(async () => {
      await processPendingCampaignWork({
        campaignId: campaign.id,
        maxDurationMs: 25_000
      });
    });
  }

  return (
    <div className={styles.page}>
      <ActiveRunRefresher active={isActiveRun} />
      {gmailErrorMessage ? <GmailReconnectNotice reconnectHref={reconnectHref} /> : null}
      {launchError ? <ErrorToastOnMount message={launchError} title="Sequence launch blocked" /> : null}
      {gmailStatus === "connected" ? (
        <div className={styles.flashNotice}>
          <RefreshCcw aria-hidden="true" />
          <span>Gmail reconnected. This sequence is ready to launch again.</span>
        </div>
      ) : null}
      {dailyLimitActive ? (
        <aside className={styles.safetyLimitCard} role="status" aria-live="polite">
          <span className={styles.safetyLimitIcon} aria-hidden="true">
            <ShieldAlert />
          </span>
          <div className={styles.safetyLimitBody}>
            <strong className={styles.safetyLimitTitle}>Daily Gmail safety limit reached</strong>
            <p className={styles.safetyLimitCopy}>
              {campaign.senderProfile.fromEmail} has sent{" "}
              {senderSendWindow.sentLast24h.toLocaleString()} / {senderSendWindow.limit.toLocaleString()} emails
              in the last 24 hours. Sendloom paused sending to avoid Gmail rejections.
              {dailyLimitResumeIso ? (
                <>
                  {" "}Sending will resume at{" "}
                  <strong>
                    <LocalDateTime value={dailyLimitResumeIso} />
                  </strong>
                  .
                </>
              ) : null}
            </p>
          </div>
        </aside>
      ) : null}
      <section className={styles.overview} aria-label="Sequence overview">
        <div className={styles.overviewMain} data-tour-sequence-detail="overview">
          <span className={styles.kicker}>Sequence overview</span>
          <div className={styles.titleRow}>
            <h1>{campaign.name}</h1>
            <span className={styles.statusPill} data-tone={sequenceStatusTone}>
              <span aria-hidden="true" />
              {sequenceStatusLabel}
            </span>
          </div>
          <p className={styles.lede}>
            Delivery posture, setup context, and live run health for this sequence in one place.
          </p>

          <div className={styles.metaRow}>
            <span className={styles.metaChip}>
              <Users aria-hidden="true" />
              {campaign.import.fileName}
            </span>
            <span className={styles.metaChip}>
              <FileStack aria-hidden="true" />
              {campaign.template.name}
            </span>
            <span className={styles.metaChip}>
              <Mail aria-hidden="true" />
              {campaign.senderProfile.fromEmail}
            </span>
          </div>
        </div>

        <aside className={styles.commandCenter}>
          {senderNeedsReconnect ? (
            <div className={styles.reconnectNotice}>
              <strong>Sender needs reconnect</strong>
              <p>
                Google revoked access for {campaign.senderProfile.fromEmail}. Reconnect it before you launch this
                sequence again.
              </p>
              <a className="button secondary" href={reconnectHref}>
                Reconnect Gmail
              </a>
            </div>
          ) : null}

          <div className={styles.stateGrid} data-tour-sequence-detail="run-health">
            <div className={styles.stateItem}>
              <CalendarClock aria-hidden="true" />
              <div>
                <span>Send timing</span>
                <strong>{scheduleLabel}</strong>
              </div>
            </div>
            <div className={styles.stateItem}>
              <RefreshCcw aria-hidden="true" />
              <div>
                <span>Validation</span>
                <strong>{validationStateLabel}</strong>
                {validatedAtValue ? <small><LocalDateTime value={validatedAtValue} /></small> : null}
              </div>
            </div>
            <div className={styles.stateItem}>
              <SendHorizontal aria-hidden="true" />
              <div>
                <span>Current run</span>
                <strong>{latestRun ? formatSequenceStatus(latestRun.status) : "Not launched yet"}</strong>
                {latestRunValue ? <small>Updated <LocalDateTime value={latestRunValue} /></small> : null}
              </div>
            </div>
          </div>

          <p className={styles.statusNote}>
            {isWaitingForSlot
              ? "Starts automatically when an execution slot becomes available."
              : isActiveRun
                ? "Live run · auto-refreshing every 8 seconds."
                : latestRunValue
                  ? "Controls and run health are up to date."
                  : "Ready for its first launch."}
          </p>

          <div className={styles.actionBar} data-tour-sequence-detail="actions">
            <div className={styles.utilityActions} aria-label="Sequence actions">
              {!senderNeedsReconnect && !isActiveRun && !isPausedRun && !dailyLimitActive ? (
                <div className={styles.actionItem}>
                  <CampaignLaunchButton
                    campaignId={campaign.id}
                    label={launchButtonLabel}
                    disabled={false}
                    iconOnly
                  />
                </div>
              ) : null}
              <form action={validate.bind(null, campaign.id)} className={styles.actionItem}>
                <button
                  className="sequence-detail-action"
                  type="submit"
                  aria-label={validationButtonLabel}
                  data-action="refresh"
                >
                  <span className="sequence-detail-action__icon"><RefreshCcw aria-hidden="true" /></span>
                  <span className="sequence-detail-action__label">{validationVisibleLabel}</span>
                </button>
              </form>
              {/* Post-send bounce check — reads Gmail delivery-status reports
                  for already-sent emails; deliberately separate from Refresh
                  validation (which checks setup before a launch) and always
                  available, including for completed sequences. */}
              <CampaignBounceCheckButton
                campaignId={campaign.id}
                senderNeedsReconnect={senderNeedsReconnect}
                className={styles.actionItem}
                iconOnly
              />
              {latestRun && (isActiveRun || isPausedRun) ? (
                <CampaignPauseResumeButton
                  campaignId={campaign.id}
                  isPaused={isPausedRun}
                  label={pauseButtonLabel}
                  className={styles.actionItem}
                  iconOnly
                />
              ) : null}
              <CampaignScheduleEditor
                campaignId={campaign.id}
                canEdit={canEditSchedule}
                className={styles.actionItem}
                disabledMessage={SCHEDULE_EDIT_DISABLED_MESSAGE}
                initialSchedule={scheduleConfig}
                iconOnly
              />
              {canRetryFailed ? (
                <CampaignRetryFailedButton
                  campaignId={campaign.id}
                  failedCount={retryableFailedCount}
                  className={styles.actionItem}
                  iconOnly
                />
              ) : null}
            </div>

            <div className={styles.dangerAction}>
              <CampaignDetailDeleteButton campaignId={campaign.id} campaignName={campaign.name} iconOnly />
            </div>
          </div>
        </aside>
      </section>

      <section className={styles.metrics} data-tour-sequence-detail="delivery-stats">
        <article className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <Users aria-hidden="true" />
          </div>
          <div className={styles.metricCopy}>
            <span className={styles.metricLabel}>Audience size</span>
            <span className={styles.metricMeta}>
              {isFromPreviousRun ? "Last run" : "This run"}
              {skippedCount > 0 ? ` · ${skippedCount} skipped` : " · Ready to contact"}
            </span>
          </div>
          <strong className={styles.metricValue}>{displayRun?.totalRecipients ?? campaign.import.rowCount ?? 0}</strong>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <SendHorizontal aria-hidden="true" />
          </div>
          <div className={styles.metricCopy}>
            <span className={styles.metricLabel}>Delivered</span>
            <span className={styles.metricMeta}>{isFromPreviousRun ? "Last run" : "Sent + opened + clicked"}</span>
          </div>
          <strong className={styles.metricValue}>{deliveredCount}</strong>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <ShieldAlert aria-hidden="true" />
          </div>
          <div className={styles.metricCopy}>
            <span className={styles.metricLabel}>Skipped / invalid</span>
            <span className={styles.metricMeta}>Invalid or excluded recipients</span>
          </div>
          <strong className={styles.metricValue}>{skippedCount}</strong>
        </article>
      </section>
      {validationChecks.length ? (
        <section className={styles.validationBand}>
          <article className={`${styles.panel} ${styles.validationPanel}`}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Validation</h2>
                <p>
                  {blockingValidationChecks.length
                    ? `${blockingValidationChecks.length} launch blocker${blockingValidationChecks.length === 1 ? "" : "s"} need attention before this sequence can send.`
                    : "The latest validation found no launch blockers."}
                </p>
              </div>
            </div>

            <div className={styles.validationList}>
              {validationChecks.map((check, index) => (
                <div
                  key={`${check.code}-${index}`}
                  className={[
                    styles.validationItem,
                    check.severity === "BLOCKER"
                      ? styles.validationItemBlocker
                      : check.severity === "ERROR"
                        ? styles.validationItemError
                        : styles.validationItemWarning
                  ].join(" ")}
                >
                  <span>{humanize(check.severity)}</span>
                  <div>
                    <strong>{check.message}</strong>
                    {check.details ? <em>{check.details}</em> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}
      <section className={styles.detailGrid}>
        <article className={styles.panel} data-tour-sequence-detail="setup">
          <CampaignSetupEditor
            campaignId={campaign.id}
            currentSenderNeedsReconnect={senderNeedsReconnect}
            importOptions={importOptions}
            initialSetup={initialSetup}
            isLocked={setupLocked}
            senderOptions={senderOptions}
            templateOptions={templateOptions}
            scheduleLabel={scheduleLabel}
          />
        </article>

        <article
          className={`${styles.panel} ${styles.jobPanel}`}
          data-tour-sequence-detail="recipient-activity"
        >
          <div className={styles.panelHeader}>
            <div>
              <h2>Recent recipient activity</h2>
              {isFromPreviousRun ? <p className={styles.panelNote}>Last completed run</p> : null}
            </div>
          </div>

          {recipientJobCount && displayRun ? (
            <RecipientActivity
              campaignId={campaign.id}
              runId={displayRun.id}
              initialItems={recipientActivityItems}
              initialPage={1}
              totalCount={recipientJobCount}
              pageSize={RECIPIENT_ACTIVITY_PAGE_SIZE}
            />
          ) : (
            <div className={styles.emptyState}>
              {isFromPreviousRun
                ? "No recipient activity recorded for this run yet."
                : "Launch the sequence to start seeing recipient activity here."}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
