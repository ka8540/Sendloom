import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prisma/client";

const { redisSetMock, redisEvalMock } = vi.hoisted(() => ({
  redisSetMock: vi.fn(),
  redisEvalMock: vi.fn()
}));

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({ set: redisSetMock, eval: redisEvalMock })
}));

import {
  DiscoverSearchCacheService,
  createRedisCacheLock,
  type DiscoverCacheLock,
  type GetOrRefreshParams,
  type ResolvedCachePerson,
  type ResolvedDataset
} from "@/services/prospects/discover-cache-service";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";

const DAY_MS = 24 * 60 * 60 * 1000;
const FINGERPRINT = "fp-apple-swe-us";

function cachePerson(id: string, overrides: Partial<ResolvedCachePerson> = {}): ResolvedCachePerson {
  return {
    sourceProfileId: id,
    firstName: "Jane",
    lastName: id,
    fullName: `Jane ${id}`,
    currentTitle: "Software Engineer",
    normalizedTitle: "software engineer",
    positionCategory: "SOFTWARE_ENGINEERING",
    location: "United States",
    country: "United States",
    state: null,
    city: null,
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    inferredEmail: `j${id}@apple.com`,
    emailStatus: "INFERRED_MEDIUM",
    emailConfidence: "MEDIUM",
    emailPattern: "flast",
    emailSource: "PATTERN",
    ...overrides
  };
}

function dataset(people: ResolvedCachePerson[]): ResolvedDataset {
  return {
    emailFormat: {
      emailDomain: "apple.com",
      emailDomainConfidence: "MEDIUM",
      emailDomainEvidence: [{ sourceName: "public" }],
      emailPattern: "flast",
      patternConfidence: "MEDIUM",
      patternEvidence: [{ pattern: "flast" }],
      emailFormatReason: "format"
    },
    people
  };
}

function makeFakeLock() {
  const held = new Map<string, string>();
  let counter = 0;
  const lock: DiscoverCacheLock = {
    async acquire(key) {
      if (held.has(key)) {
        return null;
      }
      counter += 1;
      const token = `tok-${counter}`;
      held.set(key, token);
      return token;
    },
    async release(key, token) {
      // Only the owner may release.
      if (held.get(key) === token) {
        held.delete(key);
      }
    }
  };
  return { lock, held };
}

function params(fingerprint: string, provider: GetOrRefreshParams["provider"]): GetOrRefreshParams {
  return {
    fingerprint,
    fingerprintInput: {
      companyKey: "linkedin:apple",
      roles: ["software engineer"],
      locations: ["united states"],
      resultLimit: 10,
      cacheVersion: "v1"
    },
    company: { name: "Apple Inc.", domain: "apple.com", linkedinUrl: "https://www.linkedin.com/company/apple" },
    provider
  };
}

let prisma: FakePrisma;
let nowMs: number;

function buildService(overrides: Partial<ConstructorParameters<typeof DiscoverSearchCacheService>[0]> = {}) {
  const { lock } = makeFakeLock();
  return new DiscoverSearchCacheService({
    prisma: prisma as unknown as PrismaClient,
    lock,
    now: () => new Date(nowMs),
    ttlDays: 30,
    waitTimeoutMs: 500,
    pollIntervalMs: 5,
    cleanupOnRefresh: false,
    ...overrides
  });
}

beforeEach(() => {
  prisma = createFakePrisma();
  nowMs = new Date("2026-06-19T12:00:00.000Z").getTime();
  redisSetMock.mockReset();
  redisEvalMock.mockReset();
});

describe("DiscoverSearchCacheService cache behavior", () => {
  it("calls the provider exactly once on a miss and stores normalized results (#6, #7, #8)", async () => {
    const provider = vi.fn(async () => dataset([cachePerson("1"), cachePerson("2")]));
    const service = buildService();

    const result = await service.getOrRefresh(params(FINGERPRINT, provider));

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("PROVIDER");
    expect(result.dataset.people).toHaveLength(2);

    const entry = prisma._state.discoverCache[0];
    expect(entry.status).toBe("READY");
    expect(entry.resultCount).toBe(2);
    expect(entry.companyKey).toBe("linkedin:apple");
    // 30-day expiration measured from fetchedAt (not the requester).
    expect(entry.expiresAt.getTime() - entry.fetchedAt.getTime()).toBe(30 * DAY_MS);
    expect(prisma._state.discoverCachePeople).toHaveLength(2);
    // No requester identity is stored.
    expect(JSON.stringify(entry)).not.toMatch(/userId/i);
  });

  it("reuses a fresh cache without calling the provider (#1)", async () => {
    const seed = vi.fn(async () => dataset([cachePerson("1")]));
    const service = buildService();
    await service.getOrRefresh(params(FINGERPRINT, seed));

    const provider = vi.fn(async () => dataset([cachePerson("nope")]));
    const result = await service.getOrRefresh(params(FINGERPRINT, provider));

    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.dataset.people).toHaveLength(1);
    expect(result.dataset.people[0].sourceProfileId).toBe("1");
  });

  it("refreshes through the provider when the cache is stale (#9) and replaces rows atomically (#10)", async () => {
    const service = buildService();
    await service.getOrRefresh(params(FINGERPRINT, async () => dataset([cachePerson("1"), cachePerson("2")])));

    // Advance past the 30-day window.
    nowMs += 31 * DAY_MS;
    const provider = vi.fn(async () => dataset([cachePerson("3")]));
    const result = await service.getOrRefresh(params(FINGERPRINT, provider));

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("PROVIDER");
    expect(result.refreshedStale).toBe(true);
    // Old rows replaced by the new dataset — never a mix or an empty window.
    expect(prisma._state.discoverCachePeople.map((p) => p.sourceProfileId)).toEqual(["3"]);
    expect(prisma._state.discoverCache[0].resultCount).toBe(1);
  });

  it("does not mark stale data fresh and preserves previous rows on provider failure (#11, #12)", async () => {
    const service = buildService();
    await service.getOrRefresh(params(FINGERPRINT, async () => dataset([cachePerson("1"), cachePerson("2")])));

    nowMs += 31 * DAY_MS;
    const failing = vi.fn(async () => {
      throw Object.assign(new Error("boom"), { code: "PROVIDER_TIMEOUT" });
    });

    await expect(service.getOrRefresh(params(FINGERPRINT, failing))).rejects.toThrow("boom");

    const entry = prisma._state.discoverCache[0];
    expect(entry.status).toBe("FAILED");
    expect(entry.lastErrorCode).toBe("PROVIDER_TIMEOUT");
    // Previous rows preserved; the entry is not served as fresh.
    expect(prisma._state.discoverCachePeople).toHaveLength(2);
    expect(await service.getFreshDataset(FINGERPRINT)).toBeNull();
  });

  it("releases the lock after a failed refresh so a later refresh can run (#5 concurrency)", async () => {
    const { lock, held } = makeFakeLock();
    const service = buildService({ lock });

    await expect(
      service.getOrRefresh(params(FINGERPRINT, async () => {
        throw new Error("first fails");
      }))
    ).rejects.toThrow("first fails");

    expect(held.size).toBe(0); // released in finally

    const recovery = vi.fn(async () => dataset([cachePerson("1")]));
    const result = await service.getOrRefresh(params(FINGERPRINT, recovery));
    expect(recovery).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("PROVIDER");
  });

  it("cleans up only entries abandoned beyond the grace window", async () => {
    const service = buildService();
    // Fresh entry — must be kept.
    await service.getOrRefresh(params("fresh", async () => dataset([cachePerson("1")])));
    // Recently-expired entry (within one TTL of grace) — kept.
    await service.getOrRefresh(params("recent", async () => dataset([cachePerson("2")])));
    prisma._state.discoverCache.find((r) => r.fingerprint === "recent")!.expiresAt = new Date(nowMs - 5 * DAY_MS);
    // Long-abandoned entry (expired > 30 days ago) — removed with its people.
    await service.getOrRefresh(params("old", async () => dataset([cachePerson("3")])));
    prisma._state.discoverCache.find((r) => r.fingerprint === "old")!.expiresAt = new Date(nowMs - 40 * DAY_MS);

    const removed = await service.cleanupExpired();

    expect(removed).toBe(1);
    expect(prisma._state.discoverCache.map((r) => r.fingerprint).sort()).toEqual(["fresh", "recent"]);
    expect(prisma._state.discoverCachePeople.some((p) => p.sourceProfileId === "3")).toBe(false);
  });
});

describe("DiscoverSearchCacheService stampede prevention", () => {
  it("triggers only one provider call for concurrent identical misses, and the waiter reuses the cache (#1, #2)", async () => {
    // Both requests share one lock + one store, like two processes racing.
    const { lock } = makeFakeLock();
    const service = new DiscoverSearchCacheService({
      prisma: prisma as unknown as PrismaClient,
      lock,
      now: () => new Date(nowMs),
      ttlDays: 30,
      waitTimeoutMs: 1000,
      pollIntervalMs: 5,
      cleanupOnRefresh: false
    });

    let providerCalls = 0;
    const provider = async () => {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return dataset([cachePerson("1"), cachePerson("2")]);
    };

    const [a, b] = await Promise.all([
      service.getOrRefresh(params(FINGERPRINT, provider)),
      service.getOrRefresh(params(FINGERPRINT, provider))
    ]);

    expect(providerCalls).toBe(1);
    const sources = [a.source, b.source].sort();
    expect(sources).toEqual(["CACHE", "PROVIDER"]);
    expect(a.dataset.people).toHaveLength(2);
    expect(b.dataset.people).toHaveLength(2);
  });
});

describe("createRedisCacheLock", () => {
  it("acquires with a TTL + NX and only the owner can release (#3, #4)", async () => {
    const store = new Map<string, string>();
    redisSetMock.mockImplementation(async (key: string, value: string, _ex: string, ttl: number, mode: string) => {
      // A positive TTL guarantees the lock self-frees if a worker crashes.
      expect(ttl).toBeGreaterThan(0);
      expect(mode).toBe("NX");
      if (store.has(key)) {
        return null;
      }
      store.set(key, value);
      return "OK";
    });
    redisEvalMock.mockImplementation(async (_script: string, _n: number, key: string, token: string) => {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    });

    const lock = createRedisCacheLock(120);
    const token = await lock.acquire("k");
    expect(token).toBeTruthy();
    // Held — a second acquire fails.
    expect(await lock.acquire("k")).toBeNull();
    // A non-owner token cannot release.
    await lock.release("k", "someone-else");
    expect(await lock.acquire("k")).toBeNull();
    // The owner releases, freeing the lock.
    await lock.release("k", token as string);
    expect(await lock.acquire("k")).toBeTruthy();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
