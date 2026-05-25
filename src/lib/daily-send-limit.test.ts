import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { sendLedgerMock, recipientJobMock, redisEvalMock, redisZremMock } = vi.hoisted(() => ({
  sendLedgerMock: {
    findMany: vi.fn()
  },
  recipientJobMock: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn()
  },
  redisEvalMock: vi.fn(),
  redisZremMock: vi.fn()
}));

vi.mock("@/lib/env", () => ({
  env: {
    GMAIL_DAILY_SEND_SAFETY_LIMIT: 3
  }
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    sendLedger: sendLedgerMock,
    recipientJob: recipientJobMock
  }
}));

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    eval: redisEvalMock,
    zrem: redisZremMock
  })
}));

import {
  getGmailDailySendWindow,
  reserveSendCapacity,
  ROLLING_WINDOW_MS
} from "@/lib/daily-send-limit";

const SCOPE = { userId: "user_1", senderProfileId: "sender_1" };

type MockLedgerEntry = { sentAt: Date; messageId: string | null; recipientJobId: string | null };

function ledgerEntries(count: number, oldest = new Date()): MockLedgerEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    sentAt: index === 0 ? oldest : new Date(oldest.getTime() + index * 1000),
    messageId: `message_${index}`,
    recipientJobId: `job_${index}`
  }));
}

function mockDbCount({
  ledger = [],
  successfulLedgerRecipientJobIds,
  legacyCount = 0,
  legacyOldest = null
}: {
  ledger?: MockLedgerEntry[];
  successfulLedgerRecipientJobIds?: string[];
  legacyCount?: number;
  legacyOldest?: Date | null;
}) {
  const defaultSuccessfulLedgerRecipientJobIds = ledger
    .map((entry) => entry.recipientJobId)
    .filter((recipientJobId): recipientJobId is string => Boolean(recipientJobId));
  sendLedgerMock.findMany.mockResolvedValueOnce(ledger);
  if (defaultSuccessfulLedgerRecipientJobIds.length > 0) {
    recipientJobMock.findMany.mockResolvedValueOnce(
      (successfulLedgerRecipientJobIds ?? defaultSuccessfulLedgerRecipientJobIds).map((id) => ({ id }))
    );
  }
  recipientJobMock.count.mockResolvedValueOnce(legacyCount);
  recipientJobMock.findFirst.mockResolvedValueOnce(legacyOldest ? { updatedAt: legacyOldest } : null);
}

function missingSendLedgerError() {
  return new Prisma.PrismaClientKnownRequestError("The table `public.SendLedger` does not exist.", {
    code: "P2021",
    clientVersion: "test",
    meta: { table: "public.SendLedger" }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGmailDailySendWindow", () => {
  it("reports zero sends and is not blocked when nothing was sent recently", async () => {
    mockDbCount({});

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window).toMatchObject({
      limit: 3,
      sentLast24h: 0,
      remaining: 3,
      isBlocked: false,
      resetAt: null,
      oldestCountedSendAt: null
    });
  });

  it("is not blocked at limit - 1 and reports remaining correctly", async () => {
    mockDbCount({ ledger: ledgerEntries(2) });

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window.sentLast24h).toBe(2);
    expect(window.remaining).toBe(1);
    expect(window.isBlocked).toBe(false);
    expect(window.resetAt).toBeNull();
  });

  it("blocks at exactly the limit and resetAt = oldest send + 24h", async () => {
    const oldest = new Date("2026-05-24T02:00:00.000Z");
    mockDbCount({ ledger: ledgerEntries(3, oldest) });

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window.isBlocked).toBe(true);
    expect(window.remaining).toBe(0);
    expect(window.resetAt).toBe(new Date(oldest.getTime() + ROLLING_WINDOW_MS).toISOString());
  });

  it("blocks when over the limit (legacy/imported state)", async () => {
    const oldest = new Date("2026-05-24T01:30:00.000Z");
    mockDbCount({ ledger: ledgerEntries(99, oldest) });

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window.isBlocked).toBe(true);
    expect(window.remaining).toBe(0);
    expect(window.resetAt).toBe(new Date(oldest.getTime() + ROLLING_WINDOW_MS).toISOString());
  });

  it("scopes by sender profile when provided", async () => {
    mockDbCount({});

    await getGmailDailySendWindow({ userId: "u", senderProfileId: "sender_xyz" });

    const callArgs = sendLedgerMock.findMany.mock.calls[0]?.[0];
    expect(callArgs.where.senderProfileId).toBe("sender_xyz");
    expect(callArgs.where.userId).toBeUndefined();
    const legacyCallArgs = recipientJobMock.count.mock.calls[0]?.[0];
    expect(legacyCallArgs.where.campaignRun.campaign.senderProfileId).toBe("sender_xyz");
    expect(legacyCallArgs.where.campaignRun.campaign.userId).toBeUndefined();
  });

  it("falls back to user scope when no sender profile is given", async () => {
    mockDbCount({});

    await getGmailDailySendWindow({ userId: "u_only" });

    const callArgs = sendLedgerMock.findMany.mock.calls[0]?.[0];
    expect(callArgs.where.userId).toBe("u_only");
    expect(callArgs.where.senderProfileId).toBeUndefined();
    const legacyCallArgs = recipientJobMock.count.mock.calls[0]?.[0];
    expect(legacyCallArgs.where.campaignRun.campaign.userId).toBe("u_only");
    expect(legacyCallArgs.where.campaignRun.campaign.senderProfileId).toBeUndefined();
  });

  it("combines successful ledger rows with legacy sent jobs that are not already in the ledger", async () => {
    const ledgerOldest = new Date("2026-05-24T03:00:00.000Z");
    const legacyOldest = new Date("2026-05-24T02:00:00.000Z");
    mockDbCount({
      ledger: ledgerEntries(2, ledgerOldest),
      legacyCount: 1,
      legacyOldest
    });

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window.sentLast24h).toBe(3);
    expect(window.isBlocked).toBe(true);
    expect(window.oldestCountedSendAt).toBe(legacyOldest.toISOString());
    const legacyCallArgs = recipientJobMock.count.mock.calls[0]?.[0];
    expect(legacyCallArgs.where.id.notIn).toEqual(["job_0", "job_1"]);
    expect(legacyCallArgs.where.status.in).toEqual(["SENT", "OPENED", "CLICKED"]);
    expect(legacyCallArgs.where.providerMessageId).toEqual({ not: null });
  });

  it("discounts ledger rows for recipient jobs that are not currently successful", async () => {
    const oldest = new Date("2026-05-24T02:00:00.000Z");
    mockDbCount({
      ledger: ledgerEntries(3, oldest),
      successfulLedgerRecipientJobIds: ["job_1"]
    });

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window.sentLast24h).toBe(1);
    expect(window.remaining).toBe(2);
    expect(window.isBlocked).toBe(false);
    expect(window.oldestCountedSendAt).toBe(new Date(oldest.getTime() + 1000).toISOString());
    const ledgerStatusArgs = recipientJobMock.findMany.mock.calls[0]?.[0];
    expect(ledgerStatusArgs.where.id.in).toEqual(["job_0", "job_1", "job_2"]);
    expect(ledgerStatusArgs.where.status.in).toEqual(["SENT", "OPENED", "CLICKED"]);
  });

  it("discounts ledger rows without a Gmail message id", async () => {
    const oldest = new Date("2026-05-24T02:00:00.000Z");
    const ledger = ledgerEntries(2, oldest);
    ledger[0].messageId = null;
    mockDbCount({ ledger });

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window.sentLast24h).toBe(1);
    expect(window.oldestCountedSendAt).toBe(new Date(oldest.getTime() + 1000).toISOString());
  });

  it("returns a ledger-unavailable window instead of throwing when the table is missing", async () => {
    sendLedgerMock.findMany.mockRejectedValueOnce(missingSendLedgerError());

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window).toMatchObject({
      ledgerAvailable: false,
      sentLast24h: 0,
      remaining: 0,
      isBlocked: false,
      resetAt: null,
      oldestCountedSendAt: null
    });
    expect(recipientJobMock.count).not.toHaveBeenCalled();
  });
});

describe("reserveSendCapacity", () => {
  it("denies when the DB count already meets the limit", async () => {
    const oldest = new Date();
    mockDbCount({ ledger: ledgerEntries(3, oldest) });

    const result = await reserveSendCapacity(SCOPE);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.window.isBlocked).toBe(true);
    }
    expect(redisEvalMock).not.toHaveBeenCalled();
  });

  it("calls the Lua reservation script when under the limit and returns allowed", async () => {
    mockDbCount({ ledger: ledgerEntries(1) });
    redisEvalMock.mockResolvedValueOnce([1, 2]);

    const result = await reserveSendCapacity(SCOPE);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.remaining).toBe(1);
      expect(result.reservationId).toMatch(/^r:\d+:/);
    }
    expect(redisEvalMock).toHaveBeenCalledTimes(1);
  });

  it("denies when Redis says the combined reservations + DB count would exceed the limit", async () => {
    mockDbCount({ ledger: ledgerEntries(2) });
    // Redis sees an in-flight reservation pushing us to the cap.
    redisEvalMock.mockResolvedValueOnce([0, 3]);
    // Helper re-reads the DB count to build the refreshed window.
    mockDbCount({ ledger: ledgerEntries(2) });

    const result = await reserveSendCapacity(SCOPE);

    expect(result.allowed).toBe(false);
  });

  it("treats an unaddressable scope (no user/sender) as a no-op pass", async () => {
    const result = await reserveSendCapacity({});
    expect(result.allowed).toBe(true);
    expect(sendLedgerMock.findMany).not.toHaveBeenCalled();
    expect(redisEvalMock).not.toHaveBeenCalled();
  });

  it("denies reservations without hitting Redis when the send ledger table is missing", async () => {
    sendLedgerMock.findMany.mockRejectedValueOnce(missingSendLedgerError());

    const result = await reserveSendCapacity(SCOPE);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.window.ledgerAvailable).toBe(false);
    }
    expect(redisEvalMock).not.toHaveBeenCalled();
  });
});
