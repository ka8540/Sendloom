import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SenderWindowInput } from "@/services/overview-analytics";
import type { DailySendWindow } from "@/lib/daily-send-limit";

const prismaMock = vi.hoisted(() => ({
  recipientJob: { groupBy: vi.fn(), findMany: vi.fn() },
  campaign: { count: vi.fn() },
  import: { count: vi.fn() }
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { getOverviewAttention } from "@/services/overview-analytics";

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
  prismaMock.recipientJob.findMany.mockResolvedValue([]);
  // campaign.count is called twice (attention, then total); import.count twice (total, mapped).
  prismaMock.campaign.count.mockResolvedValue(0);
  prismaMock.import.count.mockResolvedValue(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  primeEmpty();
});

describe("getOverviewAttention", () => {
  it("returns a safe, empty payload for an account with no data", async () => {
    const result = await getOverviewAttention({ userId: "user_1", senderWindows: [] });

    expect(result.hasData).toBe(false);
    expect(result.actions).toEqual([]);
    expect(result.failures.total).toBe(0);
    expect(result.failures.categories).toEqual([]);
    expect(result.failures.lastFailureLabel).toBeNull();
  });

  it("scopes every aggregate query to the requested user", async () => {
    await getOverviewAttention({ userId: "user_42", senderWindows: [] });

    const runScopedWhere = prismaMock.recipientJob.groupBy.mock.calls[0][0].where;
    expect(runScopedWhere.campaignRun.campaign.userId).toBe("user_42");

    for (const call of prismaMock.campaign.count.mock.calls) {
      expect(call[0].where.userId).toBe("user_42");
    }
    for (const call of prismaMock.import.count.mock.calls) {
      expect(call[0].where.userId).toBe("user_42");
    }
  });

  it("groups failures into retryable vs action-required without leaking error text", async () => {
    prismaMock.recipientJob.groupBy.mockResolvedValueOnce([
      { status: "SENT", _count: 40 },
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

    const result = await getOverviewAttention({ userId: "user_1", senderWindows: [] });

    expect(result.hasData).toBe(true);
    expect(result.failures.retryable).toBe(3); // RETRYING
    expect(result.failures.permanent).toBe(7); // FAILED + INVALID + BOUNCED + COMPLAINED
    expect(result.failures.total).toBe(10);
    expect(result.failures.lastFailureAt).toBe(new Date("2026-06-14T10:00:00Z").toISOString());

    const byKey = (key: string) => result.failures.categories.find((category) => category.key === key);
    expect(byKey("throttled")?.value).toBe(1);
    expect(byKey("sender")?.value).toBe(1);
    expect(byKey("recipient")?.value).toBe(3); // INVALID + BOUNCED

    // A "Recipients awaiting retry" action is surfaced from the RETRYING count.
    expect(result.actions.find((action) => action.key === "retry")?.count).toBe(3);

    // Raw provider error strings must never reach the client payload.
    expect(JSON.stringify(result)).not.toContain("Rate limit exceeded");
    expect(JSON.stringify(result)).not.toContain("OAuth token has expired");
  });

  it("derives sender actions from windows without ever reading tokens", async () => {
    const result = await getOverviewAttention({
      userId: "user_1",
      senderWindows: [
        makeSender({ senderProfileId: "s1", connected: false }),
        makeSender({ senderProfileId: "s2", window: makeWindow({ sentLast24h: 430, remaining: 20 }) }),
        makeSender({ senderProfileId: "s3", window: makeWindow({ isBlocked: true, remaining: 0 }) })
      ]
    });

    expect(result.actions.find((action) => action.key === "disconnected")?.count).toBe(1);
    // s2 is at ~96% of its limit and s3 is blocked -> both flagged near-capacity.
    expect(result.actions.find((action) => action.key === "senders")?.count).toBe(2);

    // Sender windows carry no token; the payload must stay token-free.
    expect(JSON.stringify(result)).not.toContain("oauthRefreshToken");
  });

  it("surfaces sequence-attention and unmapped-import actions", async () => {
    // attention campaigns, then total campaigns
    prismaMock.campaign.count.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
    // total imports, then mapped imports
    prismaMock.import.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1);

    const result = await getOverviewAttention({ userId: "user_1", senderWindows: [] });

    expect(result.actions.find((action) => action.key === "attention")?.count).toBe(2);
    expect(result.actions.find((action) => action.key === "mapping")?.count).toBe(3); // 4 - 1
    expect(result.hasData).toBe(true);
  });
});
