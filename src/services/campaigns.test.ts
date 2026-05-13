import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: {
    set: vi.fn(),
    eval: vi.fn()
  },
  prisma: {
    campaignRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn()
    }
  }
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma
}));

vi.mock("@/lib/redis", () => ({
  getRedis: () => mocks.redis
}));

vi.mock("@/services/senders", () => ({
  markSenderRequiresReconnect: vi.fn()
}));

vi.mock("@/services/suppressions", () => ({
  getSuppressedEmailSet: vi.fn(),
  suppressEmail: vi.fn()
}));

import { launchCampaign, processUserCampaignWork } from "@/services/campaigns";

describe("campaign authorization boundaries", () => {
  beforeEach(() => {
    mocks.redis.set.mockReset();
    mocks.redis.eval.mockReset();
    mocks.prisma.campaignRun.findFirst.mockReset();
    mocks.prisma.campaignRun.findMany.mockReset();
    mocks.prisma.campaignRun.count.mockReset();
  });

  it("scopes the launch lock fallback active run lookup to the requesting user", async () => {
    mocks.redis.set.mockResolvedValue(null);
    mocks.prisma.campaignRun.findFirst.mockResolvedValue({
      id: "run_1"
    });

    await expect(launchCampaign("campaign_1", "user_1")).resolves.toEqual({
      id: "run_1"
    });

    expect(mocks.prisma.campaignRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaignId: "campaign_1",
          campaign: {
            userId: "user_1"
          }
        })
      })
    );
  });

  it("scopes user-triggered processing queries to the requesting user", async () => {
    mocks.prisma.campaignRun.findMany.mockResolvedValue([]);
    mocks.prisma.campaignRun.count.mockResolvedValue(0);

    await processUserCampaignWork({
      userId: "user_1",
      campaignId: "campaign_1",
      maxDurationMs: 1_000
    });

    expect(mocks.prisma.campaignRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaignId: "campaign_1",
          campaign: expect.objectContaining({
            userId: "user_1"
          })
        })
      })
    );
  });
});
