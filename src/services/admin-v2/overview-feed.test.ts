import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  count: vi.fn(),
  userCount: vi.fn(),
  userFindMany: vi.fn(),
  auditCount: vi.fn(),
  auditFindMany: vi.fn(),
  incidentFindMany: vi.fn(),
  groupBy: vi.fn(),
  raw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { count: mock.userCount, findMany: mock.userFindMany },
    auditLog: { count: mock.auditCount, findMany: mock.auditFindMany },
    incidentReport: { count: mock.count, findMany: mock.incidentFindMany },
    sendLedger: { count: mock.count },
    campaignRun: { count: mock.count, groupBy: mock.groupBy },
    systemNotice: { count: mock.count, groupBy: mock.groupBy },
    productUpdateBroadcast: { count: mock.count, groupBy: mock.groupBy },
    $queryRaw: mock.raw,
  },
}));
vi.mock("@/lib/system-health", () => ({
  getSystemHealth: vi.fn(async () => ({
    timestamp: "2026-10-02T12:00:00Z",
    checks: { database: { status: "ok", message: "Available" } },
  })),
}));

import { getAdminOverview } from "./overview";
import { formatAdminEventTitle } from "@/components/admin-v2/format";

beforeEach(() => {
  vi.clearAllMocks();
  mock.userCount.mockResolvedValueOnce(12).mockResolvedValueOnce(0);
  mock.auditCount.mockResolvedValue(11);
  mock.count.mockResolvedValue(0);
  mock.userFindMany.mockResolvedValue([]);
  mock.auditFindMany.mockResolvedValue([]);
  mock.incidentFindMany.mockResolvedValue([]);
  mock.groupBy.mockResolvedValue([]);
  mock.raw.mockResolvedValue([]);
});

describe("Admin Overview recent lists", () => {
  it("fetches five rows per list and clamps out-of-range URL pages", async () => {
    const result = await getAdminOverview({
      activityPage: 99,
      accountsPage: 99,
    });
    expect(result.recentAdminPagination).toEqual({
      page: 3,
      pageSize: 5,
      count: 11,
    });
    expect(result.recentAccountsPagination).toEqual({
      page: 3,
      pageSize: 5,
      count: 12,
    });
    expect(mock.auditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 5,
        where: { category: "ADMIN" },
      }),
    );
    expect(mock.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 5 }),
    );
  });

  it("turns raw event codes into readable titles while keeping descriptive messages", () => {
    expect(
      formatAdminEventTitle(null, "product_update.send_now_requested"),
    ).toBe("Product update send now requested");
    expect(
      formatAdminEventTitle("product_update.created", "product_update.created"),
    ).toBe("Product update created");
    expect(
      formatAdminEventTitle("Wiped all account data.", "account.wiped"),
    ).toBe("Wiped all account data.");
  });
});
