import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prisma/client";

import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import type {
  DiscoverCacheLock,
  LookupReusableDatasetParams,
  ResolvedCachePerson
} from "@/services/prospects/discover-cache-service";
import { filterReusableDiscoverPeople } from "@/services/prospects/discover-cache-reuse";
import { DiscoverPublicKnowledgeService } from "@/services/prospects/discover-public-knowledge-service";

class MemoryRedis {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
    return "OK";
  }

  async incr(key: string) {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }

  clear() {
    this.values.clear();
  }
}

const lock: DiscoverCacheLock = {
  async acquire() {
    return "owner";
  },
  async release() {
    return undefined;
  }
};

function person(id: string, overrides: Partial<ResolvedCachePerson> = {}): ResolvedCachePerson {
  return {
    sourceProfileId: id,
    firstName: "Public",
    lastName: id,
    fullName: `Public ${id}`,
    currentTitle: "Software Engineer",
    normalizedTitle: "software engineer",
    positionCategory: "SOFTWARE_ENGINEERING",
    location: "United States",
    country: "United States",
    state: null,
    city: null,
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    inferredEmail: "must-not-be-shared@example.com",
    emailStatus: "INFERRED_MEDIUM",
    emailConfidence: "MEDIUM",
    emailPattern: "flast",
    emailSource: "PATTERN",
    ...overrides
  };
}

const emptyFormat = {
  emailDomain: null,
  emailDomainConfidence: "UNAVAILABLE",
  emailDomainEvidence: null,
  emailPattern: null,
  patternConfidence: "UNAVAILABLE",
  patternEvidence: null,
  emailFormatReason: null
};

function request(overrides: Partial<LookupReusableDatasetParams> = {}): LookupReusableDatasetParams {
  return {
    fingerprint: "domain-wealthfront-swe-us",
    fingerprintInput: {
      companyKey: "domain:wealthfront.com",
      roles: ["software engineer"],
      locations: ["united states"],
      resultLimit: 10,
      cacheVersion: "v1"
    },
    company: {
      name: "Wealthfront Corporation",
      domain: "wealthfront.com",
      linkedinUrl: null
    },
    ...overrides
  };
}

function exactFilter(input: {
  roles: Array<{ normalizedTitle: string; category: "SOFTWARE_ENGINEERING" | "RECRUITING" }>;
  locations: string[];
}): LookupReusableDatasetParams["filterCompanyPoolPeople"] {
  return (people, source) =>
    filterReusableDiscoverPeople({
      people,
      requestedRoles: input.roles,
      requestedLocations: input.locations,
      sourceRequestedLocations: source.normalizedLocations
    });
}

describe("DiscoverPublicKnowledgeService", () => {
  let prisma: FakePrisma;
  let redis: MemoryRedis;
  let service: DiscoverPublicKnowledgeService;

  beforeEach(() => {
    prisma = createFakePrisma();
    redis = new MemoryRedis();
    service = new DiscoverPublicKnowledgeService({
      prisma: prisma as unknown as PrismaClient,
      redis,
      lock,
      now: () => new Date("2026-09-20T12:00:00.000Z")
    });
  });

  async function ingest(input: {
    fingerprint?: string;
    companyKey?: string;
    domain?: string | null;
    linkedinUrl?: string | null;
    roles?: string[];
    locations?: string[];
    people?: ResolvedCachePerson[];
    exhausted?: boolean;
  } = {}) {
    const companyKey = input.companyKey ?? "domain:wealthfront.com";
    const roles = input.roles ?? ["software engineer"];
    const locations = input.locations ?? ["united states"];
    return service.appendProviderPeople({
      fingerprint: input.fingerprint ?? "source-intent",
      fingerprintInput: { companyKey, roles, locations, resultLimit: 10, cacheVersion: "v1" },
      company: {
        name: "Wealthfront Corporation",
        domain: input.domain === undefined ? "wealthfront.com" : input.domain,
        linkedinUrl: input.linkedinUrl ?? "https://www.linkedin.com/company/wealthfront"
      },
      emailFormat: emptyFormat,
      people: input.people ?? [person("wf-1")],
      nextPage: 2,
      pagesFetched: 1,
      exhausted: input.exhausted ?? false,
      provider: "APIFY",
      providerRunId: "run-1",
      providerDatasetId: "dataset-1"
    });
  }

  it("uses a Redis exact-intent payload without querying public Postgres", async () => {
    await ingest({ fingerprint: request().fingerprint });
    const databaseRead = vi.spyOn(prisma.discoverProviderBatch, "findMany");

    const result = await service.lookupReusableDataset(request());

    expect(result.storageHitType).toBe("REDIS");
    expect(result.dataset.people).toHaveLength(1);
    expect(databaseRead).not.toHaveBeenCalled();
  });

  it("falls back from a Redis miss to permanent Postgres and repopulates Redis", async () => {
    await ingest({ people: Array.from({ length: 10 }, (_, index) => person(`wf-${index}`)) });
    redis.clear();

    const result = await service.lookupReusableDataset(request());

    expect(result.storageHitType).toBe("DATABASE_POOL");
    expect(result.dataset.people).toHaveLength(10);
    expect(redis.values.size).toBeGreaterThan(0);
  });

  it("returns a partial durable dataset without requiring a provider top-up", async () => {
    await ingest({ people: [person("one"), person("two"), person("three")] });
    redis.clear();

    const result = await service.lookupReusableDataset(request());

    expect(result.dataset.people.map((value) => value.sourceProfileId)).toEqual(["one", "two", "three"]);
  });

  it("reuses a historical linkedin-key batch through its trusted official domain", async () => {
    await ingest({
      companyKey: "linkedin:wealthfront",
      domain: "wealthfront.com",
      linkedinUrl: "https://www.linkedin.com/company/wealthfront",
      people: [person("legacy")]
    });
    redis.clear();

    const result = await service.lookupReusableDataset(request());

    expect(result.dataset.people.map((value) => value.sourceProfileId)).toEqual(["legacy"]);
    expect(result.matchedCacheCompanyKey).toBe("linkedin:wealthfront");
    expect(result.legacyIdentityMatch).toBe(true);
  });

  it("never shares inferred email fields from durable public rows", async () => {
    await ingest();
    redis.clear();

    const [resultPerson] = (await service.lookupReusableDataset(request())).dataset.people;

    expect(resultPerson.inferredEmail).toBeNull();
    expect(resultPerson.emailPattern).toBeNull();
    expect(resultPerson.emailStatus).toBe("UNAVAILABLE");
  });

  it("keeps 365-day-old Postgres knowledge reusable", async () => {
    await ingest();
    prisma._state.discoverProviderBatches[0].createdAt = new Date("2025-09-20T12:00:00.000Z");
    redis.clear();

    const result = await service.lookupReusableDataset(request());

    expect(result.dataset.people).toHaveLength(1);
  });

  it("falls back to Postgres when Redis is unavailable", async () => {
    await ingest();
    const unavailable = {
      async get() { throw new Error("redis unavailable"); },
      async set() { throw new Error("redis unavailable"); },
      async incr() { throw new Error("redis unavailable"); }
    };
    const fallback = new DiscoverPublicKnowledgeService({
      prisma: prisma as unknown as PrismaClient,
      redis: unavailable,
      lock
    });

    const result = await fallback.lookupReusableDataset(request());

    expect(result.dataset.people).toHaveLength(1);
    expect(result.storageHitType).toBe("DATABASE_POOL");
  });

  it("does not merge the same display name across conflicting official domains", async () => {
    await ingest({ companyKey: "domain:wealthfront.com", domain: "wealthfront.com" });
    redis.clear();

    const result = await service.lookupReusableDataset(request({
      fingerprint: "domain-other-swe-us",
      fingerprintInput: {
        ...request().fingerprintInput,
        companyKey: "domain:other.example"
      },
      company: { name: "Wealthfront Corporation", domain: "other.example", linkedinUrl: null }
    }));

    expect(result.dataset.people).toHaveLength(0);
  });

  it("treats exact provider intent as authoritative with incomplete candidate geography", async () => {
    await ingest({
      fingerprint: request().fingerprint,
      people: [person("missing-location", { location: null, country: null, state: null, city: null })]
    });
    redis.clear();

    const result = await service.lookupReusableDataset(request({
      filterCompanyPoolPeople: () => []
    }));

    expect(result.dataset.people.map((value) => value.sourceProfileId)).toEqual(["missing-location"]);
    expect(result.exactIntentReuse).toBe(true);
  });

  it("uses strict geography matching when the new request is narrower", async () => {
    await ingest({ people: [person("missing-location", { location: null, country: null, state: null, city: null })] });
    redis.clear();
    const narrower = request({
      fingerprint: "domain-wealthfront-swe-sf",
      fingerprintInput: {
        ...request().fingerprintInput,
        locations: ["san francisco"]
      },
      filterCompanyPoolPeople: exactFilter({
        roles: [{ normalizedTitle: "software engineer", category: "SOFTWARE_ENGINEERING" }],
        locations: ["San Francisco"]
      })
    });

    expect((await service.lookupReusableDataset(narrower)).dataset.people).toHaveLength(0);
  });

  it("uses strict role matching for a different requested role", async () => {
    await ingest();
    redis.clear();
    const recruiter = request({
      fingerprint: "domain-wealthfront-recruiter-us",
      fingerprintInput: {
        ...request().fingerprintInput,
        roles: ["recruiter"]
      },
      filterCompanyPoolPeople: exactFilter({
        roles: [{ normalizedTitle: "recruiter", category: "RECRUITING" }],
        locations: ["United States"]
      })
    });

    expect((await service.lookupReusableDataset(recruiter)).dataset.people).toHaveLength(0);
  });

  it("persists a provider-backed zero so an identical retry does not rediscover", async () => {
    await ingest({ fingerprint: request().fingerprint, people: [], exhausted: true });

    const result = await service.lookupReusableDataset(request());

    expect(result.dataset.people).toHaveLength(0);
    expect(result.definitiveEmpty).toBe(true);
  });
});
