import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  userCount: vi.fn(),
  userFindMany: vi.fn(),
  runGroupBy: vi.fn(),
  runCount: vi.fn(),
  rawQuery: vi.fn(),
  jobCount: vi.fn(),
  ledgerCount: vi.fn(),
  senderCount: vi.fn(),
  runFindMany: vi.fn(),
  searchCount: vi.fn(),
  allocationCount: vi.fn(),
  expansionCount: vi.fn(),
  expansionGroupBy: vi.fn(),
  searchFindMany: vi.fn(),
  batchGroupBy: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { count: mock.userCount, findMany: mock.userFindMany },
    campaignRun: {
      groupBy: mock.runGroupBy,
      count: mock.runCount,
      findMany: mock.runFindMany,
    },
    recipientJob: { count: mock.jobCount },
    sendLedger: { count: mock.ledgerCount },
    senderProfile: { count: mock.senderCount },
    prospectSearch: { count: mock.searchCount, findMany: mock.searchFindMany },
    $queryRaw: mock.rawQuery,
    prospectSearchPerson: { count: mock.allocationCount },
    discoverSearchExpansion: {
      count: mock.expansionCount,
      groupBy: mock.expansionGroupBy,
    },
    discoverProviderBatch: { groupBy: mock.batchGroupBy },
  },
}));
import { listUsersWorkspace } from "./users";
import { getSendingOperations, getDiscoverOperations } from "./operations";

beforeEach(() => {
  vi.clearAllMocks();
  mock.userCount.mockResolvedValue(0);
  mock.userFindMany.mockResolvedValue([]);
  mock.runGroupBy.mockResolvedValue([]);
  mock.runCount.mockResolvedValue(0);
  mock.rawQuery.mockResolvedValue([]);
  mock.jobCount.mockResolvedValue(0);
  mock.ledgerCount.mockResolvedValue(0);
  mock.senderCount.mockResolvedValue(0);
  mock.runFindMany.mockResolvedValue([]);
  mock.searchCount.mockResolvedValue(0);
  mock.allocationCount.mockResolvedValue(0);
  mock.expansionCount.mockResolvedValue(0);
  mock.expansionGroupBy.mockResolvedValue([]);
  mock.searchFindMany.mockResolvedValue([]);
  mock.batchGroupBy.mockResolvedValue([]);
});

describe("Admin workspace data services", () => {
  it("searches and paginates restricted users on the server", async () => {
    mock.userCount.mockResolvedValue(51);
    const result = await listUsersWorkspace({
      status: "restricted",
      query: "case@example.com",
      page: 3,
    });
    expect(mock.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        where: {
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([{ restrictedAt: { not: null } }]),
            }),
            {
              OR: [
                {
                  email: { contains: "case@example.com", mode: "insensitive" },
                },
                { id: "case@example.com" },
              ],
            },
          ],
        },
      }),
    );
    expect(result.page).toBe(3);
    expect(result.pages).toBe(3);
    expect(result.count).toBe(51);
  });
  it("clamps empty and out-of-range user pages before querying rows", async () => {
    const result = await listUsersWorkspace({
      status: "all",
      query: "",
      page: 999,
    });
    expect(result.page).toBe(1);
    expect(result.count).toBe(0);
    expect(mock.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });
  it("aggregates sending signals without selecting recipient content", async () => {
    mock.ledgerCount.mockResolvedValue(12);
    mock.runGroupBy.mockResolvedValue([
      { status: "RUNNING", _count: { _all: 2 } },
    ]);
    const result = await getSendingOperations();
    expect(result.confirmedSends).toBe(12);
    expect(result.states).toEqual([{ status: "RUNNING", count: 2 }]);
    expect(mock.runFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 0 }),
    );
    expect(mock.jobCount).toHaveBeenCalledTimes(2);
  });
  it("returns empty Discover operations safely with bounded failure history", async () => {
    const result = await getDiscoverOperations();
    expect(result.failures).toBe(0);
    expect(result.providers).toEqual([]);
    expect(mock.searchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 0,
        select: { id: true, errorCode: true, updatedAt: true },
      }),
    );
  });
});
