import { describe, expect, it } from "vitest";

import { canEditCampaignFollowUps } from "@/lib/campaign-followup-edit";

describe("canEditCampaignFollowUps", () => {
  it("allows completed sequences to edit follow-up settings", () => {
    expect(
      canEditCampaignFollowUps({
        campaignStatus: "COMPLETED",
        latestRunRecipientJobCount: 25,
        latestRunStatus: "COMPLETED"
      })
    ).toBe(true);
  });

  it("blocks actively running sequences", () => {
    expect(
      canEditCampaignFollowUps({
        campaignStatus: "RUNNING",
        latestRunRecipientJobCount: 1,
        latestRunStartedAt: new Date("2026-05-07T14:00:00.000Z"),
        latestRunStatus: "RUNNING"
      })
    ).toBe(false);
  });

  it("allows future queued sequences before recipients are created", () => {
    expect(
      canEditCampaignFollowUps({
        campaignStatus: "SCHEDULED",
        latestRunRecipientJobCount: 0,
        latestRunStartedAt: null,
        latestRunStatus: "QUEUED"
      })
    ).toBe(true);
  });

  it("blocks queued sequences once recipient processing has started", () => {
    expect(
      canEditCampaignFollowUps({
        campaignStatus: "SCHEDULED",
        latestRunRecipientJobCount: 1,
        latestRunStartedAt: null,
        latestRunStatus: "QUEUED"
      })
    ).toBe(false);
  });

  it("blocks cancelled sequences", () => {
    expect(
      canEditCampaignFollowUps({
        campaignStatus: "CANCELLED",
        latestRunStatus: "CANCELLED"
      })
    ).toBe(false);
  });
});
