import { describe, expect, it } from "vitest";

import { canEditCampaignSchedule } from "@/lib/campaign-schedule-edit";

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
