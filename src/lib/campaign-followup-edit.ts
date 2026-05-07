import type { CampaignStatus, RunStatus } from "@prisma/client";

type CampaignFollowUpEditState = {
  campaignStatus?: CampaignStatus | null;
  latestRunRecipientJobCount?: number | null;
  latestRunStartedAt?: Date | string | null;
  latestRunStatus?: RunStatus | null;
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

export const FOLLOW_UP_EDIT_DISABLED_MESSAGE =
  "Follow-up settings can only be changed when the sequence is not actively sending.";

export function canEditCampaignFollowUps({
  campaignStatus,
  latestRunRecipientJobCount,
  latestRunStartedAt,
  latestRunStatus
}: CampaignFollowUpEditState) {
  if (!campaignStatus || !editableCampaignStatuses.has(campaignStatus)) {
    return false;
  }

  if (!latestRunStatus || terminalRunStatuses.has(latestRunStatus)) {
    return true;
  }

  if (latestRunStatus === "QUEUED" || latestRunStatus === "PAUSED") {
    return !latestRunStartedAt && (latestRunRecipientJobCount ?? 0) === 0;
  }

  return false;
}
