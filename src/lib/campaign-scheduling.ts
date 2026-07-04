import { getNextRunDate } from "@/lib/schedule";
import type { ScheduleRule } from "@/lib/types";

export const SCHEDULABLE_CAMPAIGN_STATUSES = new Set(["DRAFT", "VALIDATED", "SCHEDULED", "COMPLETED"]);
export const ACTIVE_RUN_STATUSES = new Set(["QUEUED", "WAITING_FOR_SLOT", "RUNNING", "PAUSED"]);

/**
 * Structured response code returned by the launch endpoint when a relaunch targets a
 * one-time ("schedule once") sequence whose scheduled time has already passed. The
 * client uses this to show a confirmation modal instead of a raw validation error, then
 * retries the launch with `convertPastScheduleToImmediate: true`.
 */
export const PAST_SCHEDULE_CONFIRMATION_CODE = "PAST_SCHEDULE_CONFIRMATION_REQUIRED";

/**
 * True when a sequence is configured as a one-time ("schedule once") send whose
 * scheduled moment has already passed. Relaunching such a sequence would otherwise fail
 * the "One-time schedule must be in the future" validation, so the relaunch flow uses
 * this to offer converting it to an immediate send instead of hard-blocking.
 *
 * A missing or unparseable schedule is intentionally NOT treated as "past": that is a
 * genuine configuration error that the normal validation should continue to surface.
 * The comparison always uses server time so it is not affected by the client timezone.
 */
export function isPastOnceSchedule(
  scheduleType: string | null | undefined,
  scheduleConfig: ScheduleRule | null | undefined,
  now = new Date()
): boolean {
  if (scheduleType !== "once" || !scheduleConfig || scheduleConfig.type !== "once") {
    return false;
  }

  const runDate = getNextRunDate(scheduleConfig, now);
  if (Number.isNaN(runDate.getTime())) {
    return false;
  }

  return runDate <= now;
}

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
