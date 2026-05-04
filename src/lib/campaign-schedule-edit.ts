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
