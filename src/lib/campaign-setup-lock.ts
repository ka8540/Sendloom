import type { CampaignStatus, RunStatus } from "@prisma/client";

export const CAMPAIGN_SETUP_LOCKED_RUN_STATUSES = ["QUEUED", "RUNNING"] as const satisfies ReadonlyArray<RunStatus>;
const campaignSetupLockedRunStatuses = new Set<RunStatus>(CAMPAIGN_SETUP_LOCKED_RUN_STATUSES);

export function isCampaignSetupLocked(args: {
  campaignStatus?: CampaignStatus | null;
  latestRunStatus?: RunStatus | null;
}) {
  return args.campaignStatus === "RUNNING" || (args.latestRunStatus != null && campaignSetupLockedRunStatuses.has(args.latestRunStatus));
}
