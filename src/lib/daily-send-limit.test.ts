import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { sendLedgerMock, redisEvalMock, redisZremMock } = vi.hoisted(() => ({
  sendLedgerMock: {
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
    sendLedger: sendLedgerMock
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
    sendLedgerMock.count.mockResolvedValueOnce(0);
    sendLedgerMock.findFirst.mockResolvedValueOnce(null);

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
    sendLedgerMock.count.mockResolvedValueOnce(2);
    sendLedgerMock.findFirst.mockResolvedValueOnce({ sentAt: new Date() });

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window.sentLast24h).toBe(2);
    expect(window.remaining).toBe(1);
    expect(window.isBlocked).toBe(false);
    expect(window.resetAt).toBeNull();
  });

  it("blocks at exactly the limit and resetAt = oldest send + 24h", async () => {
    const oldest = new Date("2026-05-24T02:00:00.000Z");
    sendLedgerMock.count.mockResolvedValueOnce(3);
    sendLedgerMock.findFirst.mockResolvedValueOnce({ sentAt: oldest });

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window.isBlocked).toBe(true);
    expect(window.remaining).toBe(0);
    expect(window.resetAt).toBe(new Date(oldest.getTime() + ROLLING_WINDOW_MS).toISOString());
  });

  it("blocks when over the limit (legacy/imported state)", async () => {
    const oldest = new Date("2026-05-24T01:30:00.000Z");
    sendLedgerMock.count.mockResolvedValueOnce(99);
    sendLedgerMock.findFirst.mockResolvedValueOnce({ sentAt: oldest });

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window.isBlocked).toBe(true);
    expect(window.remaining).toBe(0);
    expect(window.resetAt).toBe(new Date(oldest.getTime() + ROLLING_WINDOW_MS).toISOString());
  });

  it("scopes by sender profile when provided", async () => {
    sendLedgerMock.count.mockResolvedValueOnce(0);
    sendLedgerMock.findFirst.mockResolvedValueOnce(null);

    await getGmailDailySendWindow({ userId: "u", senderProfileId: "sender_xyz" });

    const callArgs = sendLedgerMock.count.mock.calls[0]?.[0];
    expect(callArgs.where.senderProfileId).toBe("sender_xyz");
    expect(callArgs.where.userId).toBeUndefined();
  });

  it("falls back to user scope when no sender profile is given", async () => {
    sendLedgerMock.count.mockResolvedValueOnce(0);
    sendLedgerMock.findFirst.mockResolvedValueOnce(null);

    await getGmailDailySendWindow({ userId: "u_only" });

    const callArgs = sendLedgerMock.count.mock.calls[0]?.[0];
    expect(callArgs.where.userId).toBe("u_only");
    expect(callArgs.where.senderProfileId).toBeUndefined();
  });

  it("returns a ledger-unavailable window instead of throwing when the table is missing", async () => {
    sendLedgerMock.count.mockRejectedValueOnce(missingSendLedgerError());
    sendLedgerMock.findFirst.mockRejectedValueOnce(missingSendLedgerError());

    const window = await getGmailDailySendWindow(SCOPE);

    expect(window).toMatchObject({
      ledgerAvailable: false,
      sentLast24h: 0,
      remaining: 0,
      isBlocked: false,
      resetAt: null,
      oldestCountedSendAt: null
    });
  });
});

describe("reserveSendCapacity", () => {
  it("denies when the DB count already meets the limit", async () => {
    const oldest = new Date();
    sendLedgerMock.count.mockResolvedValueOnce(3);
    sendLedgerMock.findFirst.mockResolvedValueOnce({ sentAt: oldest });

    const result = await reserveSendCapacity(SCOPE);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.window.isBlocked).toBe(true);
    }
    expect(redisEvalMock).not.toHaveBeenCalled();
  });

  it("calls the Lua reservation script when under the limit and returns allowed", async () => {
    sendLedgerMock.count.mockResolvedValueOnce(1);
    sendLedgerMock.findFirst.mockResolvedValueOnce({ sentAt: new Date() });
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
    sendLedgerMock.count.mockResolvedValueOnce(2);
    sendLedgerMock.findFirst.mockResolvedValueOnce({ sentAt: new Date() });
    // Redis sees an in-flight reservation pushing us to the cap.
    redisEvalMock.mockResolvedValueOnce([0, 3]);
    // Helper re-reads the DB count to build the refreshed window.
    sendLedgerMock.count.mockResolvedValueOnce(2);
    sendLedgerMock.findFirst.mockResolvedValueOnce({ sentAt: new Date() });

    const result = await reserveSendCapacity(SCOPE);

    expect(result.allowed).toBe(false);
  });

  it("treats an unaddressable scope (no user/sender) as a no-op pass", async () => {
    const result = await reserveSendCapacity({});
    expect(result.allowed).toBe(true);
    expect(sendLedgerMock.count).not.toHaveBeenCalled();
    expect(redisEvalMock).not.toHaveBeenCalled();
  });

  it("denies reservations without hitting Redis when the send ledger table is missing", async () => {
    sendLedgerMock.count.mockRejectedValueOnce(missingSendLedgerError());
    sendLedgerMock.findFirst.mockRejectedValueOnce(missingSendLedgerError());

    const result = await reserveSendCapacity(SCOPE);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.window.ledgerAvailable).toBe(false);
    }
    expect(redisEvalMock).not.toHaveBeenCalled();
  });
});
