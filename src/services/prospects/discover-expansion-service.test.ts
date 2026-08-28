import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApifyProfileSearchService, type ApifyRunner } from "@/services/prospects/apify-profile-search";
import {
  DiscoverSearchCacheService,
  type DiscoverCacheLock
} from "@/services/prospects/discover-cache-service";
import { computeDiscoverFingerprint } from "@/services/prospects/discover-cache-fingerprint";
import {
  DiscoverRoleIntelligenceService,
  type DiscoverRoleIntelligencePort
} from "@/services/prospects/discover-role-intelligence-service";
import {
  DiscoverExpansionService,
  NO_MORE_PEOPLE_MESSAGE,
  expansionMessage,
  type ExpansionAuditFn
} from "@/services/prospects/discover-expansion-service";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";
import type { RoleEmbeddingPort } from "@/services/prospects/role-embedding-service";
import type { RoleSemanticStorePort } from "@/services/prospects/role-semantic-store";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import type { DiscoverQuotaReserver, DiscoverQuotaStatus } from "@/lib/discover-quota";

const USER_ID = "user_1";
const OTHER_USER = "user_2";
const COMPANY_ID = "company_1";
const SEARCH_ID = "search_1";
const ROLES = ["Software Engineer"];
const LOCATIONS = ["United States"];
const DAY_MS = 24 * 60 * 60 * 1000;

const QUOTA_RESET = new Date("2026-06-21T00:00:00.000Z");

function quotaStatus(used: number, limit: number, unlimited = false): DiscoverQuotaStatus {
  return {
    resultsPerSearch: 10,
    dailySearchLimit: limit,
    searchesUsed: used,
    searchesRemaining: Math.max(0, limit - used),
    resetAt: QUOTA_RESET,
    unlimited
  };
}

/** In-memory quota reserver: idempotent per (the passed) id, limited per user. */
function makeQuotaReserver(opts: { limit?: number; exemptEmails?: string[] } = {}) {
  const limit = opts.limit ?? 4;
  const exempt = new Set((opts.exemptEmails ?? []).map((email) => email.trim().toLowerCase()));
  const consumed = new Set<string>();
  const calls: Array<{ userId: string; email: string | null; searchId: string }> = [];
  const reserve: DiscoverQuotaReserver = async ({ userId, email, searchId }) => {
    calls.push({ userId, email, searchId });
    if (email && exempt.has(email.trim().toLowerCase())) {
      return { allowed: true, status: quotaStatus(0, limit, true) };
    }
    if (!consumed.has(searchId) && consumed.size >= limit) {
      return { allowed: false, status: quotaStatus(consumed.size, limit) };
    }
    consumed.add(searchId);
    return { allowed: true, status: quotaStatus(consumed.size, limit) };
  };
  // Read-only status that reflects what this reserver has consumed (no Redis).
  const status = async (email: string | null) => {
    if (email && exempt.has(email.trim().toLowerCase())) {
      return quotaStatus(0, limit, true);
    }
    return quotaStatus(consumed.size, limit);
  };
  return { reserve, status, calls, consumed };
}

function makeFakeLock(): DiscoverCacheLock {
  const held = new Map<string, string>();
  let counter = 0;
  return {
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
      if (held.get(key) === token) {
        held.delete(key);
      }
    }
  };
}

// A role classifier stub that never calls AI: everything is Software Engineering.
const roleClassifierStub = {
  async classify(titles: string[]) {
    return new Map(
      titles.map((title) => [
        normalizeTitle(title),
        { category: "SOFTWARE_ENGINEERING" as const, displayName: "Software Engineering", confidence: "HIGH" as const }
      ])
    );
  }
} as unknown as RoleClassificationService;

type RawProfile = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  headline: string;
  currentPosition: Array<{ title: string; companyName: string; companyLinkedinUrl?: string }>;
  linkedinUrl: string;
  location?: string;
};

function rawProfile(id: string, firstName: string, lastName: string, linkedinUrl?: string): RawProfile {
  return {
    id,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    headline: "Software Engineer",
    currentPosition: [{ title: "Software Engineer", companyName: "Apple" }],
    location: "United States",
    linkedinUrl: linkedinUrl ?? `https://www.linkedin.com/in/${id}`
  };
}

function rtxRawProfile(id: string, title: string): RawProfile {
  return {
    id,
    firstName: "RTX",
    lastName: id,
    fullName: `RTX ${id}`,
    headline: title,
    currentPosition: [
      {
        title,
        companyName: "RTX Corporation",
        companyLinkedinUrl: "https://www.linkedin.com/company/rtx/"
      }
    ],
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    location: "United States"
  };
}

function fingerprintFor() {
  return computeDiscoverFingerprint({
    company: {
      linkedinCompanyUrl: null,
      officialWebsiteDomain: "apple.com",
      officialDomain: "apple.com",
      normalizedName: "apple"
    },
    roles: ROLES,
    locations: LOCATIONS,
    resultLimit: 10,
    cacheVersion: "v1"
  });
}

let prisma: FakePrisma;

function seedCompany() {
  prisma._state.companies.push({
    id: COMPANY_ID,
    userId: USER_ID,
    name: "Apple",
    normalizedName: "apple",
    officialName: "Apple",
    officialDomain: "apple.com",
    officialWebsiteDomain: "apple.com",
    linkedinUrl: null,
    emailDomain: "apple.com",
    emailDomainConfidence: "HIGH",
    emailPattern: "flast",
    patternConfidence: "HIGH",
    emailDomainEvidence: [],
    patternEvidence: [],
    emailFormatReason: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

function seedSearch(overrides: Record<string, unknown> = {}) {
  prisma._state.searches.push({
    id: SEARCH_ID,
    userId: USER_ID,
    companyId: COMPANY_ID,
    requestedCompany: "Apple",
    requestedTitles: ROLES,
    requestedLocations: LOCATIONS,
    maxResults: 10,
    status: "READY",
    totalProcessed: 10,
    totalFound: 10,
    cacheFingerprint: fingerprintFor().fingerprint,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });
}

/** Seed N existing user-owned people (the "initial" batch already in the search). */
function seedExistingPeople(count: number) {
  prisma._state.positions.push({
    id: "position_se",
    companyId: COMPANY_ID,
    category: "SOFTWARE_ENGINEERING",
    displayName: "Software Engineering",
    rawTitles: ["Software Engineer"],
    createdAt: new Date(),
    updatedAt: new Date()
  });
  for (let i = 1; i <= count; i += 1) {
    prisma._state.people.push({
      id: `person_${i}`,
      userId: USER_ID,
      companyId: COMPANY_ID,
      positionId: "position_se",
      sourceProfileId: `init_${i}`,
      firstName: "Init",
      lastName: `User${i}`,
      fullName: `Init User${i}`,
      linkedinUrl: `https://www.linkedin.com/in/init_${i}`,
      currentTitle: "Software Engineer",
      normalizedTitle: "software engineer",
      inferredEmail: `iuser${i}@apple.com`,
      emailStatus: "INFERRED_HIGH",
      emailConfidence: "HIGH",
      emailPattern: "flast",
      emailSource: "PATTERN",
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }
}

/** Seed user-owned people that mirror specific cache people (so they overlap). */
function seedExistingFromCache(
  cacheList: Array<{ sourceProfileId: string; firstName: string; lastName: string; linkedinUrl?: string }>
) {
  prisma._state.positions.push({
    id: "position_se",
    companyId: COMPANY_ID,
    category: "SOFTWARE_ENGINEERING",
    displayName: "Software Engineering",
    rawTitles: ["Software Engineer"],
    createdAt: new Date(),
    updatedAt: new Date()
  });
  cacheList.forEach((person, index) => {
    prisma._state.people.push({
      id: `person_${index + 1}`,
      userId: USER_ID,
      companyId: COMPANY_ID,
      positionId: "position_se",
      sourceProfileId: person.sourceProfileId,
      firstName: person.firstName,
      lastName: person.lastName,
      fullName: `${person.firstName} ${person.lastName}`,
      linkedinUrl: person.linkedinUrl ?? `https://www.linkedin.com/in/${person.sourceProfileId}`,
      currentTitle: "Software Engineer",
      normalizedTitle: "software engineer",
      inferredEmail: `x${index}@apple.com`,
      emailStatus: "INFERRED_HIGH",
      emailConfidence: "HIGH",
      emailPattern: "flast",
      emailSource: "PATTERN",
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });
}

/** Seed a shared cache entry whose fingerprint matches the search. */
function seedCache(
  people: Array<{ sourceProfileId: string; firstName: string; lastName: string; linkedinUrl?: string }>,
  opts: { providerNextPage?: number; providerPagesFetched?: number; exhausted?: boolean } = {}
) {
  const { fingerprint } = fingerprintFor();
  prisma._state.discoverCache.push({
    id: "cache_seed",
    fingerprint,
    cacheVersion: "v1",
    companyKey: "domain:apple.com",
    companyName: "Apple",
    companyDomain: "apple.com",
    companyLinkedinUrl: null,
    normalizedRoles: [normalizeTitle("Software Engineer")],
    normalizedLocations: ["united states"],
    resultLimit: 10,
    status: "READY",
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    resultCount: people.length,
    providerNextPage: opts.providerNextPage ?? 2,
    providerPagesFetched: opts.providerPagesFetched ?? 1,
    providerExhausted: opts.exhausted ?? false,
    lastProviderFetchAt: new Date(),
    emailDomain: "apple.com",
    emailDomainConfidence: "HIGH",
    emailDomainEvidence: [],
    emailPattern: "flast",
    patternConfidence: "HIGH",
    patternEvidence: [],
    emailFormatReason: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  people.forEach((person, index) => {
    prisma._state.discoverCachePeople.push({
      id: `cp_${index}`,
      cacheId: "cache_seed",
      sortIndex: index,
      sourceProfileId: person.sourceProfileId,
      firstName: person.firstName,
      lastName: person.lastName,
      fullName: `${person.firstName} ${person.lastName}`,
      currentTitle: "Software Engineer",
      normalizedTitle: "software engineer",
      positionCategory: "SOFTWARE_ENGINEERING",
      location: "United States",
      country: "United States",
      state: null,
      city: null,
      linkedinUrl: person.linkedinUrl ?? `https://www.linkedin.com/in/${person.sourceProfileId}`,
      inferredEmail: null,
      emailStatus: "UNAVAILABLE",
      emailConfidence: "UNAVAILABLE",
      emailPattern: null,
      emailSource: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });
}

function rtxFingerprint() {
  return computeDiscoverFingerprint({
    company: {
      linkedinCompanyUrl: "https://www.linkedin.com/company/rtx/",
      officialWebsiteDomain: "rtx.com",
      officialDomain: "rtx.com",
      normalizedName: "rtx corporation"
    },
    roles: ROLES,
    locations: LOCATIONS,
    resultLimit: 10,
    cacheVersion: "v1"
  });
}

/** RTX 35-person target search plus three provider identities owned elsewhere. */
function seedRtxRegression() {
  const { fingerprint } = rtxFingerprint();
  prisma._state.companies.push({
    id: COMPANY_ID,
    userId: USER_ID,
    name: "RTX Corporation",
    normalizedName: "rtx corporation",
    officialName: "RTX Corporation",
    officialDomain: "rtx.com",
    officialWebsiteDomain: "rtx.com",
    linkedinUrl: "https://www.linkedin.com/company/rtx/",
    emailDomain: "rtx.com",
    emailDomainConfidence: "HIGH",
    emailPattern: "first.last",
    patternConfidence: "HIGH",
    emailDomainEvidence: [],
    patternEvidence: [],
    emailFormatReason: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  prisma._state.searches.push({
    id: SEARCH_ID,
    userId: USER_ID,
    companyId: COMPANY_ID,
    requestedCompany: "RTX Corporation",
    requestedTitles: ROLES,
    requestedLocations: LOCATIONS,
    maxResults: 10,
    status: "READY",
    totalProcessed: 35,
    totalFound: 35,
    cacheFingerprint: fingerprint,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  prisma._state.searches.push({
    id: "rtx_sibling_search",
    userId: USER_ID,
    companyId: COMPANY_ID,
    requestedCompany: "RTX Corporation",
    requestedTitles: ["Application Developer"],
    requestedLocations: LOCATIONS,
    maxResults: 10,
    status: "READY",
    totalProcessed: 3,
    totalFound: 3,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  prisma._state.positions.push({
    id: "position_se",
    companyId: COMPANY_ID,
    category: "SOFTWARE_ENGINEERING",
    displayName: "Software Engineering",
    rawTitles: ["Software Engineer"],
    createdAt: new Date(),
    updatedAt: new Date()
  });
  for (let index = 1; index <= 35; index += 1) {
    const personId = `rtx_person_${index}`;
    prisma._state.people.push({
      id: personId,
      userId: USER_ID,
      companyId: COMPANY_ID,
      positionId: "position_se",
      sourceProfileId: `rtx_initial_${index}`,
      firstName: "Initial",
      lastName: `RTX${index}`,
      fullName: `Initial RTX${index}`,
      linkedinUrl: `https://www.linkedin.com/in/rtx-initial-${index}`,
      currentTitle: "Software Engineer",
      normalizedTitle: "software engineer",
      inferredEmail: `initial.${index}@rtx.com`,
      emailStatus: "INFERRED_HIGH",
      emailConfidence: "HIGH",
      emailPattern: "first.last",
      emailSource: "PATTERN",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    prisma._state.searchPeople.push({
      id: `rtx_grant_${index}`,
      searchId: SEARCH_ID,
      personId,
      userId: USER_ID,
      allocationOrder: index - 1,
      allocationSource: "CACHE",
      allocatedAt: new Date()
    });
  }
  for (let index = 1; index <= 3; index += 1) {
    const personId = `rtx_existing_provider_${index}`;
    prisma._state.people.push({
      id: personId,
      userId: USER_ID,
      companyId: COMPANY_ID,
      positionId: "position_se",
      sourceProfileId: `rtx_new_${index}`,
      firstName: "RTX",
      lastName: `rtx_new_${index}`,
      fullName: `RTX rtx_new_${index}`,
      linkedinUrl: `https://www.linkedin.com/in/rtx_new_${index}`,
      currentTitle: "Software Engineer",
      normalizedTitle: "software engineer",
      inferredEmail: `existing.${index}@rtx.com`,
      emailStatus: "INFERRED_HIGH",
      emailConfidence: "HIGH",
      emailPattern: "first.last",
      emailSource: "PATTERN",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    prisma._state.searchPeople.push({
      id: `rtx_sibling_grant_${index}`,
      searchId: "rtx_sibling_search",
      personId,
      userId: USER_ID,
      allocationOrder: index - 1,
      allocationSource: "CACHE",
      allocatedAt: new Date()
    });
  }
  prisma._state.discoverCache.push({
    id: "cache_rtx",
    fingerprint,
    cacheVersion: "v1",
    companyKey: "linkedin:rtx",
    companyName: "RTX Corporation",
    companyDomain: "rtx.com",
    companyLinkedinUrl: "https://www.linkedin.com/company/rtx/",
    normalizedRoles: ["software engineer"],
    normalizedLocations: ["united states"],
    resultLimit: 10,
    status: "READY",
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    resultCount: 0,
    providerNextPage: 2,
    providerPagesFetched: 1,
    providerExhausted: false,
    lastProviderFetchAt: new Date(),
    emailDomain: "rtx.com",
    emailDomainConfidence: "HIGH",
    emailDomainEvidence: [],
    emailPattern: "first.last",
    patternConfidence: "HIGH",
    patternEvidence: [],
    emailFormatReason: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

/** Real enabled semantic service exercising its missing-vector safe fallback. */
function enabledSoftwareRoleIntelligence(): DiscoverRoleIntelligencePort {
  const unavailable = async (): Promise<never> => {
    throw new Error("semantic row unavailable");
  };
  const embeddings: RoleEmbeddingPort = {
    enabled: true,
    async embedTitles(titles) {
      return new Map(titles.map((title) => [title, Array.from({ length: 1536 }, () => 0.5)]));
    }
  };
  const store: RoleSemanticStorePort = {
    findByTitles: unavailable,
    findVectorsByTitles: unavailable,
    upsertMany: unavailable,
    findSimilarMany: unavailable
  };
  return new DiscoverRoleIntelligenceService(roleClassifierStub, embeddings, store, {
    enabled: true,
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    semanticVersion: "rtx-test-v1",
    maxApifyTitlesPerRole: 5,
    maxApifyTitlesTotal: 8
  });
}

function cachePeople(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    sourceProfileId: `${prefix}_${i + 1}`,
    firstName: prefix,
    lastName: `P${i + 1}`
  }));
}

function buildService(opts: {
  runner?: ApifyRunner;
  quota?: ReturnType<typeof makeQuotaReserver>;
  cache?: DiscoverSearchCacheService;
  expansionLock?: DiscoverCacheLock;
  batchSize?: number;
  maxProviderPages?: number;
  roleIntelligence?: DiscoverRoleIntelligencePort;
  audit?: ExpansionAuditFn;
} = {}) {
  const runner: ApifyRunner = opts.runner ?? { run: vi.fn(async () => ({ runId: null, datasetId: null, items: [] })) };
  const apify = new ApifyProfileSearchService({ token: "t", actorId: "actor", runner });
  const cache = opts.cache ?? new DiscoverSearchCacheService({ prisma: prisma as unknown as PrismaClient, lock: makeFakeLock() });
  const quota = opts.quota ?? makeQuotaReserver();
  const service = new DiscoverExpansionService({
    prisma: prisma as unknown as PrismaClient,
    apify,
    roleClassifier: roleClassifierStub,
    roleIntelligence: opts.roleIntelligence,
    cache,
    discoverQuota: quota.reserve,
    quotaStatus: (_userId, email) => quota.status(email),
    expansionLock: opts.expansionLock ?? makeFakeLock(),
    audit: opts.audit ?? (() => undefined),
    batchSize: opts.batchSize ?? 10,
    maxProviderPages: opts.maxProviderPages ?? 5
  });
  return { service, runner, quota };
}

beforeEach(() => {
  prisma = createFakePrisma();
});

describe("DiscoverExpansionService.addMorePeople", () => {
  it("materializes 10 unused cached people without calling Apify and consumes one slot (#1, #4, #5, #9, #10)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache(cachePeople("cache", 20)); // 20 cached, first 0 used by the user
    const quota = makeQuotaReserver();
    const { service, runner } = buildService({ quota });

    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "user@example.com",
      searchId: SEARCH_ID,
      idempotencyKey: "key-1"
    });

    expect(result.status).toBe("READY");
    expect(result.addedCount).toBe(10);
    expect(result.totalPeopleCount).toBe(20); // 10 existing + 10 new (#20)
    expect(runner.run).not.toHaveBeenCalled(); // cache covered it (#10)
    expect(quota.consumed.size).toBe(1); // exactly one slot (#4, #5)
    // People count on the search row increased (#20); no new history row (#27).
    expect(prisma._state.searches).toHaveLength(1);
    expect(prisma._state.searches[0].totalProcessed).toBe(20);
    // New people received inferred (never verified) emails (#25).
    const added = prisma._state.people.filter((p) => p.sourceProfileId.startsWith("cache_"));
    expect(added).toHaveLength(10);
    expect(added.every((p) => p.emailStatus === "INFERRED_HIGH")).toBe(true);
    expect(added.every((p) => p.emailStatus !== "VERIFIED")).toBe(true);
    // Classified into the Software Engineering role group (#24).
    expect(prisma._state.positions.some((p) => p.category === "SOFTWARE_ENGINEERING")).toBe(true);
  });

  it("requests a deeper provider prefix from the saved logical depth when the cache is short (#11, #14, #15)", async () => {
    seedCompany();
    seedSearch();
    const cached = cachePeople("cache", 15);
    // The user already owns the first 10 cached people, leaving only 5 unused.
    seedExistingFromCache(cached.slice(0, 10));
    seedCache(cached, { providerNextPage: 2 });
    const requestedDepths: number[] = [];
    const jobTitleInputs: string[][] = [];
    const runner: ApifyRunner = {
      run: vi.fn(async (_actorId, input) => {
        requestedDepths.push(input.maxItems);
        jobTitleInputs.push(input.currentJobTitles);
        // Logical page 2 requests a 20-profile prefix containing new profiles.
        return { runId: "r", datasetId: "d", items: Array.from({ length: 10 }, (_, i) => rawProfile(`prov_${i + 1}`, "Prov", `P${i + 1}`)) };
      })
    };
    const roleIntelligence: DiscoverRoleIntelligencePort = {
      enabled: true,
      filterAndRankPeople: async ({ people }) => [...people],
      buildProviderTitlePlan: async () => ["Software Engineer", "Software Developer", "Backend Software Engineer"],
      persistTitleKnowledge: async () => ({ existing: 0, created: 0, failed: false })
    };
    const { service } = buildService({ runner, roleIntelligence });

    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "user@example.com",
      searchId: SEARCH_ID,
      idempotencyKey: "key-2"
    });

    expect(result.addedCount).toBe(10); // 5 cached + 5 provider
    expect(requestedDepths).toEqual([20]);
    expect(jobTitleInputs).toEqual([["Software Engineer"]]);
    // The saved logical-depth cursor advanced after a valid fetch (#15).
    const cacheRow = prisma._state.discoverCache.find((r) => r.id === "cache_seed");
    expect(cacheRow?.providerNextPage).toBe(3);
  });

  it("keeps all 10 valid RTX Software Engineer-family results with semantic intelligence enabled (35 -> 45)", async () => {
    seedRtxRegression();
    const titles = [
      "Software Engineer",
      "Senior Software Engineer",
      "Staff Software Engineer",
      "Principal Software Engineer",
      "Principal Software Engineer / Architect",
      "Backend Software Engineer",
      "Frontend Software Engineer",
      "Application Developer",
      "Software Developer",
      "Platform Software Engineer"
    ];
    const providerItems = titles.map((title, index) => rtxRawProfile(`rtx_new_${index + 1}`, title));
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "rtx-run",
        datasetId: "rtx-dataset",
        items: providerItems,
        status: "SUCCEEDED"
      }))
    };
    const auditEvents: Array<Parameters<ExpansionAuditFn>[0]> = [];
    const { service } = buildService({
      runner,
      roleIntelligence: enabledSoftwareRoleIntelligence(),
      audit: (event) => {
        auditEvents.push(event);
      }
    });

    const beforePeople = prisma._state.people.length;
    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "user@example.com",
      searchId: SEARCH_ID,
      idempotencyKey: "rtx-35-to-45"
    });

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(providerItems).toHaveLength(10);
    expect(result).toMatchObject({ addedCount: 10, totalPeopleCount: 45, exhausted: false });
    const targetGrants = prisma._state.searchPeople.filter((row) => row.searchId === SEARCH_ID);
    expect(targetGrants).toHaveLength(45);
    expect(targetGrants.filter((row) => row.allocationSource === "ADD_MORE_PROVIDER")).toHaveLength(10);
    const updatedTotal = prisma._state.searches.find((row) => row.id === SEARCH_ID)?.totalProcessed;
    expect(updatedTotal).toBe(45);
    expect(targetGrants).toHaveLength(updatedTotal);
    expect(prisma._state.expansions[0]).toMatchObject({ addedCount: 10, totalPeopleCount: 45 });
    // Three identities already existed via a sibling search, so only seven new
    // ProspectPerson rows are created while all ten target grants are added.
    expect(prisma._state.people).toHaveLength(beforePeople + 7);
    for (let index = 1; index <= 10; index += 1) {
      expect(prisma._state.people.filter((row) => row.sourceProfileId === `rtx_new_${index}`)).toHaveLength(1);
    }

    const pageEvent = auditEvents.find((event) => event.action === "DISCOVER_EXPANSION_PROVIDER_PAGE_PROCESSED");
    expect(pageEvent?.metadata).toMatchObject({
      rawProviderCount: 10,
      normalizedProviderCount: 10,
      identityResolvedCount: 10,
      classifiedCount: 10,
      semanticAcceptedCount: 10,
      semanticRejectedCount: 0,
      cacheAppendedCount: 10,
      duplicateCount: 0,
      collectedCount: 10,
      page: 2,
      providerExhausted: false
    });
    const completedEvent = auditEvents.find((event) => event.action === "DISCOVER_EXPANSION_COMPLETED");
    expect(completedEvent?.metadata).toMatchObject({
      materializedCount: 10,
      allocationAddedCount: 10,
      finalAllocationCount: 45,
      totalPeopleCount: 45
    });
  });

  it("continues past true duplicates until it fills the requested batch (#12, #13)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache([], { providerNextPage: 2 }); // no unused cached
    const requestedDepths: number[] = [];
    const runner: ApifyRunner = {
      run: vi.fn(async (_actorId, input) => {
        requestedDepths.push(input.maxItems);
        if (input.maxItems === 20) {
          // Half duplicate an existing person (by source id), half are new.
          return {
            runId: "r",
            datasetId: "d",
            items: [
              rawProfile("init_1", "Init", "User1"), // duplicate of existing
              rawProfile("init_2", "Init", "User2"), // duplicate of existing
              ...Array.from({ length: 8 }, (_, i) => rawProfile(`new_${i + 1}`, "New", `P${i + 1}`))
            ]
          };
        }
        if (input.maxItems === 30) {
          return {
            runId: "r",
            datasetId: "d",
            items: [
              rawProfile("init_1", "Init", "User1"),
              rawProfile("init_2", "Init", "User2"),
              ...Array.from({ length: 10 }, (_, i) => rawProfile(`new_${i + 1}`, "New", `P${i + 1}`))
            ]
          };
        }
        return { runId: "r", datasetId: "d", items: [] };
      })
    };
    const { service } = buildService({ runner });

    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "user@example.com",
      searchId: SEARCH_ID,
      idempotencyKey: "key-3"
    });

    expect(result.addedCount).toBe(10);
    expect(requestedDepths).toEqual([20, 30]);
    expect(prisma._state.people.filter((p) => p.sourceProfileId.startsWith("init_"))).toHaveLength(10);
    expect(prisma._state.people.filter((p) => p.sourceProfileId.startsWith("new_"))).toHaveLength(10);
  });

  it.each([
    ["same-company derived", 0],
    ["historical backfill", 0]
  ])("continues a %s cache from logical depth 10 through duplicate legacy results", async (_source, providerPagesFetched) => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache([], { providerNextPage: 1, providerPagesFetched });
    const requestedDepths: number[] = [];
    const runner: ApifyRunner = {
      run: vi.fn(async (_actorId, input) => {
        requestedDepths.push(input.maxItems);
        if (input.maxItems === 10) {
          return {
            runId: "legacy-page-1",
            datasetId: "legacy-dataset-1",
            items: Array.from({ length: 10 }, (_, index) =>
              rawProfile(`init_${index + 1}`, "Initial", `User${index + 1}`)
            )
          };
        }
        return {
          runId: "legacy-page-2",
          datasetId: "legacy-dataset-2",
          items: [
            ...Array.from({ length: 10 }, (_, index) =>
              rawProfile(`init_${index + 1}`, "Initial", `User${index + 1}`)
            ),
            ...Array.from({ length: 10 }, (_, index) =>
              rawProfile(`legacy_new_${index + 1}`, "Legacy", `New${index + 1}`)
            )
          ]
        };
      })
    };
    const { service } = buildService({ runner });

    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "user@example.com",
      searchId: SEARCH_ID,
      idempotencyKey: `legacy-${_source}`
    });

    expect(result.addedCount).toBe(10);
    expect(requestedDepths).toEqual([10, 20]);
    expect(prisma._state.discoverCache.find((row) => row.id === "cache_seed")?.providerNextPage).toBe(3);
  });

  it("retrying the same expansion consumes no extra slot and adds no extra people (#6, #22)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache(cachePeople("cache", 20));
    const quota = makeQuotaReserver();
    const { service } = buildService({ quota });

    const first = await service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "same" });
    const second = await service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "same" });

    expect(first.addedCount).toBe(10);
    expect(second.addedCount).toBe(10);
    expect(second.id).toBe(first.id); // same expansion record
    expect(quota.consumed.size).toBe(1); // not charged twice (#6)
    expect(prisma._state.people.filter((p) => p.sourceProfileId.startsWith("cache_"))).toHaveLength(10); // no duplicate batch
    expect(prisma._state.searches[0].totalProcessed).toBe(20);
  });

  it("blocks the fifth daily operation for a regular user when the quota is four (#7)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache(cachePeople("cache", 80));
    const quota = makeQuotaReserver({ limit: 4 });
    // Pre-consume three slots (initial search + two expansions).
    await quota.reserve({ userId: USER_ID, email: "u@e.com", searchId: "prior_1" });
    await quota.reserve({ userId: USER_ID, email: "u@e.com", searchId: "prior_2" });
    await quota.reserve({ userId: USER_ID, email: "u@e.com", searchId: "prior_3" });
    const { service } = buildService({ quota });

    // Fourth (this expansion) is allowed.
    await service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "k4" });
    // Fifth is blocked.
    await expect(
      service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "k5" })
    ).rejects.toMatchObject({ code: "DISCOVER_DAILY_LIMIT_REACHED" });
  });

  it("keeps the internal exemption working (no slot consumed) (#8)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache(cachePeople("cache", 20));
    const quota = makeQuotaReserver({ limit: 4, exemptEmails: ["owner@example.com"] });
    const { service } = buildService({ quota });

    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "owner@example.com",
      searchId: SEARCH_ID,
      idempotencyKey: "exempt"
    });

    expect(result.addedCount).toBe(10);
    expect(quota.consumed.size).toBe(0); // exempt accounts never consume a slot
  });

  it("rejects a DRAFT or PROCESSING search (#2, #3)", async () => {
    seedCompany();
    const { service } = buildService();

    prisma._state.searches.push({
      id: "draft_search",
      userId: USER_ID,
      companyId: COMPANY_ID,
      requestedCompany: "Apple",
      requestedTitles: ROLES,
      requestedLocations: LOCATIONS,
      maxResults: 10,
      status: "DRAFT",
      totalProcessed: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await expect(
      service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: "draft_search", idempotencyKey: "d" })
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    prisma._state.searches.push({ ...prisma._state.searches[0], id: "processing_search", status: "SEARCHING_PEOPLE" });
    await expect(
      service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: "processing_search", idempotencyKey: "p" })
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("does not let a user expand another user's search (#26)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache(cachePeople("cache", 20));
    const { service } = buildService();

    await expect(
      service.addMorePeople({ userId: OTHER_USER, actorEmail: "x@e.com", searchId: SEARCH_ID, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("preserves existing people when provider continuation fails and allows a no-charge retry (#21, #22)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache([], { providerNextPage: 2 }); // no cache surplus → must call provider
    const quota = makeQuotaReserver();
    const runner: ApifyRunner = {
      run: vi.fn(async () => {
        throw new Error("Apify exploded");
      })
    };
    const { service } = buildService({ runner, quota });

    await expect(
      service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "fail" })
    ).rejects.toMatchObject({ code: "DISCOVER_EXPANSION_FAILED" });

    // Existing people + search count untouched (#21).
    expect(prisma._state.people).toHaveLength(10);
    expect(prisma._state.searches[0].totalProcessed).toBe(10);
    // The expansion is marked FAILED and the slot was already reserved.
    expect(prisma._state.expansions[0].status).toBe("FAILED");
    expect(quota.consumed.size).toBe(1);

    // A retry of the SAME expansion does not charge again (#22).
    const retryRunner: ApifyRunner = {
      run: vi.fn(async () => ({ runId: "r", datasetId: "d", items: Array.from({ length: 6 }, (_, i) => rawProfile(`retry_${i}`, "Retry", `${i}`)) }))
    };
    const apify = new ApifyProfileSearchService({ token: "t", actorId: "actor", runner: retryRunner });
    const retryService = new DiscoverExpansionService({
      prisma: prisma as unknown as PrismaClient,
      apify,
      roleClassifier: roleClassifierStub,
      cache: new DiscoverSearchCacheService({ prisma: prisma as unknown as PrismaClient, lock: makeFakeLock() }),
      discoverQuota: quota.reserve,
      quotaStatus: (_userId, email) => quota.status(email),
      expansionLock: makeFakeLock(),
      audit: () => undefined
    });
    const retry = await retryService.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "fail" });
    expect(retry.addedCount).toBe(6);
    expect(quota.consumed.size).toBe(1); // still one slot total
  });

  it("reports exhaustion when the provider runs out and blocks future expansion without charging (#23)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache([], { providerNextPage: 2 });
    const quota = makeQuotaReserver();
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({ runId: "r", datasetId: "d", items: [] })) // no more pages
    };
    const { service } = buildService({ runner, quota });

    const result = await service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "ex1" });
    expect(result.addedCount).toBe(0);
    expect(result.exhausted).toBe(true);
    expect(quota.consumed.size).toBe(1);
    const cacheRow = prisma._state.discoverCache.find((r) => r.id === "cache_seed");
    expect(cacheRow?.providerExhausted).toBe(true);

    // A follow-up expansion is a no-op that does NOT consume another slot.
    const second = await service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "ex2" });
    expect(second.addedCount).toBe(0);
    expect(second.exhausted).toBe(true);
    expect(quota.consumed.size).toBe(1); // unchanged
  });

  it("increases logical provider depth in bounded 10-row steps and never exceeds 120", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache([], { providerNextPage: 1, providerPagesFetched: 0 });
    const requestedDepths: number[] = [];
    const runner: ApifyRunner = {
      run: vi.fn(async (_actorId, input) => {
        requestedDepths.push(input.maxItems);
        // A valid but already allocated identity keeps the provider non-empty;
        // each deeper prefix is deduped until the 120 cap proves exhaustion.
        return {
          runId: `run-${input.maxItems}`,
          datasetId: `dataset-${input.maxItems}`,
          items: [rawProfile("init_1", "Init", "User1")],
          status: "SUCCEEDED"
        };
      })
    };
    const { service } = buildService({ runner, maxProviderPages: 12 });

    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "u@e.com",
      searchId: SEARCH_ID,
      idempotencyKey: "depth-cap"
    });

    expect(requestedDepths).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    expect(Math.max(...requestedDepths)).toBe(120);
    expect(result).toMatchObject({ addedCount: 0, exhausted: true });
    expect(prisma._state.discoverCache.find((row) => row.id === "cache_seed")?.providerExhausted).toBe(true);
  });

  it("treats a NO_RESULTS diagnostic as zero profiles and creates no cached person", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache([], { providerNextPage: 2 });
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "no-results-run",
        datasetId: "no-results-dataset",
        items: [{ ok: false, charged: false, recordType: "diagnostic", code: "NO_RESULTS" }],
        status: "SUCCEEDED"
      }))
    };
    const { service } = buildService({ runner });

    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "u@e.com",
      searchId: SEARCH_ID,
      idempotencyKey: "diagnostic-no-results"
    });

    expect(result).toMatchObject({ addedCount: 0, exhausted: true });
    expect(prisma._state.discoverCachePeople).toHaveLength(0);
  });

  it("does not permanently exhaust the cache on a temporary provider diagnostic", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache([], { providerNextPage: 2 });
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "refused-run",
        datasetId: "refused-dataset",
        items: [{ ok: false, charged: false, recordType: "diagnostic", code: "RATE_LIMITED" }],
        status: "SUCCEEDED"
      }))
    };
    const { service } = buildService({ runner });

    await expect(
      service.addMorePeople({
        userId: USER_ID,
        actorEmail: "u@e.com",
        searchId: SEARCH_ID,
        idempotencyKey: "diagnostic-refusal"
      })
    ).rejects.toMatchObject({ code: "DISCOVER_EXPANSION_FAILED" });

    expect(prisma._state.discoverCache.find((row) => row.id === "cache_seed")?.providerExhausted).toBe(false);
    expect(prisma._state.discoverCachePeople).toHaveLength(0);
  });

  it("does not dedupe two different people who share a name (#16)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache([], { providerNextPage: 2 });
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "r",
        datasetId: "d",
        items: [
          rawProfile("twin_a", "Sam", "Twin", "https://www.linkedin.com/in/sam-twin-a"),
          rawProfile("twin_b", "Sam", "Twin", "https://www.linkedin.com/in/sam-twin-b")
        ]
      }))
    };
    const { service } = buildService({ runner });

    const result = await service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "names" });
    expect(result.addedCount).toBe(2);
  });

  it("blocks a second active expansion for the same search (#18)", async () => {
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    seedCache(cachePeople("cache", 20));
    const expansionLock = makeFakeLock();
    const { service } = buildService({ expansionLock });

    // Hold the per-search expansion lock as if another request is mid-flight.
    const token = await expansionLock.acquire(`discover:expansion:${SEARCH_ID}`);
    expect(token).not.toBeNull();
    await expect(
      service.addMorePeople({ userId: USER_ID, actorEmail: "u@e.com", searchId: SEARCH_ID, idempotencyKey: "blocked" })
    ).rejects.toMatchObject({ code: "DISCOVER_EXPANSION_ALREADY_RUNNING" });
  });

  it("runs at most one provider continuation for two concurrent identical-query expansions (#19)", async () => {
    // Two different users, one shared cache service + provider lock.
    seedCompany();
    seedSearch();
    seedExistingPeople(10);
    // A company + ready search for the OTHER user with the SAME canonical query.
    prisma._state.companies.push({
      id: "company_2",
      userId: OTHER_USER,
      name: "Apple",
      normalizedName: "apple",
      officialName: "Apple",
      officialDomain: "apple.com",
      officialWebsiteDomain: "apple.com",
      linkedinUrl: null,
      emailDomain: "apple.com",
      emailDomainConfidence: "HIGH",
      emailPattern: "flast",
      patternConfidence: "HIGH",
      emailDomainEvidence: [],
      patternEvidence: [],
      emailFormatReason: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    prisma._state.searches.push({
      id: "search_2",
      userId: OTHER_USER,
      companyId: "company_2",
      requestedCompany: "Apple",
      requestedTitles: ROLES,
      requestedLocations: LOCATIONS,
      maxResults: 10,
      status: "READY",
      totalProcessed: 10,
      cacheFingerprint: fingerprintFor().fingerprint,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    seedCache([], { providerNextPage: 2 });

    let calls = 0;
    const runner: ApifyRunner = {
      run: vi.fn(async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { runId: "r", datasetId: "d", items: Array.from({ length: 20 }, (_, i) => rawProfile(`shared_${i + 1}`, "Shared", `${i + 1}`)) };
      })
    };
    const sharedCache = new DiscoverSearchCacheService({
      prisma: prisma as unknown as PrismaClient,
      lock: makeFakeLock(),
      waitTimeoutMs: 1000,
      pollIntervalMs: 5
    });
    const apify = new ApifyProfileSearchService({ token: "t", actorId: "actor", runner });
    const quotaA = makeQuotaReserver();
    const quotaB = makeQuotaReserver();
    const serviceA = new DiscoverExpansionService({ prisma: prisma as unknown as PrismaClient, apify, roleClassifier: roleClassifierStub, cache: sharedCache, discoverQuota: quotaA.reserve, quotaStatus: (_u, email) => quotaA.status(email), expansionLock: makeFakeLock(), audit: () => undefined });
    const serviceB = new DiscoverExpansionService({ prisma: prisma as unknown as PrismaClient, apify, roleClassifier: roleClassifierStub, cache: sharedCache, discoverQuota: quotaB.reserve, quotaStatus: (_u, email) => quotaB.status(email), expansionLock: makeFakeLock(), audit: () => undefined });

    const [a, b] = await Promise.all([
      serviceA.addMorePeople({ userId: USER_ID, actorEmail: "a@e.com", searchId: SEARCH_ID, idempotencyKey: "ca" }),
      serviceB.addMorePeople({ userId: OTHER_USER, actorEmail: "b@e.com", searchId: "search_2", idempotencyKey: "cb" })
    ]);

    expect(a.addedCount).toBe(10);
    expect(b.addedCount).toBe(10);
    expect(calls).toBe(1); // only one provider continuation ran (#19)
    // Each user consumed their own slot; neither sees the other's search.
    expect(quotaA.consumed.size).toBe(1);
    expect(quotaB.consumed.size).toBe(1);
  });
});

describe("expansionMessage", () => {
  it("reports a full batch", () => {
    expect(expansionMessage(10, 10, false)).toBe("10 new people were added.");
  });

  it("reports a partial batch when more may still exist", () => {
    expect(expansionMessage(6, 10, false)).toBe(
      "6 new people were added. No other unique matches were available in this batch."
    );
  });

  it("reports a partial batch when the search is now exhausted", () => {
    expect(expansionMessage(6, 10, true)).toBe(
      "6 new people were added. No more unique people are available for this search."
    );
  });

  it("reports when nothing new was found", () => {
    expect(expansionMessage(0, 10, true)).toBe(NO_MORE_PEOPLE_MESSAGE);
    expect(expansionMessage(0, 10, false)).toBe(NO_MORE_PEOPLE_MESSAGE);
  });
});

describe("DiscoverExpansionService allocation grants (role-targeted Add 10 more)", () => {
  const OTHER_SEARCH_ID = "search_recruiter";

  /** Grant the seeded initial people to a search (the post-allocation shape). */
  function seedGrants(searchId: string, personIds: string[]) {
    personIds.forEach((personId, index) => {
      prisma._state.searchPeople.push({
        id: `grant_${searchId}_${index}`,
        searchId,
        personId,
        userId: USER_ID,
        allocationOrder: index,
        allocationSource: "CACHE",
        allocatedAt: new Date()
      });
    });
  }

  it("adds grants to the TARGET search only — a sibling role search is untouched (#target-1, #target-2)", async () => {
    seedCompany();
    seedSearch();
    // A sibling recruiter search for the SAME company with its own allocation.
    prisma._state.searches.push({
      id: OTHER_SEARCH_ID,
      userId: USER_ID,
      companyId: COMPANY_ID,
      requestedCompany: "Apple",
      requestedTitles: ["Recruiter"],
      requestedLocations: LOCATIONS,
      maxResults: 10,
      status: "READY",
      totalProcessed: 1,
      totalFound: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    seedExistingPeople(10);
    seedGrants(SEARCH_ID, Array.from({ length: 10 }, (_, i) => `person_${i + 1}`));
    seedGrants(OTHER_SEARCH_ID, ["person_1"]);
    seedCache(cachePeople("cache", 20));
    const { service, runner } = buildService();

    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "user@example.com",
      searchId: SEARCH_ID,
      idempotencyKey: "key-grants"
    });

    expect(result.status).toBe("READY");
    expect(result.addedCount).toBe(10);
    expect(runner.run).not.toHaveBeenCalled();
    // The target search now holds 20 grants, all batch-ordered and cache-sourced.
    const targetGrants = prisma._state.searchPeople.filter((row) => row.searchId === SEARCH_ID);
    expect(targetGrants).toHaveLength(20);
    const added = targetGrants.filter((row) => row.allocationSource === "ADD_MORE_CACHE");
    expect(added).toHaveLength(10);
    expect([...added.map((row) => row.allocationOrder)].sort((a, b) => a - b)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19
    ]);
    // The recruiter search's allocation is exactly as it was.
    expect(prisma._state.searchPeople.filter((row) => row.searchId === OTHER_SEARCH_ID)).toHaveLength(1);
  });

  it("excludes only THIS search's grants, and never duplicates a person the user already owns (#target-3)", async () => {
    seedCompany();
    seedSearch({ totalProcessed: 1 });
    // The user owns cache person #1 via the sibling recruiter search only, and
    // cache person #11 via THIS search; both sit in the same cached pool.
    prisma._state.searches.push({
      id: OTHER_SEARCH_ID,
      userId: USER_ID,
      companyId: COMPANY_ID,
      requestedCompany: "Apple",
      requestedTitles: ["Recruiter"],
      requestedLocations: LOCATIONS,
      maxResults: 10,
      status: "READY",
      totalProcessed: 1,
      totalFound: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const cached = cachePeople("cache", 11);
    seedExistingFromCache([cached[0], cached[10]]); // person_1 = cache_1, person_2 = cache_11
    seedGrants(OTHER_SEARCH_ID, ["person_1"]);
    seedGrants(SEARCH_ID, ["person_2"]);
    seedCache(cached);
    const { service } = buildService();

    const result = await service.addMorePeople({
      userId: USER_ID,
      actorEmail: "user@example.com",
      searchId: SEARCH_ID,
      idempotencyKey: "key-overlap"
    });

    // Only THIS search's grant (cache person #11) is excluded — the sibling's
    // person is still granted here (it belongs to both role searches now)…
    expect(result.addedCount).toBe(10);
    expect(prisma._state.searchPeople.filter((row) => row.searchId === SEARCH_ID)).toHaveLength(11);
    // …but the user-owned person row is never duplicated (grouped union counts
    // the person once).
    expect(
      prisma._state.people.filter((person) => person.sourceProfileId === cached[0].sourceProfileId)
    ).toHaveLength(1);
  });
});
