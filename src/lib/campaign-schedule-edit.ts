import type { CampaignStatus, RunStatus } from "@prisma/client";

type CampaignScheduleEditState = {
  campaignStatus?: CampaignStatus | null;
  latestRunRecipientJobCount?: number | null;
  latestRunScheduledFor?: Date | string | null;
  latestRunStartedAt?: Date | string | null;
  latestRunStatus?: RunStatus | null;
  now?: Date;
};

const editableCampaignStatuses = new Set<CampaignStatus>([
  "DRAFT",
  "VALIDATED",
  "SCHEDULED",
  "PAUSED",
  "COMPLETED",
  "FAILED"
]);
const terminalRunStatuses = new Set<RunStatus>(["COMPLETED", "FAILED", "CANCELLED"]);

export const SCHEDULE_EDIT_DISABLED_MESSAGE = "Schedule can only be edited when the sequence is not actively sending.";

export function canEditCampaignSchedule({
  campaignStatus,
  latestRunRecipientJobCount,
  latestRunScheduledFor,
  latestRunStartedAt,
  latestRunStatus,
  now = new Date()
}: CampaignScheduleEditState) {
  if (!campaignStatus || !editableCampaignStatuses.has(campaignStatus)) {
    return false;
  }

  if (!latestRunStatus) {
    return true;
  }

  if (terminalRunStatuses.has(latestRunStatus)) {
    return true;
  }

  if (latestRunStatus === "PAUSED") {
    return !latestRunStartedAt && (latestRunRecipientJobCount ?? 0) === 0;
  }

  if (latestRunStatus !== "QUEUED" || latestRunStartedAt || (latestRunRecipientJobCount ?? 0) > 0) {
    return false;
  }

  if (!latestRunScheduledFor) {
    return false;
  }

  const scheduledFor = latestRunScheduledFor instanceof Date ? latestRunScheduledFor : new Date(latestRunScheduledFor);

  return !Number.isNaN(scheduledFor.getTime()) && scheduledFor > now;
}

type CampaignScheduleUpdateInput = {
  campaignStatus: CampaignStatus;
  hasValidatedSnapshot: boolean;
  scheduleType: "immediate" | "once" | "recurring";
  latestRun: {
    status: RunStatus;
    startedAt: Date | string | null;
    recipientJobCount: number;
    scheduledFor: Date | string | null;
  } | null;
};

export type CampaignScheduleUpdatePlan = {
  runAction: "reuse" | "create" | "none";
  nextStatus: CampaignStatus;
};

/**
 * Pure decision for how a schedule edit should affect a campaign's lifecycle.
 *
 * - `reuse`: the latest run is still pending (queued/paused, unstarted, no
 *   recipient jobs) so we simply move its scheduled time.
 * - `create`: there is no reusable run (the latest run already completed/failed,
 *   or none exists) and the new schedule is a one-time/recurring send, so a
 *   fresh run must be queued. The historical run is left untouched.
 * - `none`: nothing run-related changes (e.g. switching back to "send right
 *   away", which is launched explicitly).
 */
export function planCampaignScheduleUpdate({
  campaignStatus,
  hasValidatedSnapshot,
  scheduleType,
  latestRun
}: CampaignScheduleUpdateInput): CampaignScheduleUpdatePlan {
  const canReuseRun = Boolean(
    latestRun &&
      (latestRun.status === "QUEUED" || latestRun.status === "PAUSED") &&
      !latestRun.startedAt &&
      (latestRun.recipientJobCount ?? 0) === 0
  );

  const isScheduledSend = scheduleType === "once" || scheduleType === "recurring";
  const shouldCreateRun = !canReuseRun && isScheduledSend;

  let nextStatus: CampaignStatus = campaignStatus;

  if (canReuseRun && latestRun?.status === "QUEUED") {
    nextStatus = scheduleType === "immediate" ? "RUNNING" : "SCHEDULED";
  } else if (scheduleType === "immediate" && campaignStatus === "SCHEDULED") {
    nextStatus = hasValidatedSnapshot ? "VALIDATED" : "DRAFT";
  } else if (shouldCreateRun) {
    nextStatus = "SCHEDULED";
  }

  const runAction: CampaignScheduleUpdatePlan["runAction"] = canReuseRun
    ? "reuse"
    : shouldCreateRun
      ? "create"
      : "none";

  return { runAction, nextStatus };
}
