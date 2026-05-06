import { getNextRunDate } from "@/lib/schedule";
import type { ScheduleRule } from "@/lib/types";

export const SCHEDULABLE_CAMPAIGN_STATUSES = new Set(["DRAFT", "VALIDATED", "SCHEDULED", "COMPLETED"]);
export const ACTIVE_RUN_STATUSES = new Set(["QUEUED", "RUNNING", "PAUSED"]);

export type ScheduledRunState = {
  status: string;
  scheduledFor: Date | null;
};

export type ScheduledCampaignState = {
  status: string;
  scheduleType: string | null;
  scheduleConfig: ScheduleRule | null;
  runs: ScheduledRunState[];
};

export type ScheduledCampaignPlan =
  | {
      action: "create-run";
      due: boolean;
      launchType: "once" | "recurring";
      scheduledFor: Date;
    }
  | {
      action: "skip";
      due: boolean;
      reason:
        | "not-scheduled"
        | "unsupported-rule"
        | "campaign-status"
        | "active-run"
        | "one-time-run-exists";
    };

export function isScheduledRunDue(scheduledFor: Date | null, now = new Date()) {
  return !scheduledFor || scheduledFor <= now;
}

export function getNextRecurringRunDate(rule: Extract<ScheduleRule, { type: "recurring" }>, now = new Date()) {
  return getNextRunDate(rule, now);
}

export function planScheduledCampaignRun(campaign: ScheduledCampaignState, now = new Date()): ScheduledCampaignPlan {
  const rule = campaign.scheduleConfig;

  if (campaign.scheduleType !== "once" && campaign.scheduleType !== "recurring") {
    return { action: "skip", due: false, reason: "not-scheduled" };
  }

  if (!rule || rule.type !== campaign.scheduleType) {
    return { action: "skip", due: false, reason: "unsupported-rule" };
  }

  if (!SCHEDULABLE_CAMPAIGN_STATUSES.has(campaign.status)) {
    return { action: "skip", due: false, reason: "campaign-status" };
  }

  const activeRun = campaign.runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (activeRun) {
    return { action: "skip", due: isScheduledRunDue(activeRun.scheduledFor, now), reason: "active-run" };
  }

  if (rule.type === "once" && campaign.runs.length > 0) {
    return { action: "skip", due: false, reason: "one-time-run-exists" };
  }

  const scheduledFor = getNextRunDate(rule, now);

  return {
    action: "create-run",
    due: isScheduledRunDue(scheduledFor, now),
    launchType: rule.type,
    scheduledFor
  };
}
