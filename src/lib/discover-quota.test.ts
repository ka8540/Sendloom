import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, redisEvalMock, redisPipelineMock } = vi.hoisted(() => ({
  mockEnv: {
    DISCOVER_RESULTS_PER_SEARCH: 10,
    DISCOVER_PEOPLE_LIMIT_24H: 40,
    DISCOVER_QUOTA_EXEMPT_EMAILS: ""
  } as Record<string, unknown>,
  redisEvalMock: vi.fn(),
  redisPipelineMock: vi.fn()
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@/lib/redis", () => ({ getRedis: () => ({ eval: redisEvalMock, pipeline: redisPipelineMock }) }));

import {
  DISCOVER_PEOPLE_LIMIT_24H,
  DISCOVER_RESULTS_PER_SEARCH,
  formatDiscoverLimitMessage,
  getDiscoverQuotaStatus,
  isDiscoverQuotaExempt,
  reserveDiscoverPeople
} from "@/lib/discover-quota";

const EMAIL = "user@test.dev";
const start = new Date("2026-10-07T10:15:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function installStore() {
  const usage = new Map<string, Map<string, number>>();
  const holds = new Map<string, Map<string, number>>();
  const operations = new Map<string, Set<string>>();
  redisEvalMock.mockImplementation((...args: unknown[]) => {
    const usageKey = String(args[2]);
    const holdsKey = String(args[3]);
    const operationKey = String(args[4]);
    const phase = String(args[5]);
    const now = Number(args[6]);
    const window = Number(args[7]);
    const holdMs = Number(args[8]);
    const limit = Number(args[9]);
    const candidates = args.slice(11).map(String);
    const live = usage.get(usageKey) ?? new Map<string, number>();
    const reserved = holds.get(holdsKey) ?? new Map<string, number>();
    const own = operations.get(operationKey) ?? new Set<string>();
    usage.set(usageKey, live);
    holds.set(holdsKey, reserved);
    for (const [id, at] of live) if (at <= now - window) live.delete(id);
    for (const [id, until] of reserved) if (until <= now) reserved.delete(id);
    if (phase === "reserve") {
      const selected: string[] = [];
      for (const id of new Set(candidates)) {
        if (live.has(id) || (reserved.has(id) && own.has(id))) selected.push(id);
        else if (!reserved.has(id) && live.size + reserved.size < limit) {
          reserved.set(id, now + holdMs);
          own.add(id);
          selected.push(id);
        }
      }
      operations.set(operationKey, own);
      const oldest = Math.min(...live.values());
      return [live.size, reserved.size, Number.isFinite(oldest) ? String(oldest) : "", ...selected];
    }
    if (phase === "finalize") {
      for (const id of own) {
        if (candidates.includes(id) && !live.has(id)) live.set(id, now);
        reserved.delete(id);
      }
      operations.delete(operationKey);
    }
    const oldest = Math.min(...live.values());
    return [live.size, reserved.size, Number.isFinite(oldest) ? String(oldest) : ""];
  });
  return { usage, holds };
}

async function deliver(searchId: string, count: number, prefix = searchId) {
  const candidateIds = Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
  const reserved = await reserveDiscoverPeople({ userId: "u1", email: EMAIL, searchId, phase: "reserve", candidateIds });
  await reserveDiscoverPeople({ userId: "u1", email: EMAIL, searchId, phase: "finalize", deliveredIds: reserved.reservedProfileIds });
  return reserved.reservedProfileIds ?? [];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  redisEvalMock.mockReset();
  redisPipelineMock.mockReset();
  mockEnv.DISCOVER_PEOPLE_LIMIT_24H = 40;
  mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = "";
});

afterEach(() => vi.useRealTimers());

describe("rolling Discover people allowance", () => {
  it("charges actual allocations: 2, 10, 1, then zero", async () => {
    installStore();
    expect(await deliver("s1", 2)).toHaveLength(2);
    expect((await getDiscoverQuotaStatus("u1", EMAIL)).peopleRemaining).toBe(38);
    expect(await deliver("s2", 10)).toHaveLength(10);
    expect((await getDiscoverQuotaStatus("u1", EMAIL)).peopleRemaining).toBe(28);
    expect(await deliver("s3", 1)).toHaveLength(1);
    expect(await deliver("s4", 0)).toHaveLength(0);
    expect((await getDiscoverQuotaStatus("u1", EMAIL)).peopleRemaining).toBe(27);
  });

  it("caps the final allocation and rejects new work at zero", async () => {
    installStore();
    await deliver("prior", 34);
    expect(await deliver("last", 10)).toHaveLength(6);
    const status = await getDiscoverQuotaStatus("u1", EMAIL);
    expect(status.peopleUsed).toBe(40);
    expect(status.peopleRemaining).toBe(0);
    expect((await reserveDiscoverPeople({ userId: "u1", email: EMAIL, searchId: "next" })).allowed).toBe(false);
  });

  it("allows more than four searches when partial results leave capacity", async () => {
    installStore();
    for (let i = 0; i < 8; i++) await deliver(`s${i}`, 2);
    expect((await getDiscoverQuotaStatus("u1", EMAIL)).peopleRemaining).toBe(24);
  });

  it("replays a reservation and completed person without another charge", async () => {
    installStore();
    const ids = await deliver("s1", 7);
    expect(await deliver("s1", 7)).toEqual(ids);
    expect((await getDiscoverQuotaStatus("u1", EMAIL)).peopleUsed).toBe(7);
  });

  it("shares the cap across simultaneous searches", async () => {
    const store = installStore();
    await deliver("prior", 35);
    const [a, b] = await Promise.all([
      reserveDiscoverPeople({ userId: "u1", email: EMAIL, searchId: "a", phase: "reserve", candidateIds: Array.from({ length: 10 }, (_, i) => `a-${i}`) }),
      reserveDiscoverPeople({ userId: "u1", email: EMAIL, searchId: "b", phase: "reserve", candidateIds: Array.from({ length: 10 }, (_, i) => `b-${i}`) })
    ]);
    expect((a.reservedProfileIds?.length ?? 0) + (b.reservedProfileIds?.length ?? 0)).toBe(5);
    expect(store.holds.get("discover:people:holds:u1")?.size).toBe(5);
    await Promise.all([
      reserveDiscoverPeople({ userId: "u1", email: EMAIL, searchId: "a", phase: "finalize", deliveredIds: a.reservedProfileIds }),
      reserveDiscoverPeople({ userId: "u1", email: EMAIL, searchId: "b", phase: "finalize", deliveredIds: b.reservedProfileIds })
    ]);
    expect((await getDiscoverQuotaStatus("u1", EMAIL)).peopleUsed).toBe(40);
  });

  it("releases unused holds when fewer people are actually delivered", async () => {
    installStore();
    const reservation = await reserveDiscoverPeople({ userId: "u1", email: EMAIL, searchId: "add-more", phase: "reserve", candidateIds: ["a", "b", "c"] });
    expect(reservation.reservedProfileIds).toHaveLength(3);
    await reserveDiscoverPeople({ userId: "u1", email: EMAIL, searchId: "add-more", phase: "finalize", deliveredIds: ["a"] });
    expect((await getDiscoverQuotaStatus("u1", EMAIL)).peopleRemaining).toBe(39);
  });

  it("expires each person individually after 24 hours, never at midnight", async () => {
    installStore();
    await deliver("old", 5);
    vi.setSystemTime(new Date(start.getTime() + 12 * 60 * 60 * 1000));
    await deliver("recent", 20);
    vi.setSystemTime(new Date(start.getTime() + 14 * 60 * 60 * 1000));
    expect((await getDiscoverQuotaStatus("u1", EMAIL)).peopleUsed).toBe(25);
    vi.setSystemTime(new Date(start.getTime() + 25 * 60 * 60 * 1000));
    const status = await getDiscoverQuotaStatus("u1", EMAIL);
    expect(status.peopleUsed).toBe(20);
    expect(status.peopleRemaining).toBe(20);
    expect(status.nextAvailabilityAt?.getTime()).toBe(start.getTime() + 36 * 60 * 60 * 1000);
  });

  it("reconciles a crashed grant without charging an older reuse or operator repair", async () => {
    const store = installStore();
    const recent = [{ personId: "old" }, { personId: "new" }, { personId: "repair" }];
    const grants = [
      { personId: "old", allocatedAt: new Date(start.getTime() - DAY - 1), allocationSource: "CACHE", person: { sourceProfileId: "old-profile" } },
      { personId: "old", allocatedAt: start, allocationSource: "CACHE", person: { sourceProfileId: "old-profile" } },
      { personId: "new", allocatedAt: start, allocationSource: "PROVIDER", person: { sourceProfileId: "new-profile" } },
      { personId: "repair", allocatedAt: start, allocationSource: "REPROCESS", person: { sourceProfileId: "repair-profile" } }
    ];
    const prisma = { prospectSearchPerson: { findMany: vi.fn().mockResolvedValueOnce(recent).mockResolvedValueOnce(grants) } } as unknown as PrismaClient;
    redisPipelineMock.mockImplementation(() => {
      const writes: Array<[string, number, string]> = [];
      return {
        zadd(key: string, _nx: string, score: number, member: string) { writes.push([key, score, member]); return this; },
        expire() { return this; },
        async exec() {
          for (const [key, score, member] of writes) {
            const live = store.usage.get(key) ?? new Map<string, number>();
            if (!live.has(member)) live.set(member, score);
            store.usage.set(key, live);
          }
        }
      };
    });
    const quota = await getDiscoverQuotaStatus("u1", EMAIL, prisma);
    expect(quota.peopleUsed).toBe(1);
    expect(quota.peopleRemaining).toBe(39);
    expect(store.usage.get("discover:people:usage:u1")?.has("old-profile")).toBe(false);
  });

  it("keeps the owner exemption and the ten-person operation cap", async () => {
    mockEnv.DISCOVER_QUOTA_EXEMPT_EMAILS = "OWNER@example.com";
    expect(isDiscoverQuotaExempt(" owner@EXAMPLE.com ")).toBe(true);
    expect(DISCOVER_RESULTS_PER_SEARCH).toBe(10);
    expect(DISCOVER_PEOPLE_LIMIT_24H).toBe(40);
    const result = await reserveDiscoverPeople({ userId: "owner", email: "owner@example.com", searchId: "s", phase: "reserve", candidateIds: ["a"] });
    expect(result.status.unlimited).toBe(true);
    expect(redisEvalMock).not.toHaveBeenCalled();
  });

  it("returns a safe limit message", () => {
    const message = formatDiscoverLimitMessage({
      resultsPerSearch: 10, peopleLimit: 40, peopleUsed: 40, peopleRemaining: 0,
      windowHours: 24, nextAvailabilityAt: new Date(start.getTime() + DAY), unlimited: false
    });
    expect(message).toContain("40 people");
    expect(message).toContain("24 hours");
    expect(message).not.toMatch(/discover:people|redis|userId/i);
  });
});
