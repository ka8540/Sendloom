import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ count: vi.fn(), raw: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { count: mock.count },
    prospectSearch: { count: mock.count },
    prospectSearchPerson: { count: mock.count },
    discoverSearchExpansion: { count: mock.count },
    template: { count: mock.count },
    import: { count: mock.count },
    campaignRun: { count: mock.count },
    recipientJob: { count: mock.count },
    senderProfile: { count: mock.count },
    discoverProviderBatch: { count: mock.count },
    inboundReply: { count: mock.count },
    $queryRaw: mock.raw,
  },
}));

import { getAdminAnalytics } from "./analytics";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  mock.count.mockResolvedValue(0);
  mock.raw.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Admin analytics aggregation", () => {
  it.each([7, 30, 90] as const)(
    "returns %i complete UTC days with honest empty metrics",
    async (days) => {
      const result = await getAdminAnalytics(days);
      expect(result.trend).toHaveLength(days);
      expect(result.outreachTrend).toHaveLength(days);
      expect(result.discoverTrend).toHaveLength(days);
      expect(result.trend.at(-1)).toEqual({
        day: "2026-10-02",
        newUsers: 0,
        lastSeen: 0,
      });
      expect(result.funnel.every((row) => row.value === 0)).toBe(true);
      expect(result.adoption.every((row) => row.value === 0 && row.users === 0)).toBe(true);
    },
  );

  it("counts product users consistently and filters feature adoption to non-admins", async () => {
    await getAdminAnalytics(7);
    expect(mock.count).toHaveBeenCalledWith({ where: { isAdmin: false } });
    expect(mock.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        isAdmin: false,
        prospectSearches: { some: { createdAt: { gte: expect.any(Date) } } },
      }),
    });
    expect(mock.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        createdAt: { gte: expect.any(Date) },
        user: { isAdmin: false },
      }),
    });
  });
});
