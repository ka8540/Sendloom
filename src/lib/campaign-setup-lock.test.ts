import { describe, expect, it } from "vitest";

import { isCampaignSetupLocked } from "@/lib/campaign-setup-lock";

describe("isCampaignSetupLocked", () => {
  it("locks setup while a run is queued", () => {
    expect(isCampaignSetupLocked({ campaignStatus: "SCHEDULED", latestRunStatus: "QUEUED" })).toBe(true);
  });

  it("locks launch-critical setup while a run waits for a slot", () => {
    expect(
      isCampaignSetupLocked({ campaignStatus: "WAITING_FOR_SLOT", latestRunStatus: "WAITING_FOR_SLOT" })
    ).toBe(true);
  });

  it("locks setup while a run is running", () => {
    expect(isCampaignSetupLocked({ campaignStatus: "RUNNING", latestRunStatus: "RUNNING" })).toBe(true);
  });

  it("does not lock setup for paused sequences", () => {
    expect(isCampaignSetupLocked({ campaignStatus: "PAUSED", latestRunStatus: "PAUSED" })).toBe(false);
  });

  it("does not lock setup once the latest run has finished", () => {
    expect(isCampaignSetupLocked({ campaignStatus: "COMPLETED", latestRunStatus: "COMPLETED" })).toBe(false);
  });
});
