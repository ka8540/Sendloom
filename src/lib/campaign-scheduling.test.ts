import { describe, expect, it } from "vitest";

import { getNextRecurringRunDate, planScheduledCampaignRun } from "@/lib/campaign-scheduling";

describe("planScheduledCampaignRun", () => {
  it("marks a one-time schedule due when its scheduled time has passed", () => {
    const plan = planScheduledCampaignRun(
      {
        status: "SCHEDULED",
        scheduleType: "once",
        scheduleConfig: {
          type: "once",
          scheduledFor: "2026-03-26T12:00:00.000Z"
        },
        runs: []
      },
      new Date("2026-03-26T12:01:00.000Z")
    );

    expect(plan).toMatchObject({
      action: "create-run",
      due: true,
      launchType: "once"
    });
  });

  it("keeps a future one-time schedule out of the due set", () => {
    const plan = planScheduledCampaignRun(
      {
        status: "SCHEDULED",
        scheduleType: "once",
        scheduleConfig: {
          type: "once",
          scheduledFor: "2026-03-26T12:00:00.000Z"
        },
        runs: []
      },
      new Date("2026-03-26T11:59:00.000Z")
    );

    expect(plan).toMatchObject({
      action: "create-run",
      due: false,
      launchType: "once"
    });
  });

  it("does not pick up a completed one-time campaign again", () => {
    const plan = planScheduledCampaignRun(
      {
        status: "COMPLETED",
        scheduleType: "once",
        scheduleConfig: {
          type: "once",
          scheduledFor: "2026-03-26T12:00:00.000Z"
        },
        runs: [
          {
            status: "COMPLETED",
            scheduledFor: new Date("2026-03-26T12:00:00.000Z")
          }
        ]
      },
      new Date("2026-03-27T12:00:00.000Z")
    );

    expect(plan).toEqual({
      action: "skip",
      due: false,
      reason: "one-time-run-exists"
    });
  });

  it("computes the next recurring due time after the current run is due", () => {
    const nextRun = getNextRecurringRunDate(
      {
        type: "recurring",
        frequency: "daily",
        time: "09:00",
        timeZone: "America/New_York"
      },
      new Date("2026-03-26T13:01:00.000Z")
    );

    expect(nextRun.toISOString()).toBe("2026-03-27T13:00:00.000Z");
  });

  it("does not create a duplicate run while an active run exists", () => {
    const plan = planScheduledCampaignRun(
      {
        status: "SCHEDULED",
        scheduleType: "recurring",
        scheduleConfig: {
          type: "recurring",
          frequency: "daily",
          time: "09:00",
          timeZone: "America/New_York"
        },
        runs: [
          {
            status: "QUEUED",
            scheduledFor: new Date("2026-03-26T13:00:00.000Z")
          }
        ]
      },
      new Date("2026-03-26T13:01:00.000Z")
    );

    expect(plan).toEqual({
      action: "skip",
      due: true,
      reason: "active-run"
    });
  });
});
