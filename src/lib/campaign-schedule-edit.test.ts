import { describe, expect, it } from "vitest";

import { canEditCampaignSchedule, planCampaignScheduleUpdate } from "@/lib/campaign-schedule-edit";

describe("canEditCampaignSchedule", () => {
  const now = new Date("2026-05-04T16:00:00.000Z");

  it("allows completed sequences to edit timing before launch again", () => {
    expect(
      canEditCampaignSchedule({
        campaignStatus: "COMPLETED",
        latestRunRecipientJobCount: 25,
        latestRunStatus: "COMPLETED",
        now
      })
    ).toBe(true);
  });

  it("blocks sequences that are actively running", () => {
    expect(
      canEditCampaignSchedule({
        campaignStatus: "RUNNING",
        latestRunRecipientJobCount: 1,
        latestRunStartedAt: now,
        latestRunStatus: "RUNNING",
        now
      })
    ).toBe(false);
  });

  it("allows future queued sequences that have not started processing recipients", () => {
    expect(
      canEditCampaignSchedule({
        campaignStatus: "SCHEDULED",
        latestRunRecipientJobCount: 0,
        latestRunScheduledFor: new Date("2026-05-04T17:00:00.000Z"),
        latestRunStatus: "QUEUED",
        now
      })
    ).toBe(true);
  });
});

describe("planCampaignScheduleUpdate", () => {
  it("queues a fresh run when a completed send-now sequence is rescheduled (Case B)", () => {
    const plan = planCampaignScheduleUpdate({
      campaignStatus: "COMPLETED",
      hasValidatedSnapshot: true,
      scheduleType: "once",
      latestRun: {
        status: "COMPLETED",
        startedAt: new Date("2026-05-04T16:00:00.000Z"),
        recipientJobCount: 25,
        scheduledFor: new Date("2026-05-04T16:00:00.000Z")
      }
    });

    expect(plan).toEqual({ runAction: "create", nextStatus: "SCHEDULED" });
  });

  it("queues a fresh run when a completed scheduled sequence is rescheduled (Case C)", () => {
    const plan = planCampaignScheduleUpdate({
      campaignStatus: "COMPLETED",
      hasValidatedSnapshot: true,
      scheduleType: "recurring",
      latestRun: {
        status: "COMPLETED",
        startedAt: new Date("2026-05-04T16:00:00.000Z"),
        recipientJobCount: 10,
        scheduledFor: new Date("2026-05-04T16:00:00.000Z")
      }
    });

    expect(plan).toEqual({ runAction: "create", nextStatus: "SCHEDULED" });
  });

  it("creates a scheduled run for a brand-new draft sequence (Case A)", () => {
    const plan = planCampaignScheduleUpdate({
      campaignStatus: "DRAFT",
      hasValidatedSnapshot: false,
      scheduleType: "once",
      latestRun: null
    });

    expect(plan).toEqual({ runAction: "create", nextStatus: "SCHEDULED" });
  });

  it("reuses an unstarted queued run instead of creating a duplicate", () => {
    const plan = planCampaignScheduleUpdate({
      campaignStatus: "SCHEDULED",
      hasValidatedSnapshot: true,
      scheduleType: "once",
      latestRun: {
        status: "QUEUED",
        startedAt: null,
        recipientJobCount: 0,
        scheduledFor: new Date("2026-05-04T17:00:00.000Z")
      }
    });

    expect(plan).toEqual({ runAction: "reuse", nextStatus: "SCHEDULED" });
  });

  it("does not queue a run when switching a completed sequence back to send right away", () => {
    const plan = planCampaignScheduleUpdate({
      campaignStatus: "COMPLETED",
      hasValidatedSnapshot: true,
      scheduleType: "immediate",
      latestRun: {
        status: "COMPLETED",
        startedAt: new Date("2026-05-04T16:00:00.000Z"),
        recipientJobCount: 25,
        scheduledFor: new Date("2026-05-04T16:00:00.000Z")
      }
    });

    expect(plan).toEqual({ runAction: "none", nextStatus: "COMPLETED" });
  });
});
