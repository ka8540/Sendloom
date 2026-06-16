import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SenderWindowInput } from "@/services/overview-analytics";
import type { DailySendWindow } from "@/lib/daily-send-limit";

const prismaMock = vi.hoisted(() => ({
  recipientJob: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  campaign: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
  import: { groupBy: vi.fn(), count: vi.fn() },
  hunterDomainSearch: { aggregate: vi.fn() },
  senderProfile: { findMany: vi.fn() },
  $queryRaw: vi.fn()
}));

const dailyLimitMock = vi.hoisted(() => ({
  getDailySendLimit: vi.fn(() => 450),
  getGmailDailySendWindow: vi.fn()
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/daily-send-limit", () => dailyLimitMock);

import { getOverviewAnalytics } from "@/services/overview-analytics";

function makeWindow(overrides: Partial<DailySendWindow> = {}): DailySendWindow {
  return {
    limit: 450,
    sentLast24h: 0,
    remaining: 450,
    isBlocked: false,
    ledgerAvailable: true,
    resetAt: null,
    oldestCountedSendAt: null,
    windowStart: new Date().toISOString(),
    windowEnd: new Date().toISOString(),
    ...overrides
  };
}

function makeSender(overrides: Partial<SenderWindowInput> = {}): SenderWindowInput {
  return {
    senderProfileId: "sender_1",
    senderEmail: "ops@example.com",
    senderName: "Ops",
    connected: true,
    window: makeWindow(),
    ...overrides
  };
}

/** Wire up a fully empty result set; individual tests override what they need. */
function primeEmpty() {
  prismaMock.recipientJob.groupBy.mockResolvedValue([]);
  prismaMock.recipientJob.count.mockResolvedValue(0);
  prismaMock.recipientJob.findMany.mockResolvedValue([]);
  prismaMock.campaign.findMany.mockResolvedValue([]);
  prismaMock.campaign.groupBy.mockResolvedValue([]);
  prismaMock.campaign.count.mockResolvedValue(0);
  prismaMock.import.groupBy.mockResolvedValue([]);
  prismaMock.import.count.mockResolvedValue(0);
  prismaMock.hunterDomainSearch.aggregate.mockResolvedValue({ _count: 0, _sum: { resultCount: null } });
  prismaMock.senderProfile.findMany.mockResolvedValue([]);
  prismaMock.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join("");
    if (sql.includes("date_trunc")) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  primeEmpty();
});

describe("getOverviewAnalytics", () => {
  it("returns a safe, zeroed payload for an account with no data", async () => {
    const result = await getOverviewAnalytics({ userId: "user_1", window: "30d", senderWindows: [] });

    expect(result.isEmpty).toBe(true);
    expect(result.performance.audience).toBe(0);
    expect(result.performance.completionRate).toBeNull();
    expect(result.performance.kpis.every((kpi) => kpi.value === 0)).toBe(true);
    expect(result.funnel.every((stage) => stage.value === 0)).toBe(true);
    expect(result.failures.total).toBe(0);
    expect(result.templates).toEqual([]);
    expect(result.heatmap.days).toHaveLength(30);
    expect(result.heatmap.total).toBe(0);
  });

  it("scopes every aggregate query to the requested user", async () => {
    await getOverviewAnalytics({ userId: "user_42", window: "all", senderWindows: [] });

    const runScopedWhere = prismaMock.recipientJob.groupBy.mock.calls[0][0].where;
    expect(runScopedWhere.campaignRun.campaign.userId).toBe("user_42");

    const campaignWhere = prismaMock.campaign.findMany.mock.calls[0][0].where;
    expect(campaignWhere.userId).toBe("user_42");

    const importWhere = prismaMock.import.groupBy.mock.calls[0][0].where;
    expect(importWhere.userId).toBe("user_42");
  });

  it("derives delivery buckets directly from recipient job statuses", async () => {
    prismaMock.recipientJob.groupBy.mockResolvedValueOnce([
      { status: "SENT", _count: 50 },
      { status: "OPENED", _count: 20 },
      { status: "CLICKED", _count: 5 },
      { status: "PENDING", _count: 10 },
      { status: "RETRYING", _count: 3 },
      { status: "FAILED", _count: 4 },
      { status: "INVALID", _count: 2 },
      { status: "BOUNCED", _count: 1 },
      { status: "SUPPRESSED", _count: 6 }
    ]);
    prismaMock.recipientJob.count.mockResolvedValueOnce(12); // replied

    const result = await getOverviewAnalytics({ userId: "user_1", window: "all", senderWindows: [] });

    const kpi = (key: string) => result.performance.kpis.find((entry) => entry.key === key)!;
    expect(result.performance.audience).toBe(101);
    expect(kpi("delivered").value).toBe(75); // SENT + OPENED + CLICKED
    expect(kpi("opened").value).toBe(25); // OPENED + CLICKED
    expect(kpi("replied").value).toBe(12);
    expect(kpi("attention").value).toBe(7); // FAILED + INVALID + BOUNCED + COMPLAINED
    expect(result.performance.completionRate).toBe(87); // (101 - 13 queued) / 101

    const sentStage = result.funnel.find((stage) => stage.key === "sent")!;
    expect(sentStage.value).toBe(75);
  });

  it("applies the time window to queries and timeline length", async () => {
    const sevenDay = await getOverviewAnalytics({ userId: "user_1", window: "7d", senderWindows: [] });
    const runWhere7d = prismaMock.recipientJob.groupBy.mock.calls[0][0].where;
    expect(runWhere7d.campaignRun.createdAt.gte).toBeInstanceOf(Date);
    expect(sevenDay.timeline.points).toHaveLength(7);

    vi.clearAllMocks();
    primeEmpty();

    const allTime = await getOverviewAnalytics({ userId: "user_1", window: "all", senderWindows: [] });
    const runWhereAll = prismaMock.recipientJob.groupBy.mock.calls[0][0].where;
    expect(runWhereAll.campaignRun.createdAt).toBeUndefined();
    expect(allTime.timeline.points).toHaveLength(30);
  });

  it("never exposes sender oauth tokens and derives only a connected flag", async () => {
    prismaMock.senderProfile.findMany.mockResolvedValueOnce([
      { id: "sender_1", fromEmail: "ops@example.com", name: "Ops", oauthRefreshToken: "super-secret-token" }
    ]);
    dailyLimitMock.getGmailDailySendWindow.mockResolvedValueOnce(
      makeWindow({ sentLast24h: 400, remaining: 50 })
    );

    // No senderWindows passed -> exercises the token-reading code path.
    const result = await getOverviewAnalytics({ userId: "user_1", window: "all" });

    expect(result.senders).toHaveLength(1);
    const sender = result.senders[0];
    expect(sender.connected).toBe(true);
    expect(sender.sent24h).toBe(400);
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
    expect(sender).not.toHaveProperty("oauthRefreshToken");
  });

  it("groups failures into retryable vs permanent categories without leaking error text", async () => {
    prismaMock.recipientJob.groupBy.mockResolvedValueOnce([
      { status: "FAILED", _count: 4 },
      { status: "RETRYING", _count: 3 },
      { status: "INVALID", _count: 2 },
      { status: "BOUNCED", _count: 1 }
    ]);
    prismaMock.recipientJob.findMany.mockResolvedValueOnce([
      { lastError: "Rate limit exceeded for user", updatedAt: new Date("2026-06-14T10:00:00Z") },
      { lastError: "Invalid recipient address 550", updatedAt: new Date("2026-06-13T10:00:00Z") },
      { lastError: "OAuth token has expired", updatedAt: new Date("2026-06-12T10:00:00Z") },
      { lastError: null, updatedAt: new Date("2026-06-11T10:00:00Z") }
    ]);

    const result = await getOverviewAnalytics({ userId: "user_1", window: "all", senderWindows: [] });

    expect(result.failures.retryable).toBe(3); // RETRYING
    expect(result.failures.permanent).toBe(7); // FAILED + INVALID + BOUNCED + COMPLAINED
    expect(result.failures.total).toBe(10);
    expect(result.failures.lastFailureAt).toBe(new Date("2026-06-14T10:00:00Z").toISOString());

    const byKey = (key: string) => result.failures.categories.find((category) => category.key === key);
    expect(byKey("throttled")?.value).toBe(1);
    expect(byKey("sender")?.value).toBe(1);
    expect(byKey("recipient")?.value).toBe(3); // INVALID + BOUNCED

    // Raw provider error strings must never reach the client payload.
    expect(JSON.stringify(result)).not.toContain("Rate limit exceeded");
    expect(JSON.stringify(result)).not.toContain("OAuth token has expired");
  });
});
