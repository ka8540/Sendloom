import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable env stand-in so individual tests can flip the exempt allowlist / limit
// without re-importing the module under test.
const { mockEnv, redisEvalMock, redisGetMock } = vi.hoisted(() => ({
  mockEnv: {
    DISCOVER_RESULTS_PER_SEARCH: 10,
    DISCOVER_DAILY_SEARCH_LIMIT: 4,
    DISCOVER_QUOTA_EXEMPT_EMAILS: ""
  } as Record<string, unknown>,
  redisEvalMock: vi.fn(),
  redisGetMock: vi.fn()
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({ eval: redisEvalMock, get: redisGetMock })
}));

import {
  DISCOVER_DAILY_SEARCH_LIMIT,
  DISCOVER_RESULTS_PER_SEARCH,
  formatDiscoverLimitMessage,
  getDiscoverQuotaStatus,
  isDiscoverQuotaExempt,
  reserveDiscoverSearchSlot
} from "@/lib/discover-quota";

const OWNER_EMAIL = "kush.ahir2024@gmail.com";

/**
 * Faithful in-memory emulation of the atomic reserve Lua script, keyed exactly
 * as the real KEYS/ARGV. Synchronous Map mutation gives the same "no two callers
 * over-consume / never double-count one search" guarantee under Promise.all.
 */
function installQuotaStore() {
  const daily = new Map<string, number>();
  const searches = new Set<string>();
  redisEvalMock.mockImplementation((...args: unknown[]) => {
    const dailyKey = String(args[2]);
    const searchKey = String(args[3]);
    const limit = Number(args[4]);
    if (searches.has(searchKey)) {
      return [1, daily.get(dailyKey) ?? 0];
    }
    const count = daily.get(dailyKey) ?? 0;
    if (count >= limit) {
      return [0, count];
    }
    const next = count + 1;
    daily.set(dailyKey, next);
    searches.add(searchKey);
    return [1, next];
  });
  redisGetMock.mockImplementation((key: string) => {
    const value = daily.get(key);
    return value === undefined ? null : String(value);
  });
  return { daily, searches };
}

beforeEach(() => {
  redisEvalMock.mockReset();
  redisGetMock.mockReset();
  mockEnv.DISCOVER_RESULTS_PER_SEARCH = 10;
  mockEnv.DISCOVER_DAILY_SEARCH_LIMIT = 4;
  mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = "";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-19T09:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("exempt allowlist (#13, #14, #16)", () => {
  it("matches the owner email after trimming and case-insensitively", () => {
    mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = OWNER_EMAIL;
    expect(isDiscoverQuotaExempt(" Kush.Ahir2024@GMAIL.com ")).toBe(true);
    expect(isDiscoverQuotaExempt(OWNER_EMAIL)).toBe(true);
  });

  it("does not exempt another authenticated user", () => {
    mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = OWNER_EMAIL;
    expect(isDiscoverQuotaExempt("someone.else@gmail.com")).toBe(false);
    expect(isDiscoverQuotaExempt(null)).toBe(false);
    expect(isDiscoverQuotaExempt("")).toBe(false);
  });

  it("supports a comma-separated list of internal testing accounts", () => {
    mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = `${OWNER_EMAIL}, tester@sendloom.test `;
    expect(isDiscoverQuotaExempt("TESTER@sendloom.test")).toBe(true);
    expect(isDiscoverQuotaExempt(OWNER_EMAIL)).toBe(true);
  });

  it("exposes the documented default product limits", () => {
    expect(DISCOVER_RESULTS_PER_SEARCH).toBe(10);
    expect(DISCOVER_DAILY_SEARCH_LIMIT).toBe(4);
  });
});

describe("reserveDiscoverSearchSlot (#6, #7, #8, #10, #11)", () => {
  it("consumes one slot on the first processed search", async () => {
    installQuotaStore();
    const result = await reserveDiscoverSearchSlot({ userId: "u1", email: "u1@test.dev", searchId: "s1" });
    expect(result.allowed).toBe(true);
    expect(result.status.searchesUsed).toBe(1);
    expect(result.status.searchesRemaining).toBe(3);
    expect(result.status.unlimited).toBe(false);
  });

  it("allows four unique searches then rejects the fifth", async () => {
    installQuotaStore();
    for (let i = 1; i <= 4; i += 1) {
      const ok = await reserveDiscoverSearchSlot({ userId: "u1", email: "u1@test.dev", searchId: `s${i}` });
      expect(ok.allowed).toBe(true);
    }
    const fifth = await reserveDiscoverSearchSlot({ userId: "u1", email: "u1@test.dev", searchId: "s5" });
    expect(fifth.allowed).toBe(false);
    expect(fifth.status.searchesRemaining).toBe(0);
    expect(fifth.status.searchesUsed).toBe(4);
  });

  it("never consumes a second slot when the same search id retries", async () => {
    installQuotaStore();
    const first = await reserveDiscoverSearchSlot({ userId: "u1", email: "u1@test.dev", searchId: "s1" });
    const retry = await reserveDiscoverSearchSlot({ userId: "u1", email: "u1@test.dev", searchId: "s1" });
    const retryAgain = await reserveDiscoverSearchSlot({ userId: "u1", email: "u1@test.dev", searchId: "s1" });
    expect([first.allowed, retry.allowed, retryAgain.allowed]).toEqual([true, true, true]);
    expect(retryAgain.status.searchesUsed).toBe(1);
  });

  it("cannot exceed four under concurrent processing of distinct searches", async () => {
    installQuotaStore();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        reserveDiscoverSearchSlot({ userId: "u1", email: "u1@test.dev", searchId: `s${i}` })
      )
    );
    expect(results.filter((r) => r.allowed).length).toBe(4);
  });

  it("isolates quotas per user", async () => {
    installQuotaStore();
    for (let i = 1; i <= 4; i += 1) {
      await reserveDiscoverSearchSlot({ userId: "u1", email: "u1@test.dev", searchId: `a${i}` });
    }
    expect((await reserveDiscoverSearchSlot({ userId: "u1", email: "u1@test.dev", searchId: "a5" })).allowed).toBe(false);
    // A different user has an untouched window.
    expect((await reserveDiscoverSearchSlot({ userId: "u2", email: "u2@test.dev", searchId: "b1" })).allowed).toBe(true);
  });

  it("honors a configurable daily limit", async () => {
    mockEnv.DISCOVER_DAILY_SEARCH_LIMIT = 2;
    installQuotaStore();
    expect((await reserveDiscoverSearchSlot({ userId: "u1", email: "x@test.dev", searchId: "s1" })).allowed).toBe(true);
    expect((await reserveDiscoverSearchSlot({ userId: "u1", email: "x@test.dev", searchId: "s2" })).allowed).toBe(true);
    expect((await reserveDiscoverSearchSlot({ userId: "u1", email: "x@test.dev", searchId: "s3" })).allowed).toBe(false);
  });

  it("counts two role searches for the SAME company as two usage actions (#usage-1, #usage-2)", async () => {
    // Usage is ACTION-based, keyed only by the search id — never deduplicated by
    // company, domain, cache key, or the grouped dashboard entry. Walmart +
    // Recruiter and Walmart + Software Engineer are two search actions.
    installQuotaStore();
    const recruiter = await reserveDiscoverSearchSlot({
      userId: "u1",
      email: "u1@test.dev",
      searchId: "walmart-recruiter"
    });
    const engineer = await reserveDiscoverSearchSlot({
      userId: "u1",
      email: "u1@test.dev",
      searchId: "walmart-software-engineer"
    });
    expect(recruiter.allowed).toBe(true);
    expect(engineer.allowed).toBe(true);
    expect(engineer.status.searchesUsed).toBe(2);
    // "2 of 4 searches remaining today" after two successful searches.
    expect(engineer.status.searchesRemaining).toBe(2);
    const readBack = await getDiscoverQuotaStatus("u1", "u1@test.dev");
    expect(readBack.searchesUsed).toBe(2);
    expect(readBack.searchesRemaining).toBe(2);
  });
});

describe("owner exemption bypasses the daily quota (#14, #15)", () => {
  it("always allows the exempt account and never consumes a slot", async () => {
    mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = OWNER_EMAIL;
    const store = installQuotaStore();
    for (let i = 1; i <= 7; i += 1) {
      const result = await reserveDiscoverSearchSlot({ userId: "owner", email: OWNER_EMAIL, searchId: `s${i}` });
      expect(result.allowed).toBe(true);
      expect(result.status.unlimited).toBe(true);
    }
    // Redis is never touched for an exempt account.
    expect(redisEvalMock).not.toHaveBeenCalled();
    expect(store.daily.size).toBe(0);
  });

  it("matches the exempt email case-insensitively from the session", async () => {
    mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = OWNER_EMAIL;
    installQuotaStore();
    const result = await reserveDiscoverSearchSlot({ userId: "owner", email: "KUSH.AHIR2024@gmail.com", searchId: "s1" });
    expect(result.allowed).toBe(true);
    expect(result.status.unlimited).toBe(true);
  });

  it("still limits a non-exempt account even if it shares the owner's user id space", async () => {
    mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = OWNER_EMAIL;
    installQuotaStore();
    // A non-exempt email is the only thing that matters — no request field can
    // grant exemption because the caller passes the session email.
    for (let i = 1; i <= 4; i += 1) {
      await reserveDiscoverSearchSlot({ userId: "u1", email: "attacker@evil.test", searchId: `s${i}` });
    }
    const blocked = await reserveDiscoverSearchSlot({ userId: "u1", email: "attacker@evil.test", searchId: "s5" });
    expect(blocked.allowed).toBe(false);
  });
});

describe("daily window + status (#12)", () => {
  it("resets on the next daily window", async () => {
    installQuotaStore();
    for (let i = 1; i <= 4; i += 1) {
      await reserveDiscoverSearchSlot({ userId: "u1", email: "x@test.dev", searchId: `d1-${i}` });
    }
    expect((await reserveDiscoverSearchSlot({ userId: "u1", email: "x@test.dev", searchId: "d1-5" })).allowed).toBe(false);

    // Advance into the next UTC day — a fresh window with a new counter key.
    vi.setSystemTime(new Date("2026-06-20T09:00:00.000Z"));
    const nextDay = await reserveDiscoverSearchSlot({ userId: "u1", email: "x@test.dev", searchId: "d2-1" });
    expect(nextDay.allowed).toBe(true);
    expect(nextDay.status.searchesUsed).toBe(1);
  });

  it("reports reset at the next UTC midnight", async () => {
    installQuotaStore();
    const status = await getDiscoverQuotaStatus("u1", "x@test.dev");
    expect(status.resetAt.toISOString()).toBe("2026-06-20T00:00:00.000Z");
    expect(status.unlimited).toBe(false);
    expect(status.searchesUsed).toBe(0);
    expect(status.searchesRemaining).toBe(4);
  });

  it("reports an unlimited status for the exempt account without consuming", async () => {
    mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = OWNER_EMAIL;
    installQuotaStore();
    const status = await getDiscoverQuotaStatus("owner", OWNER_EMAIL);
    expect(status.unlimited).toBe(true);
    expect(status.searchesUsed).toBe(0);
    expect(status.searchesRemaining).toBe(4);
    expect(redisGetMock).not.toHaveBeenCalled();
  });

  it("read-only status reflects prior consumption", async () => {
    installQuotaStore();
    await reserveDiscoverSearchSlot({ userId: "u1", email: "x@test.dev", searchId: "s1" });
    await reserveDiscoverSearchSlot({ userId: "u1", email: "x@test.dev", searchId: "s2" });
    const status = await getDiscoverQuotaStatus("u1", "x@test.dev");
    expect(status.searchesUsed).toBe(2);
    expect(status.searchesRemaining).toBe(2);
  });
});

describe("limit message safety (#9)", () => {
  it("formats a clean message with the reset time and no internals", () => {
    const message = formatDiscoverLimitMessage({
      resultsPerSearch: 10,
      dailySearchLimit: 4,
      searchesUsed: 4,
      searchesRemaining: 0,
      resetAt: new Date("2026-06-20T00:00:00.000Z"),
      unlimited: false
    });
    expect(message).toContain("4 Discover searches");
    expect(message).toMatch(/search again after/i);
    expect(message).not.toMatch(/discover:quota|redis|userId|u1/i);
  });
});
