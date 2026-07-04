import type { CampaignStatus, RunStatus } from "@prisma/client";

export const CAMPAIGN_SETUP_LOCKED_RUN_STATUSES = ["QUEUED", "WAITING_FOR_SLOT", "RUNNING"] as const satisfies ReadonlyArray<RunStatus>;
const campaignSetupLockedRunStatuses = new Set<RunStatus>(CAMPAIGN_SETUP_LOCKED_RUN_STATUSES);

export function isCampaignSetupLocked(args: {
  campaignStatus?: CampaignStatus | null;
  latestRunStatus?: RunStatus | null;
}) {
  return (
    args.campaignStatus === "RUNNING" ||
    args.campaignStatus === "WAITING_FOR_SLOT" ||
    (args.latestRunStatus != null && campaignSetupLockedRunStatuses.has(args.latestRunStatus))
  );
}
