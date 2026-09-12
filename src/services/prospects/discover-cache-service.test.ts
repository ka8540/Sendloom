import { withRaeNameAI } from "./__test-utils__/mock-name-ai";
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
  type LookupReusableDatasetParams,
  type ResolvedCachePerson,
  type ResolvedDataset
} from "@/services/prospects/discover-cache-service";
import { filterReusableDiscoverPeople } from "@/services/prospects/discover-cache-reuse";
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

type CacheTestRequest = LookupReusableDatasetParams & { provider: () => Promise<ResolvedDataset> };

function params(fingerprint: string, provider: CacheTestRequest["provider"]): CacheTestRequest {
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

function lookupParams(request: CacheTestRequest): LookupReusableDatasetParams {
  const { provider: _provider, ...lookup } = request;
  return lookup;
}

function recruiterUsFilter(people: ResolvedCachePerson[]) {
  return filterReusableDiscoverPeople({
    people,
    requestedRoles: [{ normalizedTitle: "recruiter", category: "RECRUITING" }],
    requestedLocations: ["United States"]
  });
}

function companyPoolParams(input: {
  fingerprint: string;
  companyKey?: string;
  domain?: string | null;
  linkedinUrl?: string | null;
  cacheVersion?: string;
  provider: CacheTestRequest["provider"];
  filter?: LookupReusableDatasetParams["filterCompanyPoolPeople"];
  lookupLocalPeople?: LookupReusableDatasetParams["lookupLocalPeople"];
}): CacheTestRequest {
  return {
    fingerprint: input.fingerprint,
    fingerprintInput: {
      companyKey: input.companyKey ?? "domain:apple.com",
      roles: ["recruiter"],
      locations: ["united states"],
      resultLimit: 10,
      cacheVersion: input.cacheVersion ?? "v1"
    },
    company: {
      name: "Apple Inc.",
      domain: input.domain === undefined ? "apple.com" : input.domain,
      linkedinUrl: input.linkedinUrl ?? null
    },
    filterCompanyPoolPeople: input.filter ?? recruiterUsFilter,
    lookupLocalPeople: input.lookupLocalPeople,
    provider: input.provider
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
    ...overrides
  });
}

async function seedCache(service: DiscoverSearchCacheService, request: CacheTestRequest) {
  const resolved = await request.provider();
  const state = await service.appendProviderPeople({
    fingerprint: request.fingerprint,
    fingerprintInput: request.fingerprintInput,
    company: request.company,
    emailFormat: resolved.emailFormat,
    people: resolved.people,
    nextPage: 2,
    pagesFetched: 1,
    exhausted: false
  });
  return {
    dataset: { emailFormat: state.emailFormat, people: state.people },
    source: "PROVIDER" as const,
    cacheId: state.cacheId,
    fetchedAt: new Date(nowMs),
    refreshedStale: false
  };
}

beforeEach(() => {
  prisma = createFakePrisma();
  nowMs = new Date("2026-06-19T12:00:00.000Z").getTime();
  redisSetMock.mockReset();
  redisEvalMock.mockReset();
});

describe("DiscoverSearchCacheService storage and durable metadata", () => {
  it("lets the legacy test seeder store normalized provider results", async () => {
    const provider = vi.fn(async () => dataset([cachePerson("1"), cachePerson("2")]));
    const service = buildService();

    const result = await seedCache(service, params(FINGERPRINT, provider));

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("PROVIDER");
    expect(result.dataset.people).toHaveLength(2);

    const entry = prisma._state.discoverCache[0];
    expect(entry.status).toBe("READY");
    expect(entry.resultCount).toBe(2);
    expect(entry.companyKey).toBe("linkedin:apple");
    // New provider writes do not manufacture a people-expiry timestamp.
    expect(entry.expiresAt).toBeNull();
    expect(prisma._state.discoverCachePeople).toHaveLength(2);
    // No requester identity is stored.
    expect(JSON.stringify(entry)).not.toMatch(/userId/i);
  });

  it("appends only stable-identity-unique provider people without name-based collapsing", async () => {
    const service = buildService();
    const request = params(FINGERPRINT, async () => dataset([cachePerson("original")]));
    await seedCache(service, request);

    const state = await service.appendProviderPeople({
      fingerprint: request.fingerprint,
      fingerprintInput: request.fingerprintInput,
      company: request.company,
      emailFormat: dataset([]).emailFormat,
      people: [
        cachePerson("replacement-id", {
          linkedinUrl: "HTTPS://WWW.LINKEDIN.COM/in/original/?tracking=1"
        }),
        cachePerson("same-name-a", { firstName: "Sam", lastName: "Twin", fullName: "Sam Twin" }),
        cachePerson("same-name-b", { firstName: "Sam", lastName: "Twin", fullName: "Sam Twin" })
      ],
      nextPage: 3,
      pagesFetched: 1,
      exhausted: false
    });

    expect(state.people.map((person) => person.sourceProfileId)).toEqual([
      "original",
      "same-name-a",
      "same-name-b"
    ]);
    expect(prisma._state.discoverCache[0].resultCount).toBe(3);
  });

  it("reuses an exact durable entry before later database rungs", async () => {
    const seed = vi.fn(async () => dataset([cachePerson("1")]));
    const service = buildService();
    await seedCache(service, params(FINGERPRINT, seed));

    const provider = vi.fn(async () => dataset([cachePerson("nope")]));
    const filterCompanyPoolPeople = vi.fn(recruiterUsFilter);
    const lookupLocalPeople = vi.fn(async () => ({
      dataset: dataset([cachePerson("local")]),
      candidatePersonCount: 1,
      matchingPersonCount: 1
    }));
    const request = params(FINGERPRINT, provider);
    request.filterCompanyPoolPeople = filterCompanyPoolPeople;
    request.lookupLocalPeople = lookupLocalPeople;
    const result = await service.lookupReusableDataset(lookupParams(request));

    expect(provider).not.toHaveBeenCalled();
    expect(filterCompanyPoolPeople).not.toHaveBeenCalled();
    expect(lookupLocalPeople).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.dataset.people).toHaveLength(1);
    expect(result.dataset.people[0].sourceProfileId).toBe("1");
  });

  it("updates email-format state without rerunning or replacing cached people", async () => {
    const provider = vi.fn(async () => dataset([cachePerson("1"), cachePerson("2")]));
    const service = buildService();
    const seeded = await seedCache(service, params(FINGERPRINT, provider));

    await service.updateEmailFormat({
      cacheId: seeded.cacheId!,
      format: {
        ...seeded.dataset.emailFormat,
        emailDomain: null,
        emailPattern: null,
        emailFormatDiscoveryStatus: "NO_EVIDENCE",
        emailFormatDiscoveryReason: "No public email-format evidence was found.",
        emailFormatDiscoveryAt: new Date(nowMs),
        emailFormatDiscoveryExpiresAt: undefined
      }
    });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(prisma._state.discoverCachePeople).toHaveLength(2);
    expect(prisma._state.discoverCache[0].emailFormatDiscoveryStatus).toBe("NO_EVIDENCE");
    expect(prisma._state.discoverCache[0].emailFormatDiscoveryExpiresAt.getTime() - nowMs).toBe(DAY_MS);
  });

  it("does not cache a transient provider failure as no evidence", async () => {
    const service = buildService();
    const seeded = await seedCache(service, params(FINGERPRINT, async () => dataset([cachePerson("1")])));

    await service.updateEmailFormat({
      cacheId: seeded.cacheId!,
      format: {
        ...seeded.dataset.emailFormat,
        emailDomain: null,
        emailPattern: null,
        emailFormatDiscoveryStatus: "RATE_LIMITED",
        emailFormatDiscoveryReason: "The provider is temporarily rate-limited.",
        emailFormatDiscoveryAt: new Date(nowMs)
      }
    });

    expect(prisma._state.discoverCache[0].emailFormatDiscoveryStatus).toBe("RATE_LIMITED");
    expect(prisma._state.discoverCache[0].emailFormatDiscoveryExpiresAt).toBeNull();
  });

  it("reuses old people without invoking a provider or replacing rows", async () => {
    const service = buildService();
    await seedCache(service, params(FINGERPRINT, async () => dataset([cachePerson("1"), cachePerson("2")])));

    // Advance past the 30-day window.
    nowMs += 31 * DAY_MS;
    const provider = vi.fn(async () => dataset([cachePerson("3")]));
    const result = await service.lookupReusableDataset(lookupParams(params(FINGERPRINT, provider)));

    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.refreshedStale).toBe(false);
    expect(prisma._state.discoverCachePeople.map((p) => p.sourceProfileId)).toEqual(["1", "2"]);
    expect(prisma._state.discoverCache[0].resultCount).toBe(2);
  });

  it("reuses preserved people even when legacy status says a refresh failed", async () => {
    const service = buildService();
    await seedCache(service, params(FINGERPRINT, async () => dataset([cachePerson("1"), cachePerson("2")])));

    nowMs += 31 * DAY_MS;
    const entry = prisma._state.discoverCache[0];
    entry.status = "FAILED";
    entry.lastErrorCode = "PROVIDER_TIMEOUT";
    const result = await service.lookupReusableDataset(lookupParams(params(FINGERPRINT, vi.fn())));

    expect(prisma._state.discoverCachePeople).toHaveLength(2);
    expect(result.dataset.people).toHaveLength(2);
    expect(result.cacheHitType).toBe("EXACT");
  });

  it("cleans up only old empty transient entries and preserves useful people regardless of age", async () => {
    const service = buildService();
    // Fresh entry — must be kept.
    await seedCache(service, params("fresh", async () => dataset([cachePerson("1")])));
    // Recently dated entry — kept.
    await seedCache(service, params("recent", async () => dataset([cachePerson("2")])));
    prisma._state.discoverCache.find((r) => r.fingerprint === "recent")!.expiresAt = new Date(nowMs - 5 * DAY_MS);
    // Old people are durable and must be kept.
    await seedCache(service, params("old", async () => dataset([cachePerson("3")])));
    prisma._state.discoverCache.find((r) => r.fingerprint === "old")!.expiresAt = new Date(nowMs - 40 * DAY_MS);
    // Only an old, empty transient placeholder is eligible for cleanup.
    prisma._state.discoverCache.push({
      id: "dcache_empty_failed",
      fingerprint: "empty-failed",
      cacheVersion: "v1",
      companyKey: "domain:apple.com",
      companyName: "Apple",
      normalizedRoles: [],
      normalizedLocations: [],
      resultLimit: 10,
      status: "FAILED",
      resultCount: 0,
      refreshStartedAt: new Date(nowMs - 40 * DAY_MS),
      createdAt: new Date(nowMs - 40 * DAY_MS),
      updatedAt: new Date(nowMs - 40 * DAY_MS)
    });

    const removed = await service.cleanupExpired();

    expect(removed).toBe(1);
    expect(prisma._state.discoverCache.map((r) => r.fingerprint).sort()).toEqual(["fresh", "old", "recent"]);
    expect(prisma._state.discoverCachePeople.some((p) => p.sourceProfileId === "3")).toBe(true);
  });
});

describe("DiscoverSearchCacheService durable database-only lookup", () => {
  it.each([31, 90, 365])("reuses exact people cached %d days ago", async (ageDays) => {
    const service = buildService();
    const request = params(FINGERPRINT, async () => dataset([cachePerson(`age-${ageDays}`)]));
    await seedCache(service, request);
    const entry = prisma._state.discoverCache[0];
    entry.fetchedAt = new Date(nowMs - ageDays * DAY_MS);
    entry.expiresAt = new Date(nowMs - Math.max(1, ageDays - 30) * DAY_MS);

    const result = await service.lookupReusableDataset(lookupParams(request));

    expect(result.cacheHitType).toBe("EXACT");
    expect(result.dataset.people.map((person) => person.sourceProfileId)).toEqual([`age-${ageDays}`]);
  });

  it("reuses preserved people even when a later provider attempt marked the row failed", async () => {
    const service = buildService();
    const request = params(FINGERPRINT, async () => dataset([cachePerson("preserved")]));
    await seedCache(service, request);
    Object.assign(prisma._state.discoverCache[0], {
      status: "FAILED",
      expiresAt: new Date(nowMs - 365 * DAY_MS)
    });

    const result = await service.lookupReusableDataset(lookupParams(request));

    expect(result.cacheHitType).toBe("EXACT");
    expect(result.dataset.people).toHaveLength(1);
  });

  it("returns a database miss without any provider capability when no people match", async () => {
    const service = buildService();
    const request = companyPoolParams({
      fingerprint: "fp-apple-recruiter-us",
      provider: async () => dataset([])
    });

    const result = await service.lookupReusableDataset(lookupParams(request));

    expect(result.cacheHitType).toBeNull();
    expect(result.dataset.people).toEqual([]);
    expect(result.source).toBe("CACHE");
  });
});

describe("DiscoverSearchCacheService same-company database-first reuse", () => {
  async function seedPool(input: {
    fingerprint?: string;
    companyKey?: string;
    domain?: string | null;
    linkedinUrl?: string | null;
    people: ResolvedCachePerson[];
    cacheVersion?: string;
  }) {
    const service = buildService();
    const seed = companyPoolParams({
      fingerprint: input.fingerprint ?? "fp-apple-broad",
      companyKey: input.companyKey,
      domain: input.domain,
      linkedinUrl: input.linkedinUrl,
      cacheVersion: input.cacheVersion,
      provider: async () => dataset(input.people),
      filter: undefined
    });
    // Seed under a broader, non-identical role fingerprint. Omitting the pool
    // filter makes this setup behave like an original paid-provider write.
    seed.fingerprintInput.roles = ["human resource", "recruiter", "software engineer"];
    delete seed.filterCompanyPoolPeople;
    await seedCache(service, seed);
    return service;
  }

  it("reuses Recruiters from a broader durable Apple store without calling the provider", async () => {
    const service = await seedPool({
      people: [
        cachePerson("r1", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" }),
        cachePerson("r2", { currentTitle: "Technical Recruiter", normalizedTitle: "technical recruiter", positionCategory: "RECRUITING" }),
        cachePerson("s1"),
        cachePerson("h1", { currentTitle: "HR Manager", normalizedTitle: "hr manager", positionCategory: "HUMAN_RESOURCES" })
      ]
    });
    const provider = vi.fn(async () => dataset([cachePerson("paid")]))
    const lookupLocalPeople = vi.fn(async () => ({
      dataset: dataset([cachePerson("local")]),
      candidatePersonCount: 1,
      matchingPersonCount: 1
    }));

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-apple-recruiter", provider, lookupLocalPeople }))
    );

    expect(provider).not.toHaveBeenCalled();
    expect(lookupLocalPeople).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.cacheHitType).toBe("COMPANY_POOL");
    expect(result.dataset.people.map((person) => person.sourceProfileId)).toEqual(["r1", "r2"]);
    expect(result.lookupDiagnostics).toMatchObject({
      candidateEntryCount: 1,
      candidatePersonCount: 4,
      matchingPersonCount: 2
    });
    const derived = prisma._state.discoverCache.find((entry) => entry.fingerprint === "fp-apple-recruiter");
    const source = prisma._state.discoverCache.find((entry) => entry.fingerprint === "fp-apple-broad");
    expect(derived).toMatchObject({
      status: "READY",
      providerNextPage: 1,
      providerPagesFetched: 0,
      resultCount: 2
    });
    expect(derived?.fetchedAt).toEqual(source?.fetchedAt);
    expect(derived?.expiresAt).toEqual(source?.expiresAt);
    expect((await service.getExpansionState("fp-apple-recruiter"))?.providerNextPage).toBe(1);

    const repeatedProvider = vi.fn(async () => dataset([cachePerson("paid-again")]))
    const repeated = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-apple-recruiter", provider: repeatedProvider }))
    );
    expect(repeated.cacheHitType).toBe("EXACT");
    expect(repeatedProvider).not.toHaveBeenCalled();
  });

  it("returns a partial same-user local dataset without provider top-up or shared-cache writes", async () => {
    const service = buildService();
    const provider = vi.fn(async () => dataset([cachePerson("paid")]))
    const localPeople = [cachePerson("local-1"), cachePerson("local-2"), cachePerson("local-3")];
    const lookupLocalPeople = vi.fn(async () => ({
      dataset: dataset(localPeople),
      candidatePersonCount: 3,
      matchingPersonCount: 3
    }));
    const request = params("fp-local-partial", provider);
    request.filterCompanyPoolPeople = recruiterUsFilter;
    request.lookupLocalPeople = lookupLocalPeople;

    const result = await service.lookupReusableDataset(lookupParams(request));

    expect(result.source).toBe("CACHE");
    expect(result.cacheHitType).toBe("LOCAL_PERSON");
    expect(result.cacheId).toBeNull();
    expect(result.dataset.people).toHaveLength(3);
    expect(result.lookupDiagnostics).toMatchObject({ candidatePersonCount: 3, matchingPersonCount: 3 });
    expect(lookupLocalPeople).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
    expect(prisma._state.discoverCache).toHaveLength(0);
    expect(prisma._state.discoverCachePeople).toHaveLength(0);
  });

  it("returns a database miss after the same-user local lookup has zero usable matches", async () => {
    const service = buildService();
    const provider = vi.fn(async () => dataset([cachePerson("paid")]))
    const lookupLocalPeople = vi.fn(async () => ({
      dataset: null,
      candidatePersonCount: 2,
      matchingPersonCount: 0
    }));
    const request = params("fp-local-zero", provider);
    request.filterCompanyPoolPeople = recruiterUsFilter;
    request.lookupLocalPeople = lookupLocalPeople;

    const result = await service.lookupReusableDataset(lookupParams(request));

    expect(result.source).toBe("CACHE");
    expect(result.dataset.people).toEqual([]);
    expect(result.lookupDiagnostics).toMatchObject({ candidatePersonCount: 2, matchingPersonCount: 0 });
    expect(lookupLocalPeople).toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("returns a partial four-person pool and never pays to top it up", async () => {
    const service = await seedPool({
      people: Array.from({ length: 4 }, (_, index) =>
        cachePerson(`r${index + 1}`, {
          currentTitle: "Recruiter",
          normalizedTitle: "recruiter",
          positionCategory: "RECRUITING"
        })
      )
    });
    const provider = vi.fn(async () => dataset([cachePerson("paid")]))

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-apple-partial", provider }))
    );

    expect(result.dataset.people).toHaveLength(4);
    expect(provider).not.toHaveBeenCalled();
  });

  it("still returns proven pool matches when exact-cache derivation cannot be written", async () => {
    const service = await seedPool({
      people: [
        cachePerson("r1", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" })
      ]
    });
    prisma.$transaction = vi.fn(async () => {
      throw new Error("derived write unavailable");
    }) as FakePrisma["$transaction"];
    const provider = vi.fn(async () => dataset([cachePerson("paid")]))

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-apple-derive-failure", provider }))
    );

    expect(result.cacheHitType).toBe("COMPANY_POOL");
    expect(result.dataset.people.map((person) => person.sourceProfileId)).toEqual(["r1"]);
    expect(provider).not.toHaveBeenCalled();
  });

  it("ignores a zero-person exact row and reuses a populated sibling", async () => {
    const service = await seedPool({
      people: [
        cachePerson("r1", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" })
      ]
    });
    prisma._state.discoverCache.push({
      id: "zero_exact",
      fingerprint: "fp-apple-zero-exact",
      cacheVersion: "v1",
      companyKey: "domain:apple.com",
      companyName: "Apple Inc.",
      companyDomain: "apple.com",
      companyLinkedinUrl: null,
      normalizedRoles: ["recruiter"],
      normalizedLocations: ["united states"],
      resultLimit: 10,
      status: "READY",
      fetchedAt: new Date(nowMs - DAY_MS),
      expiresAt: new Date(nowMs + DAY_MS),
      resultCount: 0
    });
    const provider = vi.fn(async () => dataset([cachePerson("paid")]))

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-apple-zero-exact", provider }))
    );

    expect(result.cacheHitType).toBe("COMPANY_POOL");
    expect(result.dataset.people.map((person) => person.sourceProfileId)).toEqual(["r1"]);
    expect(provider).not.toHaveBeenCalled();
  });

  it("returns zero without a provider when the Apple pool has no matching Recruiters", async () => {
    const service = await seedPool({ people: [cachePerson("s1"), cachePerson("s2")] });
    const provider = vi.fn(async () =>
      dataset([
        cachePerson("paid-r", {
          currentTitle: "Recruiter",
          normalizedTitle: "recruiter",
          positionCategory: "RECRUITING"
        })
      ])
    );

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-apple-no-role", provider }))
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.dataset.people).toEqual([]);
    expect(result.lookupDiagnostics).toMatchObject({ candidateEntryCount: 1, matchingPersonCount: 0 });
  });

  it("does not reuse a Recruiter from the wrong requested location", async () => {
    const service = await seedPool({
      people: [
        cachePerson("r-ca", {
          currentTitle: "Recruiter",
          normalizedTitle: "recruiter",
          positionCategory: "RECRUITING",
          location: "Toronto, Canada",
          country: "Canada",
          city: "Toronto"
        })
      ]
    });
    const provider = vi.fn(async () => dataset([]));

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-apple-wrong-location", provider }))
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.dataset.people).toEqual([]);
  });

  it("reuses a LinkedIn-keyed Canonical cache through its trusted domain", async () => {
    const service = await seedPool({
      companyKey: "linkedin:canonical",
      domain: "canonical.com",
      linkedinUrl: "https://www.linkedin.com/company/Canonical/",
      people: [
        cachePerson("c1", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" })
      ]
    });
    const provider = vi.fn(async () => dataset([]));

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({
        fingerprint: "fp-canonical-domain",
        companyKey: "domain:canonical.com",
        domain: "canonical.com",
        provider
      }))
    );

    expect(result.cacheHitType).toBe("COMPANY_POOL");
    expect(provider).not.toHaveBeenCalled();
  });

  it("reuses a domain-keyed Canonical cache through its normalized LinkedIn slug", async () => {
    const service = await seedPool({
      companyKey: "domain:canonical.com",
      domain: "canonical.com",
      linkedinUrl: "https://linkedin.com/company/Canonical/",
      people: [
        cachePerson("c1", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" })
      ]
    });
    const provider = vi.fn(async () => dataset([]));

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({
        fingerprint: "fp-canonical-linkedin",
        companyKey: "linkedin:canonical",
        domain: null,
        linkedinUrl: "https://www.linkedin.com/company/canonical",
        provider
      }))
    );

    expect(result.cacheHitType).toBe("COMPANY_POOL");
    expect(provider).not.toHaveBeenCalled();
  });

  it("isolates similar company names with different trusted domains", async () => {
    const service = await seedPool({
      companyKey: "domain:apple-technologies.example",
      domain: "apple-technologies.example",
      people: [
        cachePerson("other-r", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" })
      ]
    });
    const provider = vi.fn(async () => dataset([]));

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-real-apple", provider }))
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.lookupDiagnostics?.candidateEntryCount).toBe(0);
  });

  it("rejects a candidate when one trusted identifier matches but another conflicts", async () => {
    const service = await seedPool({
      companyKey: "domain:apple.com",
      domain: "apple.com",
      linkedinUrl: "https://www.linkedin.com/company/apple-hospitality",
      people: [
        cachePerson("conflict-r", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" })
      ]
    });
    const provider = vi.fn(async () => dataset([]));

    const result = await service.lookupReusableDataset(
      lookupParams(companyPoolParams({
        fingerprint: "fp-apple-conflict",
        companyKey: "linkedin:apple",
        domain: "apple.com",
        linkedinUrl: "https://www.linkedin.com/company/apple",
        provider
      }))
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
  });

  it("reuses old sibling people but still rejects an incompatible schema version", async () => {
    const expiredService = await seedPool({
      fingerprint: "expired-sibling",
      people: [
        cachePerson("expired-r", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" })
      ]
    });
    prisma._state.discoverCache.find((entry) => entry.fingerprint === "expired-sibling")!.expiresAt = new Date(nowMs - 1);
    const expiredProvider = vi.fn(async () => dataset([]));
    const oldResult = await expiredService.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-after-expiry", provider: expiredProvider }))
    );
    expect(expiredProvider).not.toHaveBeenCalled();
    expect(oldResult.dataset.people.map((person) => person.sourceProfileId)).toEqual(["expired-r"]);
    for (const entry of prisma._state.discoverCache) entry.cacheVersion = "v0";

    const versionedService = await seedPool({
      fingerprint: "old-version-sibling",
      cacheVersion: "v0",
      people: [
        cachePerson("old-r", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" })
      ]
    });
    const versionProvider = vi.fn(async () => dataset([]));
    const versionResult = await versionedService.lookupReusableDataset(
      lookupParams(companyPoolParams({ fingerprint: "fp-new-version", provider: versionProvider }))
    );
    expect(versionProvider).not.toHaveBeenCalled();
    expect(versionResult.dataset.people).toEqual([]);
  });

  it("does not reuse an exact fingerprint row written by another cache version", async () => {
    const service = await seedPool({
      fingerprint: "same-fingerprint-different-version",
      cacheVersion: "v0",
      people: [
        cachePerson("old-r", { currentTitle: "Recruiter", normalizedTitle: "recruiter", positionCategory: "RECRUITING" })
      ]
    });
    const provider = vi.fn(async () => dataset([]));

    const result = await service.lookupReusableDataset(
      lookupParams(
        companyPoolParams({ fingerprint: "same-fingerprint-different-version", cacheVersion: "v1", provider })
      )
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.dataset.people).toEqual([]);
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

describe("DiscoverSearchCacheService durable lookup across legacy states", () => {
  function seedEntry(overrides: Record<string, unknown>) {
    prisma._state.discoverCache.push({
      id: "dc_seed",
      fingerprint: FINGERPRINT,
      cacheVersion: "v1",
      companyKey: "linkedin:apple",
      companyName: "Apple Inc.",
      status: "READY",
      fetchedAt: new Date(nowMs - DAY_MS),
      expiresAt: new Date(nowMs + 29 * DAY_MS),
      resultCount: 0,
      emailDomain: "apple.com",
      emailDomainConfidence: "MEDIUM",
      emailDomainEvidence: null,
      emailPattern: "flast",
      patternConfidence: "MEDIUM",
      patternEvidence: null,
      emailFormatReason: null,
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
      ...overrides
    });
  }

  it("returns a database miss when the only entry has zero people", async () => {
    seedEntry({ status: "READY", resultCount: 0 }); // no person rows seeded
    const provider = vi.fn(async () => dataset([cachePerson("9")]));
    const result = await buildService().lookupReusableDataset(lookupParams(params(FINGERPRINT, provider)));
    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.dataset.people).toHaveLength(0);
  });

  it("reuses people preserved under a FAILED legacy status", async () => {
    seedEntry({ status: "FAILED" });
    prisma._state.discoverCachePeople.push({ id: "p_old", cacheId: "dc_seed", sortIndex: 0, ...cachePerson("old") });
    const provider = vi.fn(async () => dataset([cachePerson("9")]));
    const result = await buildService().lookupReusableDataset(lookupParams(params(FINGERPRINT, provider)));
    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.dataset.people.map((person) => person.sourceProfileId)).toEqual(["old"]);
  });

  it("reuses people after legacy expiresAt has passed", async () => {
    seedEntry({ status: "READY", expiresAt: new Date(nowMs - DAY_MS) });
    prisma._state.discoverCachePeople.push({ id: "p_exp", cacheId: "dc_seed", sortIndex: 0, ...cachePerson("exp") });
    const provider = vi.fn(async () => dataset([cachePerson("9")]));
    const result = await buildService().lookupReusableDataset(lookupParams(params(FINGERPRINT, provider)));
    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.dataset.people.map((person) => person.sourceProfileId)).toEqual(["exp"]);
  });

  it("returns a database miss for an empty abandoned REFRESHING entry", async () => {
    seedEntry({ status: "REFRESHING" });
    const provider = vi.fn(async () => dataset([cachePerson("9")]));
    const result = await buildService().lookupReusableDataset(lookupParams(params(FINGERPRINT, provider)));
    expect(provider).not.toHaveBeenCalled();
    expect(result.source).toBe("CACHE");
    expect(result.dataset.people).toEqual([]);
  });
});

afterEach(() => {
  vi.useRealTimers();
});


describe("legacy name cache boundaries", () => {
  it.each(["EXACT", "COMPANY_POOL", "LOCAL_PERSON"])("normalizes %s results before reuse and derived writes", async mode => {
    await withRaeNameAI(async () => {
      const service = buildService();
      const clean = cachePerson("rae", { firstName: "Rae", lastName: "Gruppman", fullName: "Rae Gruppman", positionCategory: "RECRUITING", currentTitle: "Recruiter" });
      await seedCache(service, params(FINGERPRINT, async () => dataset([clean])));
      const bad = { ...clean, firstName: "Rae", lastName: "SHRM-CP", fullName: "Rae Gruppman SHRM-CP", sourceName: null, nameNormalization: null, inferredEmail: "rshrmcp@apple.com" };
      Object.assign(prisma._state.discoverCachePeople[0], bad);
      const provider = vi.fn(async () => { throw new Error("Apify must not run"); });
      const request = mode === "EXACT" ? params(FINGERPRINT, provider) : companyPoolParams({ fingerprint: "new", provider,
        ...(mode === "LOCAL_PERSON" ? { filter: () => [], lookupLocalPeople: async () => ({ dataset: dataset([bad]), candidatePersonCount: 1, matchingPersonCount: 1 }) } : {}) });
      const result = await service.lookupReusableDataset(lookupParams(request));
      expect(provider).not.toHaveBeenCalled();
      expect(result.dataset.people[0]).toMatchObject({ fullName: "Rae Gruppman", lastName: "Gruppman", inferredEmail: "rgruppman@apple.com" });
      if (mode === "COMPANY_POOL") {
        const derived = prisma._state.discoverCachePeople.filter(p => p.cacheId !== prisma._state.discoverCache[0].id);
        expect(derived[0].fullName).toBe("Rae Gruppman");
      }
    });
  });
});
