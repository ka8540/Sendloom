import { describe, expect, it } from "vitest";

import { calculateCampaignHealth, isCampaignStuck } from "@/lib/campaign-health";

describe("campaign health", () => {
  it("detects stuck campaigns with pending work and stale activity", () => {
    expect(
      isCampaignStuck({
        campaignStatus: "RUNNING",
        runStatus: "RUNNING",
        pendingRecipients: 3,
        lastActivityAt: new Date("2026-05-15T11:35:00.000Z"),
        now: new Date("2026-05-15T12:00:00.000Z")
      })
    ).toBe(true);
  });

  it("prioritizes blocked, stuck, and failed health states", () => {
    expect(
      calculateCampaignHealth({
        campaignStatus: "VALIDATED",
        runStatus: null,
        pendingRecipients: 0,
        failedRecipients: 0,
        invalidRecipients: 0,
        suppressedRecipients: 0,
        retryableFailureCount: 0,
        validationSummary: {
          blockers: 1,
          errors: 0,
          warnings: 0,
          info: 0
        }
      }).status
    ).toBe("BLOCKED");

    expect(
      calculateCampaignHealth({
        campaignStatus: "RUNNING",
        runStatus: "RUNNING",
        pendingRecipients: 1,
        failedRecipients: 0,
        invalidRecipients: 0,
        suppressedRecipients: 0,
        retryableFailureCount: 0,
        lastActivityAt: new Date("2026-05-15T11:35:00.000Z"),
        now: new Date("2026-05-15T12:00:00.000Z")
      }).status
    ).toBe("STUCK");

    expect(
      calculateCampaignHealth({
        campaignStatus: "FAILED",
        runStatus: "FAILED",
        pendingRecipients: 0,
        failedRecipients: 0,
        invalidRecipients: 0,
        suppressedRecipients: 0,
        retryableFailureCount: 0
      }).status
    ).toBe("FAILED");
  });
});
