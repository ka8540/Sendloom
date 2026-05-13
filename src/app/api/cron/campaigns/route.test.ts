import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    CRON_SECRET: undefined as string | undefined
  },
  processTrustedCampaignWork: vi.fn(),
  syncConnectedSenderReplies: vi.fn()
}));

vi.mock("@/lib/env", () => ({
  env: mocks.env
}));

vi.mock("@/services/campaigns", () => ({
  processTrustedCampaignWork: mocks.processTrustedCampaignWork
}));

vi.mock("@/services/replies", () => ({
  syncConnectedSenderReplies: mocks.syncConnectedSenderReplies
}));

import { GET } from "@/app/api/cron/campaigns/route";

describe("campaign cron route", () => {
  beforeEach(() => {
    mocks.env.CRON_SECRET = undefined;
    mocks.processTrustedCampaignWork.mockReset();
    mocks.syncConnectedSenderReplies.mockReset();
    mocks.processTrustedCampaignWork.mockResolvedValue({
      dueCampaignsFound: 0,
      runsCreated: 0,
      scheduledCampaignsScanned: 0,
      schedulingLockSkipped: false,
      runsProcessed: 0,
      recipientJobsProcessed: 0,
      hasRemainingWork: false,
      errors: []
    });
    mocks.syncConnectedSenderReplies.mockResolvedValue({
      repliesStored: 0,
      sendersChecked: 0,
      sendersFailed: 0
    });
  });

  it("rejects cron requests when no secret is configured", async () => {
    const response = await GET(new Request("https://app.example.com/api/cron/campaigns"));

    expect(response.status).toBe(401);
    expect(mocks.processTrustedCampaignWork).not.toHaveBeenCalled();
  });

  it("rejects cron requests with the wrong secret", async () => {
    mocks.env.CRON_SECRET = "correct-secret";

    const response = await GET(
      new Request("https://app.example.com/api/cron/campaigns", {
        headers: {
          authorization: "Bearer wrong-secret"
        }
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.processTrustedCampaignWork).not.toHaveBeenCalled();
  });

  it("runs trusted processing with the correct secret", async () => {
    mocks.env.CRON_SECRET = "correct-secret";

    const response = await GET(
      new Request("https://app.example.com/api/cron/campaigns", {
        headers: {
          authorization: "Bearer correct-secret"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.processTrustedCampaignWork).toHaveBeenCalledWith({
      maxDurationMs: 55_000
    });
  });
});
