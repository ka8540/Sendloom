import type { CampaignStatus, RunStatus } from "@prisma/client";

type CampaignScheduleEditState = {
  campaignStatus?: CampaignStatus | null;
  latestRunRecipientJobCount?: number | null;
  latestRunScheduledFor?: Date | string | null;
  latestRunStartedAt?: Date | string | null;
  latestRunStatus?: RunStatus | null;
  now?: Date;
};

export const SCHEDULE_EDIT_DISABLED_MESSAGE = "Schedule can only be edited before sending starts.";

export function canEditCampaignSchedule({
  campaignStatus,
  latestRunRecipientJobCount,
  latestRunScheduledFor,
  latestRunStartedAt,
  latestRunStatus,
  now = new Date()
}: CampaignScheduleEditState) {
  if (!campaignStatus || !["DRAFT", "VALIDATED", "SCHEDULED"].includes(campaignStatus)) {
    return false;
  }

  if (!latestRunStatus) {
    return true;
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
