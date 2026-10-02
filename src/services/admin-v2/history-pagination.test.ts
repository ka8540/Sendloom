import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  broadcastCount: vi.fn(),
  broadcastGroupBy: vi.fn(),
  broadcastFindMany: vi.fn(),
  broadcastRecipientGroupBy: vi.fn(),
  noticeCount: vi.fn(),
  noticeGroupBy: vi.fn(),
  noticeFindMany: vi.fn(),
  noticeRecipientGroupBy: vi.fn(),
  userCount: vi.fn(),
  raw: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    productUpdateBroadcast: {
      count: mock.broadcastCount,
      groupBy: mock.broadcastGroupBy,
      findMany: mock.broadcastFindMany,
    },
    productUpdateBroadcastRecipient: {
      groupBy: mock.broadcastRecipientGroupBy,
    },
    systemNotice: {
      count: mock.noticeCount,
      groupBy: mock.noticeGroupBy,
      findMany: mock.noticeFindMany,
    },
    systemNoticeRecipient: { groupBy: mock.noticeRecipientGroupBy },
    user: { count: mock.userCount },
    $queryRaw: mock.raw,
  },
}));

import { listProductUpdateBroadcasts } from "@/services/product-update-broadcasts";
import { listSystemNotices } from "@/services/system-notices";

beforeEach(() => {
  vi.clearAllMocks();
  mock.userCount.mockResolvedValue(9);
  mock.broadcastCount.mockResolvedValueOnce(43).mockResolvedValueOnce(2);
  mock.noticeCount.mockResolvedValueOnce(43).mockResolvedValueOnce(2);
  mock.broadcastGroupBy.mockResolvedValue([
    { status: "SCHEDULED", _count: { _all: 25 } },
    { status: "COMPLETED", _count: { _all: 40 } },
  ]);
  mock.noticeGroupBy.mockResolvedValue([
    { status: "SENDING", _count: { _all: 25 } },
    { status: "COMPLETED", _count: { _all: 40 } },
  ]);
  mock.broadcastFindMany.mockResolvedValue([]);
  mock.noticeFindMany.mockResolvedValue([]);
  mock.broadcastRecipientGroupBy.mockResolvedValue([]);
  mock.noticeRecipientGroupBy.mockResolvedValue([]);
});

describe("Communications history pagination", () => {
  it("uses bounded active and history pages for product updates", async () => {
    const result = await listProductUpdateBroadcasts(3, 2);
    expect(result.pagination).toEqual({ page: 3, pageSize: 20, count: 43 });
    expect(result.activePagination).toEqual({
      page: 2,
      pageSize: 20,
      count: 25,
    });
    expect(result.summary.completed).toBe(40);
    expect(result.summary.attention).toBe(2);
    expect(mock.broadcastFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20 }),
    );
    expect(mock.broadcastFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });
  it("clamps system notice pages and preserves total summary counts", async () => {
    const result = await listSystemNotices(999, 999);
    expect(result.pagination.page).toBe(3);
    expect(result.activePagination.page).toBe(2);
    expect(result.summary.completed).toBe(40);
    expect(mock.noticeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20 }),
    );
  });
});
