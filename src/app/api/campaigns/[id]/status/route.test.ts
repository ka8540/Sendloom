import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getCampaignStatus: vi.fn(),
  getOwnedCampaignReference: vi.fn(),
  processUserCampaignWork: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser
}));

vi.mock("@/services/campaigns", () => ({
  getCampaignStatus: mocks.getCampaignStatus,
  getOwnedCampaignReference: mocks.getOwnedCampaignReference,
  processUserCampaignWork: mocks.processUserCampaignWork
}));

import { GET } from "@/app/api/campaigns/[id]/status/route";

describe("campaign status route", () => {
  beforeEach(() => {
    mocks.requireApiUser.mockReset();
    mocks.getCampaignStatus.mockReset();
    mocks.getOwnedCampaignReference.mockReset();
    mocks.processUserCampaignWork.mockReset();
    mocks.requireApiUser.mockResolvedValue({
      user: {
        id: "user_b",
        email: "user-b@example.com"
      }
    });
  });

  it("does not process a campaign before ownership is confirmed", async () => {
    mocks.getOwnedCampaignReference.mockResolvedValue(null);

    const response = await GET(new Request("https://app.example.com/api/campaigns/campaign_a/status"), {
      params: Promise.resolve({ id: "campaign_a" })
    });

    expect(response.status).toBe(404);
    expect(mocks.processUserCampaignWork).not.toHaveBeenCalled();
    expect(mocks.getCampaignStatus).not.toHaveBeenCalled();
  });
});
