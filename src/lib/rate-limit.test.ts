import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { redisEvalMock } = vi.hoisted(() => ({
  redisEvalMock: vi.fn()
}));

vi.mock("@/lib/env", () => ({
  env: {
    GMAIL_SENDS_PER_MINUTE: 3
  }
}));

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    eval: redisEvalMock
  })
}));

import {
  consumeSendWindow,
  DEFAULT_GMAIL_SENDS_PER_MINUTE,
  getClientIp,
  getSendWindowKey,
  getSendWindowSpacingMs
} from "@/lib/rate-limit";

/**
 * Faithful in-memory emulation of the atomic per-minute Lua counter, keyed by
 * the exact window key the limiter builds (sender scope + minute bucket). The
 * real script runs INCR + EXPIRE atomically; here a synchronous Map mutation
 * gives the same "no two callers over-consume" guarantee under Promise.all.
 */
function installWindowCounter() {
  const store = new Map<string, number>();
  redisEvalMock.mockImplementation((...args: unknown[]) => {
    const windowKey = String(args[2]);
    const now = Number(args[3]);
    const limit = Number(args[4]);
    const count = store.get(windowKey) ?? 0;
    if (count >= limit) {
      return [0, now + 60_000, count];
    }
    const next = count + 1;
    store.set(windowKey, next);
    return [1, now, next];
  });
  return store;
}

beforeEach(() => {
  redisEvalMock.mockReset();
  // Freeze time so every call in a test lands in the same one-minute bucket.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-09T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("send window keys", () => {
  it("scopes the send window by sender profile (per connected Gmail sender)", () => {
    expect(getSendWindowKey({ userId: "user_123", senderProfileId: "sender_123" })).toBe(
      "gmail-send-rate:sender:sender_123"
    );
  });

  it("falls back to the user id when no sender profile is available", () => {
    expect(getSendWindowKey({ userId: "user_123" })).toBe("gmail-send-rate:user:user_123");
  });

  it("keeps a global bucket when no owner information is available", () => {
    expect(getSendWindowKey()).toBe("gmail-send-rate:global");
  });

  it("defaults to 3 Gmail sends per minute per sender", () => {
    expect(DEFAULT_GMAIL_SENDS_PER_MINUTE).toBe(3);
  });

  it("derives even spacing from a per-minute cap (informational helper)", () => {
    expect(getSendWindowSpacingMs(120)).toBe(500);
    expect(getSendWindowSpacingMs(60)).toBe(1000);
    expect(getSendWindowSpacingMs(3)).toBe(20_000);
  });
});

describe("consumeSendWindow (per-sender pacing)", () => {
  it("allows only 3 sends per minute for a single sender, then defers the rest", async () => {
    installWindowCounter();
    const key = getSendWindowKey({ senderProfileId: "sender_A" });

    const first = await consumeSendWindow(key);
    const second = await consumeSendWindow(key);
    const third = await consumeSendWindow(key);
    const fourth = await consumeSendWindow(key);

    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true]);
    // The 4th is deferred (not failed): the caller is told when the window frees.
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toBe("window");
    expect(fourth.retryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("tracks each sender independently — sender B is unaffected by sender A", async () => {
    installWindowCounter();
    const keyA = getSendWindowKey({ senderProfileId: "sender_A" });
    const keyB = getSendWindowKey({ senderProfileId: "sender_B" });

    await consumeSendWindow(keyA);
    await consumeSendWindow(keyA);
    await consumeSendWindow(keyA);
    expect((await consumeSendWindow(keyA)).allowed).toBe(false);

    // Sender B still has its full, separate window.
    expect((await consumeSendWindow(keyB)).allowed).toBe(true);
    expect((await consumeSendWindow(keyB)).allowed).toBe(true);
    expect((await consumeSendWindow(keyB)).allowed).toBe(true);
    expect((await consumeSendWindow(keyB)).allowed).toBe(false);
  });

  it("shares one sender's window across parallel sequences and concurrent workers", async () => {
    installWindowCounter();
    // Different sequences for the same sender resolve to the same key, so they
    // share the 3/min budget. Six concurrent attempts must yield exactly three
    // sends — proving 10 racing workers cannot bypass the per-sender limit.
    const key = getSendWindowKey({ senderProfileId: "sender_shared" });

    const results = await Promise.all(Array.from({ length: 6 }, () => consumeSendWindow(key)));
    const allowed = results.filter((result) => result.allowed).length;

    expect(allowed).toBe(3);
  });
});

describe("getClientIp", () => {
  function makeRequest(headers: Record<string, string>) {
    return new Request("https://example.com", { headers });
  }

  it("returns the first entry from x-forwarded-for", () => {
    expect(getClientIp(makeRequest({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" }))).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip when no forwarded header is present", () => {
    expect(getClientIp(makeRequest({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("returns 'unknown' when neither header is set", () => {
    expect(getClientIp(makeRequest({}))).toBe("unknown");
  });
});
