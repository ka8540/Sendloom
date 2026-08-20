import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApifyProfileSearchService, type ApifyRunner } from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService } from "@/services/prospects/company-resolution-service";
import { EmailDomainService, type EmailEvidenceProvider } from "@/services/prospects/email-domain-service";
import { EmailFormatDiscoveryService } from "@/services/prospects/email-format-discovery-service";
import {
  OpenAIEmailFormatDiscoveryService,
  type EmailFormatWebSearchCaller
} from "@/services/prospects/openai-email-format-discovery";
import { ProspectSearchService } from "@/services/prospects/prospect-search-service";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";
import type { ValidatedCreateProspectSearch } from "@/services/prospects/prospect-validation";
import type { DiscoverQuotaReserver, DiscoverQuotaStatus } from "@/lib/discover-quota";
import {
  DiscoverSearchCacheService,
  type DiscoverCacheLock,
  type DiscoverCachePort,
  type GetOrRefreshParams,
  type ResolvedDataset
} from "@/services/prospects/discover-cache-service";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { createMockAi } from "@/services/prospects/__test-utils__/mock-ai";

// A passthrough cache that always runs the provider — keeps non-cache tests
// behaving exactly like the un-cached pipeline.
const passthroughCache: DiscoverCachePort = {
  async getOrRefresh({ provider }: GetOrRefreshParams) {
    const dataset = await provider();
    return { dataset, source: "PROVIDER", cacheId: null, fetchedAt: null, refreshedStale: false };
  }
};

function makeFakeCacheLock(): DiscoverCacheLock {
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

const QUOTA_RESET = new Date("2026-06-20T00:00:00.000Z");

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

/**
 * In-memory stand-in for the Redis-backed quota: idempotent per search id,
 * limited per user, with an exempt-email allowlist — enough to drive the
 * service's quota branch without touching Redis.
 */
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
  return { reserve, calls, consumed };
}

// Default permissive reserver so non-quota tests never reach Redis.
const allowAllQuota: DiscoverQuotaReserver = async () => ({ allowed: true, status: quotaStatus(1, 4) });

// Enable the AI web-search discovery gate for the discovery tests below.
process.env.OPENAI_API_KEY = "sk-test";
process.env.PROSPECT_AI_ENABLED = "true";
process.env.PROSPECT_EMAIL_DISCOVERY_PROVIDER = "openai_web_search";
process.env.PROSPECT_EMAIL_FORMAT_WEB_SEARCH_ENABLED = "true";
process.env.PROSPECT_AI_MAX_PATTERN_CALLS_PER_SEARCH = "1";

const USER_ID = "user_1";

const VALIDATED: ValidatedCreateProspectSearch = {
  companyName: "Apple",
  companyDomain: "apple.com", // deterministic resolution -> no company AI call
  companyLinkedinUrl: null,
  jobTitles: ["Software Engineer", "Backend Engineer", "Technical Recruiter", "Data Analyst", "Quantum Mechanic"],
  locations: ["United States"],
  maxResults: 25
};

const APPLIED_MATERIALS: ValidatedCreateProspectSearch = {
  companyName: "Applied Materials",
  companyDomain: "appliedmaterials.com",
  companyLinkedinUrl: null,
  jobTitles: ["Software Engineer"],
  locations: ["United States"],
  maxResults: 10
};

const ESRI: ValidatedCreateProspectSearch = {
  companyName: "Esri",
  companyDomain: "esri.com",
  companyLinkedinUrl: null,
  jobTitles: ["Software Engineer"],
  locations: ["United States"],
  maxResults: 10
};

const ESRI_ROCKETREACH_TEXT = `
The most common Esri email format is [first_initial][last] (ex. jdoe@esri.com), which is being used by 84.7% of Esri work email addresses.

Email Format | Example | Percentage
[first_initial][last] | jdoe@esri.com | 84.7%
[first][last] | janedoe@esri.com | 6.3%
[first]_[last] | jane_doe@esri.com | 1.9%
`;

function profile(id: string, firstName: string, lastName: string, title: string, companyName = "Apple") {
  return {
    id,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    headline: title,
    currentPosition: [{ title, companyName }],
    linkedinUrl: `https://www.linkedin.com/in/${id}`
  };
}

const PROFILES = [
  profile("1", "Jane", "Doe", "Software Engineer"),
  profile("2", "John", "Smith", "Backend Engineer"),
  profile("3", "Maria", "Lee", "Technical Recruiter"),
  profile("4", "Raj", "Patel", "Data Analyst"),
  profile("5", "Zoe", "Park", "Quantum Mechanic")
];

function buildService(
  prisma: FakePrisma,
  runner: ApifyRunner,
  aiResponses: Parameters<typeof createMockAi>[0],
  evidenceProvider?: EmailEvidenceProvider,
  discoverQuota: DiscoverQuotaReserver = allowAllQuota,
  discoverCache: DiscoverCachePort = passthroughCache
) {
  const ai = createMockAi(aiResponses);
  const apify = new ApifyProfileSearchService({ token: "t", actorId: "actor", runner });
  const service = new ProspectSearchService({
    prisma: prisma as unknown as PrismaClient,
    apify,
    companyResolution: new CompanyResolutionService(ai.client),
    roleClassifier: new RoleClassificationService(prisma as unknown as PrismaClient, ai.client),
    emailDomain: new EmailDomainService(prisma as unknown as PrismaClient, ai.client, evidenceProvider),
    discoverQuota,
    discoverCache
  });
  return { service, ai };
}

const AI_RESPONSES = {
  responses: {
    role_classification: {
      classifications: [
        { rawTitle: "Quantum Mechanic", normalizedTitle: "quantum mechanic", category: "OTHER", displayName: "Other", confidence: "LOW" }
      ]
    },
    email_pattern: {
      selectedEmailDomain: "apple.com",
      selectedPattern: "flast",
      confidence: "MEDIUM",
      decisionCode: "SOURCE_MAJORITY",
      evidenceIndexesUsed: [0, 1]
    }
  }
};

let prisma: FakePrisma;

beforeEach(() => {
  prisma = createFakePrisma();
});

describe("ProspectSearchService pipeline", () => {
  it("rejects malformed create input before any ProspectSearch write", async () => {
    const run = vi.fn<ApifyRunner["run"]>();
    const { service } = buildService(prisma, { run } as ApifyRunner, AI_RESPONSES);

    await expect(
      service.createSearch(USER_ID, { ...VALIDATED, locations: ["Un"] })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(prisma._state.searches).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("stores only canonical role/location values at the create boundary", async () => {
    const { service } = buildService(prisma, { run: vi.fn() } as ApifyRunner, AI_RESPONSES);

    const created = await service.createSearch(USER_ID, {
      ...VALIDATED,
      jobTitles: ["Softwre Engineer", "Recrutier"],
      locations: ["united states"]
    });

    expect(created.requestedTitles).toEqual(["Software Engineer", "Recruiter"]);
    expect(created.requestedLocations).toEqual(["United States"]);
  });

  it("blocks a polluted legacy draft before quota, cache, or provider work", async () => {
    const run = vi.fn<ApifyRunner["run"]>();
    const quota = makeQuotaReserver();
    const { service } = buildService(prisma, { run } as ApifyRunner, AI_RESPONSES, undefined, quota.reserve);
    prisma._state.searches.push({
      id: "legacy-un",
      userId: USER_ID,
      companyId: null,
      requestedCompany: "Apple",
      requestedDomain: "apple.com",
      requestedLinkedin: null,
      requestedTitles: ["Recruiter"],
      requestedLocations: ["Un"],
      maxResults: 10,
      status: "DRAFT",
      totalFound: 0,
      totalProcessed: 0,
      attemptCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await expect(service.processSearch(USER_ID, "legacy-un")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(quota.calls).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
    expect(prisma._state.searches).toHaveLength(1);
    expect(prisma._state.searches[0].status).toBe("DRAFT");
  });

  it("builds the Company -> Positions -> People graph end to end", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({ runId: "run1", datasetId: "ds1", items: PROFILES }))
    };
    const evidenceProvider: EmailEvidenceProvider = {
      async findEvidence() {
        return {
          domainEvidence: [
            {
              emailDomain: "apple.com",
              sourceName: "public format page",
              sourceUrl: "https://example.test/apple-email-format",
              sourceType: "public_format_page",
              observedPattern: "flast",
              percentage: 82,
              confidence: "MEDIUM",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ],
          patternEvidence: [
            {
              pattern: "flast",
              emailDomain: "apple.com",
              percentage: 82,
              sourceName: "public format page",
              sourceUrl: "https://example.test/apple-email-format",
              sourceType: "public_format_page",
              confidence: "MEDIUM",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ]
        };
      }
    };
    const { service, ai } = buildService(prisma, runner, AI_RESPONSES, evidenceProvider);

    const created = await service.createSearch(USER_ID, VALIDATED);
    const result = await service.processSearch(USER_ID, created.id);

    expect(result.status).toBe("READY"); // (#27)
    expect(result.totalProcessed).toBe(5);

    // One company resolved deterministically from the provided domain.
    const company = prisma._state.companies[0];
    expect(company.officialDomain).toBe("apple.com");
    expect(company.officialWebsiteDomain).toBe("apple.com");
    expect(company.emailDomain).toBe("apple.com");
    expect(company.emailPattern).toBe("flast");

    // Positions upserted, one per category that has people (#14).
    const categories = prisma._state.positions.map((p) => p.category).sort();
    expect(categories).toEqual(["DATA_ANALYTICS", "OTHER", "RECRUITING", "SOFTWARE_ENGINEERING"]);

    // People assigned to the correct position node (#15).
    const positionByCategory = new Map(prisma._state.positions.map((p) => [p.category, p.id]));
    const jane = prisma._state.people.find((p) => p.firstName === "Jane")!;
    const maria = prisma._state.people.find((p) => p.firstName === "Maria")!;
    const zoe = prisma._state.people.find((p) => p.firstName === "Zoe")!;
    expect(jane.positionId).toBe(positionByCategory.get("SOFTWARE_ENGINEERING"));
    expect(maria.positionId).toBe(positionByCategory.get("RECRUITING"));
    expect(zoe.positionId).toBe(positionByCategory.get("OTHER"));

    // Deterministic email generation (#17) and never VERIFIED (#20).
    expect(jane.inferredEmail).toBe("jdoe@apple.com");
    expect(jane.emailStatus).toBe("INFERRED_MEDIUM");
    expect(prisma._state.people.every((p) => p.emailStatus !== "VERIFIED")).toBe(true);

    // AI is used only where deterministic code cannot decide: company and
    // format resolve without AI, while roles are still classified once.
    expect(ai.callsOfType("company_resolution")).toHaveLength(0);
    expect(ai.callsOfType("role_classification")).toHaveLength(1);
    expect(ai.callsOfType("email_pattern")).toHaveLength(0);
    expect(ai.calls).toHaveLength(1);
  });

  it("keeps Applied Materials website and email domain separate when evidence supports amat.com", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "run-amat",
        datasetId: "ds-amat",
        items: [profile("jane", "Jane", "Doe", "Software Engineer", "Applied Materials")]
      }))
    };
    const evidenceProvider: EmailEvidenceProvider = {
      async findEvidence() {
        return {
          domainEvidence: [
            {
              emailDomain: "amat.com",
              sourceName: "Applied Materials email format page",
              sourceUrl: "https://example.test/applied-materials-email-format",
              sourceType: "public_format_page",
              observedPattern: "first_last",
              percentage: 91,
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ],
          patternEvidence: [
            {
              pattern: "first_last",
              emailDomain: "amat.com",
              percentage: 91,
              sourceName: "Applied Materials email format page",
              sourceUrl: "https://example.test/applied-materials-email-format",
              sourceType: "public_format_page",
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ]
        };
      }
    };
    const { service } = buildService(
      prisma,
      runner,
      {
        responses: {
          role_classification: { classifications: [] },
          email_pattern: {
            selectedEmailDomain: "amat.com",
            selectedPattern: "first_last",
            confidence: "HIGH",
            decisionCode: "SOURCE_MAJORITY",
            evidenceIndexesUsed: [0, 1]
          }
        }
      },
      evidenceProvider
    );

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id);

    const company = prisma._state.companies[0];
    expect(company.officialWebsiteDomain).toBe("appliedmaterials.com");
    expect(company.officialDomain).toBe("appliedmaterials.com");
    expect(company.emailDomain).toBe("amat.com");
    expect(company.emailPattern).toBe("first_last");

    const jane = prisma._state.people.find((p) => p.firstName === "Jane")!;
    expect(jane.inferredEmail).toBe("jane_doe@amat.com");
    expect(jane.emailStatus).toBe("INFERRED_HIGH");
    expect(jane.emailStatus).not.toBe("VERIFIED");
  });

  it("does not generate emails when only a website domain exists without email-domain evidence", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "run1",
        datasetId: "ds1",
        items: [profile("1", "Jane", "Doe", "Software Engineer", "Applied Materials")]
      }))
    };
    const { service, ai } = buildService(prisma, runner, {
      responses: { role_classification: { classifications: [] } }
    });

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id);

    const company = prisma._state.companies[0];
    expect(company.officialWebsiteDomain).toBe("appliedmaterials.com");
    expect(company.emailDomain).toBeNull();
    expect(company.emailPattern).toBeNull();
    expect(ai.callsOfType("email_pattern")).toHaveLength(0);

    const jane = prisma._state.people.find((p) => p.firstName === "Jane")!;
    expect(jane.inferredEmail).toBeNull();
    expect(jane.emailStatus).toBe("UNAVAILABLE");
    expect(jane.emailConfidence).toBe("UNAVAILABLE");
  });

  it("fails before Apify when company resolution has no website or LinkedIn anchor", async () => {
    const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: null, datasetId: null, items: [] })) };
    const { service } = buildService(prisma, runner, { enabled: false });

    const created = await service.createSearch(USER_ID, {
      ...VALIDATED,
      companyName: "Unresolved Co",
      companyDomain: null,
      companyLinkedinUrl: null
    });
    const result = await service.processSearch(USER_ID, created.id);

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("COMPANY_UNRESOLVED");
    expect(runner.run).not.toHaveBeenCalled();
    expect(prisma._state.companies).toHaveLength(0);
  });

  it("manual override regenerates existing inferred emails without marking them verified", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "run1",
        datasetId: "ds1",
        items: [profile("1", "Jane", "Doe", "Software Engineer", "Applied Materials")]
      }))
    };
    const { service } = buildService(prisma, runner, {
      responses: { role_classification: { classifications: [] } }
    });

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id);
    const company = prisma._state.companies[0];

    await service.setCompanyEmailInferenceOverride(USER_ID, {
      companyId: company.id,
      emailDomain: "amat.com",
      emailPattern: "first_last",
      confidence: "HIGH",
      reason: "Manual correction based on verified company email-format evidence"
    });

    const updatedCompany = prisma._state.companies[0];
    expect(updatedCompany.emailDomain).toBe("amat.com");
    expect(updatedCompany.emailPattern).toBe("first_last");
    expect(updatedCompany.emailDomainEvidence[0].sourceType).toBe("manual_override");

    const jane = prisma._state.people.find((p) => p.firstName === "Jane")!;
    expect(jane.inferredEmail).toBe("jane_doe@amat.com");
    expect(jane.emailStatus).toBe("INFERRED_HIGH");
    expect(jane.emailStatus).not.toBe("VERIFIED");
  });

  it("refreshes a company email format from a direct RocketReach-style source URL", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "run-esri",
        datasetId: "ds-esri",
        items: [profile("jane", "Jane", "Doe", "Software Engineer", "Esri")]
      }))
    };
    const fetchPage = vi.fn(async () => ESRI_ROCKETREACH_TEXT);
    const ai = createMockAi({
      responses: {
        role_classification: { classifications: [] },
        email_pattern: {
          selectedEmailDomain: "esri.com",
          selectedPattern: "flast",
          confidence: "HIGH",
          decisionCode: "SOURCE_MAJORITY",
          evidenceIndexesUsed: [0, 1]
        }
      }
    });
    const service = new ProspectSearchService({
      prisma: prisma as unknown as PrismaClient,
      apify: new ApifyProfileSearchService({ token: "t", actorId: "actor", runner }),
      companyResolution: new CompanyResolutionService(ai.client),
      roleClassifier: new RoleClassificationService(prisma as unknown as PrismaClient, ai.client),
      emailDomain: new EmailDomainService(
        prisma as unknown as PrismaClient,
        ai.client,
        new EmailFormatDiscoveryService({ searchProvider: null, fetchPage })
      ),
      discoverQuota: allowAllQuota,
      discoverCache: passthroughCache
    });

    const created = await service.createSearch(USER_ID, ESRI);
    await service.processSearch(USER_ID, created.id);
    const company = prisma._state.companies[0];
    expect(prisma._state.people[0].inferredEmail).toBeNull();

    await service.refreshCompanyEmailFormat(
      USER_ID,
      company.id,
      "https://rocketreach.co/esri-email-format_b5c60d6df42e0c51"
    );

    expect(fetchPage).toHaveBeenCalledWith("https://rocketreach.co/esri-email-format_b5c60d6df42e0c51");
    expect(prisma._state.companies[0].emailDomain).toBe("esri.com");
    expect(prisma._state.companies[0].emailPattern).toBe("flast");
    expect(prisma._state.companies[0].patternConfidence).toBe("HIGH");
    expect(prisma._state.people[0].inferredEmail).toBe("jdoe@esri.com");
    expect(prisma._state.people[0].emailStatus).toBe("INFERRED_HIGH");
    expect(prisma._state.people[0].emailStatus).not.toBe("VERIFIED");
  });

  it("deletes an owned company graph and its related searches", async () => {
    prisma._state.companies.push({
      id: "company_1",
      userId: USER_ID,
      name: "Apple",
      normalizedName: "apple",
      officialName: "Apple Inc.",
      officialDomain: "apple.com",
      officialWebsiteDomain: "apple.com",
      emailDomainConfidence: "UNAVAILABLE",
      patternConfidence: "UNAVAILABLE",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    prisma._state.positions.push({
      id: "position_1",
      companyId: "company_1",
      category: "SOFTWARE_ENGINEERING",
      displayName: "Software Engineering",
      rawTitles: ["Software Engineer"],
      createdAt: new Date(),
      updatedAt: new Date()
    });
    prisma._state.people.push({
      id: "person_1",
      userId: USER_ID,
      companyId: "company_1",
      positionId: "position_1",
      sourceProfileId: "profile_1",
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      linkedinUrl: "https://www.linkedin.com/in/jane",
      emailStatus: "UNAVAILABLE",
      emailConfidence: "UNAVAILABLE",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    prisma._state.searches.push({
      id: "search_1",
      userId: USER_ID,
      companyId: "company_1",
      requestedCompany: "Apple",
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      maxResults: 25,
      status: "READY",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    prisma._state.searches.push({
      id: "search_other",
      userId: USER_ID,
      companyId: "company_other",
      requestedCompany: "Other",
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      maxResults: 25,
      status: "READY",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: null, datasetId: null, items: [] })) };
    const { service } = buildService(prisma, runner, { enabled: false });

    await expect(service.deleteCompany(USER_ID, "company_1")).resolves.toBe(true);

    expect(prisma._state.companies).toHaveLength(0);
    expect(prisma._state.positions).toHaveLength(0);
    expect(prisma._state.people).toHaveLength(0);
    expect(prisma._state.searches.map((row) => row.id)).toEqual(["search_other"]);
  });

  it("returns a structured FAILED search when the provider throws (#26)", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => {
        throw new Error("Apify run failed");
      })
    };
    const { service } = buildService(prisma, runner, AI_RESPONSES);

    const created = await service.createSearch(USER_ID, VALIDATED);
    const result = await service.processSearch(USER_ID, created.id);

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("PROVIDER_ERROR");
    expect(result.errorMessage).toContain("Apify run failed");
  });

  it("marks the search FAILED with a clear message when Apify hits the free-tier run limit", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "run-limited",
        datasetId: null,
        items: [],
        status: "SUCCEEDED",
        statusMessage: "free user run limit reached"
      }))
    };
    const { service } = buildService(prisma, runner, AI_RESPONSES);

    const created = await service.createSearch(USER_ID, VALIDATED);
    const result = await service.processSearch(USER_ID, created.id);

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("PROVIDER_ERROR");
    expect(result.errorMessage).toMatch(/free user run limit reached/i);
    // No company graph is persisted from a failed profile search.
    expect(prisma._state.people).toHaveLength(0);
  });

  it("rejects processing a search owned by another user", async () => {
    const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: null, datasetId: null, items: [] })) };
    const { service } = buildService(prisma, runner, AI_RESPONSES);
    const created = await service.createSearch(USER_ID, VALIDATED);

    await expect(service.processSearch("someone_else", created.id)).rejects.toThrow(/not found/i);
  });

  it("rejects refreshing a company owned by another user", async () => {
    const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: null, datasetId: null, items: [] })) };
    const { service } = buildService(prisma, runner, AI_RESPONSES);
    prisma._state.companies.push({
      id: "company_1",
      userId: USER_ID,
      name: "Esri",
      normalizedName: "esri",
      officialName: "Esri",
      officialDomain: "esri.com",
      officialWebsiteDomain: "esri.com",
      emailDomainConfidence: "UNAVAILABLE",
      patternConfidence: "UNAVAILABLE",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await expect(service.refreshCompanyEmailFormat("someone_else", "company_1")).rejects.toThrow(/company not found/i);
  });
});

const APPLIED_MATERIALS_RAW = {
  selectedEmailDomain: "amat.com",
  selectedPattern: "first_last",
  domainConfidence: "HIGH",
  patternConfidence: "HIGH",
  supportingSources: [
    {
      label: "RocketReach",
      url: "https://rocketreach.co/applied-materials-email-format",
      sourceType: "rocketreach",
      claimedDomain: "amat.com",
      claimedPattern: "first_last",
      percentage: 84.7,
      exampleEmail: "jane_doe@amat.com",
    }
  ],
  conflictingSourceCount: 0,
  decisionCode: "VERIFIED_EXAMPLE"
};

const ESRI_RAW = {
  selectedEmailDomain: "esri.com",
  selectedPattern: "flast",
  domainConfidence: "HIGH",
  patternConfidence: "HIGH",
  supportingSources: [
    {
      label: "RocketReach",
      url: "https://rocketreach.co/esri-email-format",
      sourceType: "rocketreach",
      claimedDomain: "esri.com",
      claimedPattern: "flast",
      percentage: 84.7,
      exampleEmail: "jdoe@esri.com",
    }
  ],
  conflictingSourceCount: 0,
  decisionCode: "VERIFIED_EXAMPLE"
};

function discoveryCaller(response: unknown): EmailFormatWebSearchCaller & { search: ReturnType<typeof vi.fn> } {
  return { enabled: true, model: "gpt-5.5", search: vi.fn(async () => response) };
}

function buildDiscoverService(
  prismaState: FakePrisma,
  options: {
    caller?: EmailFormatWebSearchCaller | null;
    rateLimiter?: (userId: string) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
    aiResponse?: unknown;
  } = {}
) {
  const ai = createMockAi({
    responses: {
      role_classification: { classifications: [] },
      ...(options.aiResponse === undefined ? {} : { email_pattern: options.aiResponse })
    }
  });
  const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: null, datasetId: null, items: [] })) };
  const evidence = options.caller ? new OpenAIEmailFormatDiscoveryService({ caller: options.caller }) : undefined;
  const service = new ProspectSearchService({
    prisma: prismaState as unknown as PrismaClient,
    apify: new ApifyProfileSearchService({ token: "t", actorId: "actor", runner }),
    companyResolution: new CompanyResolutionService(ai.client),
    roleClassifier: new RoleClassificationService(prismaState as unknown as PrismaClient, ai.client),
    emailDomain: new EmailDomainService(prismaState as unknown as PrismaClient, ai.client, evidence),
    emailFormatRateLimiter: options.rateLimiter ?? (async () => ({ allowed: true, retryAfterSeconds: 0 }))
  });
  return { service, ai };
}

function seedDiscoverCompany(prismaState: FakePrisma, overrides: Record<string, unknown> = {}) {
  const row = {
    id: "company_amat",
    userId: USER_ID,
    name: "Applied Materials",
    normalizedName: "applied materials",
    officialName: "Applied Materials, Inc.",
    officialDomain: "appliedmaterials.com",
    officialWebsiteDomain: "appliedmaterials.com",
    officialWebsite: "https://www.appliedmaterials.com",
    linkedinUrl: null,
    domainConfidence: "HIGH",
    emailDomain: null,
    emailDomainConfidence: "UNAVAILABLE",
    emailDomainEvidence: null,
    emailPattern: null,
    patternConfidence: "UNAVAILABLE",
    patternEvidence: null,
    emailFormatReason: null,
    emailFormatDiscoveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
  prismaState._state.companies.push(row);
  return row;
}

function seedPerson(prismaState: FakePrisma, companyId: string, id: string, firstName: string, lastName: string) {
  prismaState._state.people.push({
    id,
    userId: USER_ID,
    companyId,
    positionId: "position_1",
    sourceProfileId: id,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    inferredEmail: null,
    emailStatus: "UNAVAILABLE",
    emailConfidence: "UNAVAILABLE",
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

describe("ProspectSearchService AI email-format discovery", () => {
  beforeEach(() => {
    prisma = createFakePrisma();
  });

  it("discovers Applied Materials' amat.com / first_last with AI web search and regenerates inferred emails (#7, #14, #15)", async () => {
    const company = seedDiscoverCompany(prisma);
    seedPerson(prisma, company.id, "p1", "Jane", "Doe");
    seedPerson(prisma, company.id, "p2", "John", "Smith");
    const caller = discoveryCaller(APPLIED_MATERIALS_RAW);
    const { service } = buildDiscoverService(prisma, { caller });

    await service.discoverCompanyEmailFormat(USER_ID, company.id);

    const updated = prisma._state.companies[0];
    expect(updated.emailDomain).toBe("amat.com");
    expect(updated.emailPattern).toBe("first_last");
    expect(updated.officialWebsiteDomain).toBe("appliedmaterials.com"); // website domain unchanged
    expect(JSON.parse(String(updated.emailFormatReason))).toMatchObject({
      version: "structured-v2",
      decisionCode: "VERIFIED_EXAMPLE",
      supportingSourceCount: 1,
      conflictingSourceCount: 0
    });
    expect(updated.emailFormatDiscoveredAt).toBeInstanceOf(Date);

    const jane = prisma._state.people.find((p) => p.firstName === "Jane")!;
    expect(jane.inferredEmail).toBe("jane_doe@amat.com");
    expect(jane.emailStatus).toMatch(/^INFERRED_(HIGH|MEDIUM)$/);
    expect(jane.emailStatus).not.toBe("VERIFIED");

    // #9: AI runs once per company, not once per person.
    expect(caller.search).toHaveBeenCalledTimes(1);
  });

  it("resolves Esri to esri.com / flast (#8)", async () => {
    const company = seedDiscoverCompany(prisma, {
      id: "company_esri",
      name: "Esri",
      normalizedName: "esri",
      officialName: "Esri",
      officialDomain: "esri.com",
      officialWebsiteDomain: "esri.com"
    });
    seedPerson(prisma, company.id, "p1", "Jane", "Doe");
    const { service } = buildDiscoverService(prisma, { caller: discoveryCaller(ESRI_RAW) });

    await service.discoverCompanyEmailFormat(USER_ID, company.id);

    expect(prisma._state.companies[0].emailDomain).toBe("esri.com");
    expect(prisma._state.companies[0].emailPattern).toBe("flast");
    expect(prisma._state.people[0].inferredEmail).toBe("jdoe@esri.com");
  });

  it("serves a fresh high-confidence format from cache without paying for AI (#10)", async () => {
    const company = seedDiscoverCompany(prisma, {
      emailDomain: "amat.com",
      emailDomainConfidence: "HIGH",
      emailPattern: "first_last",
      patternConfidence: "HIGH",
      emailFormatDiscoveredAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1_000)
    });
    seedPerson(prisma, company.id, "p1", "Jane", "Doe");
    const caller = discoveryCaller(APPLIED_MATERIALS_RAW);
    const { service } = buildDiscoverService(prisma, { caller });

    await service.discoverCompanyEmailFormat(USER_ID, company.id);
    // Cached: no model call, but new people still get their emails generated.
    expect(caller.search).not.toHaveBeenCalled();
    expect(prisma._state.people[0].inferredEmail).toBe("jane_doe@amat.com");

    // Forcing a refresh bypasses the cache and runs the search.
    await service.discoverCompanyEmailFormat(USER_ID, company.id, { force: true });
    expect(caller.search).toHaveBeenCalledTimes(1);
  });

  it("treats structured evidence older than 30 days as stale", async () => {
    const company = seedDiscoverCompany(prisma, {
      emailDomain: "amat.com",
      emailDomainConfidence: "HIGH",
      emailPattern: "first_last",
      patternConfidence: "HIGH",
      emailFormatDiscoveredAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000)
    });
    const caller = discoveryCaller(APPLIED_MATERIALS_RAW);
    const { service } = buildDiscoverService(prisma, { caller });

    await service.discoverCompanyEmailFormat(USER_ID, company.id);
    expect(caller.search).toHaveBeenCalledTimes(1);
  });

  it("explicit refresh reuses fresh structured evidence and calls the resolver once", async () => {
    const observedAt = new Date().toISOString();
    const company = seedDiscoverCompany(prisma, {
      emailDomain: "amat.com",
      emailDomainConfidence: "HIGH",
      emailDomainEvidence: [
        {
          emailDomain: "amat.com",
          sourceName: "RocketReach",
          sourceUrl: "https://rocketreach.co/applied-materials-email-format",
          sourceType: "public_format_page",
          observedPattern: "first_last",
          percentage: 84.7,
          confidence: "HIGH",
          observedAt
        }
      ],
      emailPattern: "first_last",
      patternConfidence: "HIGH",
      patternEvidence: [
        {
          pattern: "first_last",
          emailDomain: "amat.com",
          sourceName: "RocketReach",
          sourceUrl: "https://rocketreach.co/applied-materials-email-format",
          sourceType: "public_format_page",
          percentage: 84.7,
          confidence: "HIGH",
          observedAt
        }
      ],
      emailFormatDiscoveredAt: new Date()
    });
    const caller = discoveryCaller(APPLIED_MATERIALS_RAW);
    const { service, ai } = buildDiscoverService(prisma, {
      caller,
      aiResponse: {
        selectedEmailDomain: "amat.com",
        selectedPattern: "first_last",
        confidence: "HIGH",
        decisionCode: "VERIFIED_EXAMPLE",
        evidenceIndexesUsed: [0, 1]
      }
    });

    await service.discoverCompanyEmailFormat(USER_ID, company.id, { force: true });
    expect(caller.search).not.toHaveBeenCalled();
    expect(ai.callsOfType("email_pattern")).toHaveLength(1);
    expect(ai.callsOfType("email_pattern")[0]?.maxOutputTokens).toBeLessThanOrEqual(400);
  });

  it("coalesces simultaneous discovery requests into one AI web search", async () => {
    const company = seedDiscoverCompany(prisma);
    const caller = discoveryCaller(APPLIED_MATERIALS_RAW);
    const { service } = buildDiscoverService(prisma, { caller });

    await Promise.all([
      service.discoverCompanyEmailFormat(USER_ID, company.id),
      service.discoverCompanyEmailFormat(USER_ID, company.id)
    ]);
    expect(caller.search).toHaveBeenCalledTimes(1);
  });

  it("rate limits repeated AI discovery and never calls the model when blocked (#11)", async () => {
    const company = seedDiscoverCompany(prisma);
    seedPerson(prisma, company.id, "p1", "Jane", "Doe");
    const caller = discoveryCaller(APPLIED_MATERIALS_RAW);
    const { service } = buildDiscoverService(prisma, {
      caller,
      rateLimiter: async () => ({ allowed: false, retryAfterSeconds: 1800 })
    });

    await expect(service.discoverCompanyEmailFormat(USER_ID, company.id)).rejects.toThrow(/limit/i);
    expect(caller.search).not.toHaveBeenCalled();
  });

  it("rejects AI discovery for a company owned by another user (#13)", async () => {
    const company = seedDiscoverCompany(prisma);
    const { service } = buildDiscoverService(prisma, { caller: discoveryCaller(APPLIED_MATERIALS_RAW) });

    await expect(service.discoverCompanyEmailFormat("someone_else", company.id)).rejects.toThrow(/company not found/i);
  });
});

describe("Discover daily quota enforcement", () => {
  function amatRunner() {
    const run = vi.fn<ApifyRunner["run"]>(async () => ({
      runId: "run-q",
      datasetId: "ds-q",
      items: [profile("q1", "Jane", "Doe", "Software Engineer", "Applied Materials")]
    }));
    return { run, runner: { run } as ApifyRunner };
  }

  const ROLE_ONLY = { responses: { role_classification: { classifications: [] } } };

  it("does not consume quota when creating a draft (#5)", async () => {
    const quota = makeQuotaReserver();
    const { service } = buildService(prisma, amatRunner().runner, ROLE_ONLY, undefined, quota.reserve);
    await service.createSearch(USER_ID, APPLIED_MATERIALS);
    expect(quota.calls).toHaveLength(0);
    expect(quota.consumed.size).toBe(0);
  });

  it("persists the server-fixed maxResults of 10 for new searches (#1)", async () => {
    const { service } = buildService(prisma, amatRunner().runner, ROLE_ONLY);
    const created = await service.createSearch(USER_ID, { ...APPLIED_MATERIALS, maxResults: 999 });
    expect(created.maxResults).toBe(10);
  });

  it("forces Apify to maxItems 10 / takePages 1 even for a legacy record (#2, #3)", async () => {
    const { run, runner } = amatRunner();
    const { service } = buildService(prisma, runner, ROLE_ONLY);
    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    // Simulate a historical record persisted with a larger maxResults.
    prisma._state.searches[0].maxResults = 25;
    await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
    const actorInput = run.mock.calls[0][1];
    expect(actorInput.maxItems).toBe(10);
    expect(actorInput.takePages).toBe(1);
  });

  it("consumes exactly one slot on the first processed search (#6)", async () => {
    const quota = makeQuotaReserver();
    const { service } = buildService(prisma, amatRunner().runner, ROLE_ONLY, undefined, quota.reserve);
    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
    expect(quota.consumed.size).toBe(1);
    expect(quota.calls).toHaveLength(1);
  });

  it("does not consume a second slot when the same search is retried (#10)", async () => {
    const quota = makeQuotaReserver();
    const failingRunner: ApifyRunner = { run: vi.fn(async () => ({ runId: null, datasetId: null, items: [] })) };
    const { service } = buildService(prisma, failingRunner, { enabled: false }, undefined, quota.reserve);
    const created = await service.createSearch(USER_ID, {
      ...APPLIED_MATERIALS,
      companyName: "Unresolved Co",
      companyDomain: null,
      companyLinkedinUrl: null
    });
    const first = await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
    const second = await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
    expect(first.status).toBe("FAILED");
    expect(second.status).toBe("FAILED");
    expect(quota.consumed.size).toBe(1);
    expect(quota.calls).toHaveLength(2);
  });

  it("allows four unique searches then rejects the fifth with a structured error (#7, #8, #9)", async () => {
    const quota = makeQuotaReserver({ limit: 4 });
    const { service } = buildService(prisma, amatRunner().runner, ROLE_ONLY, undefined, quota.reserve);
    for (let i = 0; i < 4; i += 1) {
      const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
      const result = await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
      expect(result.status).toBe("READY");
    }
    const fifth = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await expect(
      service.processSearch(USER_ID, fifth.id, { actorEmail: "u@test.dev" })
    ).rejects.toMatchObject({ code: "DISCOVER_DAILY_LIMIT_REACHED" });
  });

  it("exempts the owner account from the daily limit (#14)", async () => {
    const quota = makeQuotaReserver({ limit: 4, exemptEmails: ["kush.ahir2024@gmail.com"] });
    const { service } = buildService(prisma, amatRunner().runner, ROLE_ONLY, undefined, quota.reserve);
    for (let i = 0; i < 6; i += 1) {
      const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
      const result = await service.processSearch(USER_ID, created.id, { actorEmail: "KUSH.AHIR2024@gmail.com" });
      expect(result.status).toBe("READY");
    }
    expect(quota.consumed.size).toBe(0);
  });

  it("does not let a non-exempt user claim the exemption (#15, #16)", async () => {
    const quota = makeQuotaReserver({ limit: 4, exemptEmails: ["kush.ahir2024@gmail.com"] });
    const { service } = buildService(prisma, amatRunner().runner, ROLE_ONLY, undefined, quota.reserve);
    for (let i = 0; i < 4; i += 1) {
      const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
      await service.processSearch(USER_ID, created.id, { actorEmail: "attacker@evil.test" });
    }
    const fifth = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await expect(
      service.processSearch(USER_ID, fifth.id, { actorEmail: "attacker@evil.test" })
    ).rejects.toMatchObject({ code: "DISCOVER_DAILY_LIMIT_REACHED" });
  });

  it("requires the search to be owned before any quota is reserved (#17)", async () => {
    const quota = makeQuotaReserver();
    const { service } = buildService(prisma, amatRunner().runner, ROLE_ONLY, undefined, quota.reserve);
    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await expect(service.processSearch("another_user", created.id, { actorEmail: "x@test.dev" })).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
    expect(quota.calls).toHaveLength(0);
  });
});

describe("Discover shared cache integration", () => {
  // A cache HIT never runs the provider, so the AI responses are unused here.
  const ROLE_ONLY_AI = { responses: { role_classification: { classifications: [] } } };

  function amatRunner() {
    const run = vi.fn<ApifyRunner["run"]>(async () => ({
      runId: "run-c",
      datasetId: "ds-c",
      items: [profile("am1", "Jane", "Doe", "Software Engineer", "Applied Materials")]
    }));
    return { run, runner: { run } as ApifyRunner };
  }

  const AMAT_AI = {
    responses: {
      role_classification: {
        classifications: [
          { rawTitle: "Software Engineer", normalizedTitle: "software engineer", category: "SOFTWARE_ENGINEERING", displayName: "Software Engineering", confidence: "HIGH" }
        ]
      },
      email_pattern: {
        selectedEmailDomain: "amat.com",
        selectedPattern: "first_last",
        confidence: "HIGH",
        decisionCode: "SOURCE_MAJORITY",
        evidenceIndexesUsed: [0, 1]
      }
    }
  };

  function amatEvidence(): EmailEvidenceProvider {
    return {
      async findEvidence() {
        return {
          domainEvidence: [
            {
              emailDomain: "amat.com",
              sourceName: "Applied Materials email format page",
              sourceUrl: "https://example.test/amat",
              sourceType: "public_format_page",
              observedPattern: "first_last",
              percentage: 91,
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ],
          patternEvidence: [
            {
              pattern: "first_last",
              emailDomain: "amat.com",
              percentage: 91,
              sourceName: "Applied Materials email format page",
              sourceUrl: "https://example.test/amat",
              sourceType: "public_format_page",
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ]
        };
      }
    };
  }

  function cacheDataset(): ResolvedDataset {
    return {
      emailFormat: {
        emailDomain: "amat.com",
        emailDomainConfidence: "HIGH",
        emailDomainEvidence: [{ sourceName: "public" }],
        emailPattern: "first_last",
        patternConfidence: "HIGH",
        patternEvidence: [{ pattern: "first_last" }],
        emailFormatReason: "format"
      },
      people: [
        {
          sourceProfileId: "cp1",
          firstName: "Jane",
          lastName: "Doe",
          fullName: "Jane Doe",
          currentTitle: "Software Engineer",
          normalizedTitle: "software engineer",
          positionCategory: "SOFTWARE_ENGINEERING",
          location: "United States",
          country: "United States",
          state: null,
          city: null,
          linkedinUrl: "https://www.linkedin.com/in/cp1",
          inferredEmail: "jane_doe@amat.com",
          emailStatus: "INFERRED_HIGH",
          emailConfidence: "HIGH",
          emailPattern: "first_last",
          emailSource: "PATTERN"
        }
      ]
    };
  }

  function cacheHitPort(dataset: ResolvedDataset) {
    const calls: GetOrRefreshParams[] = [];
    const port: DiscoverCachePort = {
      async getOrRefresh(params: GetOrRefreshParams) {
        calls.push(params);
        return {
          dataset,
          source: "CACHE",
          cacheId: "cache_1",
          fetchedAt: new Date("2026-06-10T00:00:00.000Z"),
          refreshedStale: false
        };
      }
    };
    return { port, calls };
  }

  it("discovers and applies an email format when cached people have no format", async () => {
    const runner = amatRunner();
    const discovery = vi.fn(async () => ({
      domainEvidence: [
        {
          emailDomain: "salesforce.com",
          sourceName: "Public company staff page",
          sourceUrl: "https://example.test/salesforce-staff",
          sourceType: "public_format_page" as const,
          observedPattern: "first.last" as const,
          percentage: 92,
          confidence: "HIGH" as const,
          observedAt: "2026-07-05T00:00:00.000Z"
        }
      ],
      patternEvidence: [
        {
          pattern: "first.last" as const,
          emailDomain: "salesforce.com",
          sourceName: "Public company staff page",
          sourceUrl: "https://example.test/salesforce-staff",
          sourceType: "public_format_page" as const,
          percentage: 92,
          confidence: "HIGH" as const,
          observedAt: "2026-07-05T00:00:00.000Z"
        }
      ]
    }));
    const cachedPeople = Array.from({ length: 9 }, (_, index) => ({
      sourceProfileId: `salesforce-${index + 1}`,
      firstName: `First${index + 1}`,
      lastName: `Last${index + 1}`,
      fullName: `First${index + 1} Last${index + 1}`,
      currentTitle: "Software Engineer",
      normalizedTitle: "software engineer",
      positionCategory: "SOFTWARE_ENGINEERING",
      location: "United States",
      country: "United States",
      state: null,
      city: null,
      linkedinUrl: `https://www.linkedin.com/in/salesforce-${index + 1}`,
      inferredEmail: null,
      emailStatus: "UNAVAILABLE",
      emailConfidence: "UNAVAILABLE",
      emailPattern: null,
      emailSource: null
    }));
    const { port } = cacheHitPort({
      emailFormat: {
        emailDomain: null,
        emailDomainConfidence: "UNAVAILABLE",
        emailDomainEvidence: [],
        emailPattern: null,
        patternConfidence: "UNAVAILABLE",
        patternEvidence: [],
        emailFormatReason: null
      },
      people: cachedPeople
    });
    const { service } = buildService(
      prisma,
      runner.runner,
      ROLE_ONLY_AI,
      { findEvidence: discovery },
      allowAllQuota,
      port
    );

    const created = await service.createSearch(USER_ID, {
      companyName: "Salesforce, Inc.",
      companyDomain: "salesforce.com",
      companyLinkedinUrl: null,
      jobTitles: ["Software Engineer"],
      locations: ["United States"],
      maxResults: 10
    });
    const result = await service.processSearch(USER_ID, created.id);

    expect(result.status).toBe("READY");
    expect(discovery).toHaveBeenCalledTimes(1);
    expect(discovery).toHaveBeenCalledWith(expect.objectContaining({ officialWebsiteDomain: "salesforce.com" }));
    expect(runner.run).not.toHaveBeenCalled();
    expect(prisma._state.companies[0]).toMatchObject({
      emailDomain: "salesforce.com",
      emailPattern: "first.last"
    });
    expect(prisma._state.people).toHaveLength(9);
    expect(prisma._state.people.every((person) => person.emailStatus === "INFERRED_HIGH")).toBe(true);
    expect(prisma._state.people.every((person) => person.emailStatus !== "VERIFIED")).toBe(true);
    const usable = prisma._state.people.filter((person) =>
      ["INFERRED_HIGH", "INFERRED_MEDIUM", "VERIFIED"].includes(person.emailStatus)
    ).length;
    const unavailable = prisma._state.people.filter((person) => person.emailStatus === "UNAVAILABLE").length;
    expect({ peopleFound: result.totalProcessed, usable, unavailable }).toEqual({
      peopleFound: 9,
      usable: 9,
      unavailable: 0
    });
  });

  it("retries a stale cached no-evidence state without rerunning Apify", async () => {
    const runner = amatRunner();
    const discovery = vi.fn(async () => amatEvidence().findEvidence({
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com"
    }));
    const stale = cacheDataset();
    stale.emailFormat = {
      ...stale.emailFormat,
      emailDomain: null,
      emailPattern: null,
      emailFormatDiscoveryStatus: "NO_EVIDENCE",
      emailFormatDiscoveryAt: new Date("2026-07-01T00:00:00.000Z"),
      emailFormatDiscoveryExpiresAt: new Date("2026-07-02T00:00:00.000Z")
    };
    const { port } = cacheHitPort(stale);
    const { service } = buildService(
      prisma,
      runner.runner,
      ROLE_ONLY_AI,
      { findEvidence: discovery },
      allowAllQuota,
      port
    );

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id);

    expect(discovery).toHaveBeenCalledTimes(1);
    expect(runner.run).not.toHaveBeenCalled();
    expect(prisma._state.people[0].emailStatus).toBe("INFERRED_HIGH");
  });

  it("preserves transient provider failure state instead of caching it as no evidence", async () => {
    const runner = amatRunner();
    const dataset = cacheDataset();
    dataset.emailFormat = {
      ...dataset.emailFormat,
      emailDomain: null,
      emailPattern: null,
      emailFormatDiscoveryStatus: "NOT_ATTEMPTED"
    };
    const updateEmailFormat = vi.fn(async () => undefined);
    const { port: basePort } = cacheHitPort(dataset);
    const port: DiscoverCachePort = { ...basePort, updateEmailFormat };
    const provider: EmailEvidenceProvider = {
      async findEvidence() {
        return {
          discoveryStatus: "RATE_LIMITED",
          discoveryReason: "The provider is temporarily rate-limited."
        };
      }
    };
    const { service } = buildService(prisma, runner.runner, ROLE_ONLY_AI, provider, allowAllQuota, port);

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const result = await service.processSearch(USER_ID, created.id);

    expect(result.status).toBe("READY");
    expect(runner.run).not.toHaveBeenCalled();
    expect(prisma._state.companies[0].emailFormatDiscoveryStatus).toBe("RATE_LIMITED");
    expect(updateEmailFormat).toHaveBeenCalledWith(expect.objectContaining({
      format: expect.objectContaining({
        emailFormatDiscoveryStatus: "RATE_LIMITED",
        emailFormatDiscoveryExpiresAt: null
      })
    }));
  });

  it("keeps a manual override authoritative when a later people cache has no format", async () => {
    const runner = amatRunner();
    const unresolved = cacheDataset();
    unresolved.emailFormat = {
      ...unresolved.emailFormat,
      emailDomain: null,
      emailPattern: null,
      emailFormatDiscoveryStatus: "NOT_ATTEMPTED"
    };
    const discovery = vi.fn(async () => amatEvidence().findEvidence({
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com"
    }));
    const { port } = cacheHitPort(unresolved);
    const { service } = buildService(
      prisma,
      runner.runner,
      ROLE_ONLY_AI,
      { findEvidence: discovery },
      allowAllQuota,
      port
    );

    const first = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, first.id);
    await service.setCompanyEmailInferenceOverride(USER_ID, {
      companyId: prisma._state.companies[0].id,
      emailDomain: "amat.com",
      emailPattern: "first_last",
      confidence: "HIGH"
    });
    discovery.mockClear();

    const second = await service.createSearch(USER_ID, {
      ...APPLIED_MATERIALS,
      jobTitles: ["Recruiter"]
    });
    await service.processSearch(USER_ID, second.id);

    expect(discovery).not.toHaveBeenCalled();
    expect(prisma._state.companies[0]).toMatchObject({
      emailFormatAuthority: "MANUAL",
      emailPattern: "first_last"
    });
    expect(prisma._state.people.every((person) => person.emailStatus !== "VERIFIED")).toBe(true);
  });

  it("reuses a fresh cache hit without calling Apify and still consumes a quota slot (#1, #3, #4)", async () => {
    const runner = amatRunner();
    const { port } = cacheHitPort(cacheDataset());
    const quota = makeQuotaReserver();
    const { service } = buildService(prisma, runner.runner, ROLE_ONLY_AI, undefined, quota.reserve, port);

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const result = await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });

    expect(result.status).toBe("READY");
    expect(result.resultSource).toBe("CACHE");
    expect(result.sharedCacheId).toBe("cache_1");
    expect(runner.run).not.toHaveBeenCalled();
    expect(quota.consumed.size).toBe(1);
  });

  it("materializes user-owned records from the cache hit (#2)", async () => {
    const runner = amatRunner();
    const { port } = cacheHitPort(cacheDataset());
    const { service } = buildService(prisma, runner.runner, ROLE_ONLY_AI, undefined, undefined, port);

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });

    const company = prisma._state.companies[0];
    expect(company.userId).toBe(USER_ID);
    expect(company.emailDomain).toBe("amat.com");
    expect(company.emailPattern).toBe("first_last");
    const person = prisma._state.people[0];
    expect(person.userId).toBe(USER_ID);
    expect(person.inferredEmail).toBe("jane_doe@amat.com");
    expect(person.emailStatus).toBe("INFERRED_HIGH");
  });

  it("shares Walmart's canonical format across Software Engineer and Recruiter searches", async () => {
    const softwareDataset: ResolvedDataset = {
      emailFormat: {
        emailDomain: "walmart.com",
        emailDomainConfidence: "HIGH",
        emailDomainEvidence: [{ sourceType: "public_format_page" }],
        emailPattern: "first.last",
        patternConfidence: "HIGH",
        patternEvidence: [{ pattern: "first.last", sourceType: "public_format_page" }],
        emailFormatReason: "Walmart public format"
      },
      people: [
        {
          sourceProfileId: "walmart-sde",
          firstName: "Mohit",
          lastName: "Kumra",
          fullName: "Mohit Kumra",
          currentTitle: "Staff Software Engineer",
          normalizedTitle: "staff software engineer",
          positionCategory: "SOFTWARE_ENGINEERING",
          location: "United States",
          country: "United States",
          state: null,
          city: null,
          linkedinUrl: "https://www.linkedin.com/in/walmart-sde",
          inferredEmail: "mohit.kumra@walmart.com",
          emailStatus: "INFERRED_HIGH",
          emailConfidence: "HIGH",
          emailPattern: "first.last",
          emailSource: "PATTERN"
        }
      ]
    };
    const recruiterDataset: ResolvedDataset = {
      emailFormat: {
        emailDomain: null,
        emailDomainConfidence: "UNAVAILABLE",
        emailDomainEvidence: [],
        emailPattern: null,
        patternConfidence: "UNAVAILABLE",
        patternEvidence: [],
        emailFormatReason: "Unresolved"
      },
      people: [
        {
          sourceProfileId: "walmart-recruiter",
          firstName: "Christy",
          lastName: "Stouffer",
          fullName: "Christy Stouffer",
          currentTitle: "Executive Recruiter",
          normalizedTitle: "executive recruiter",
          positionCategory: "RECRUITING",
          location: "United States",
          country: "United States",
          state: null,
          city: null,
          linkedinUrl: "https://www.linkedin.com/in/walmart-recruiter",
          inferredEmail: null,
          emailStatus: "UNAVAILABLE",
          emailConfidence: "UNAVAILABLE",
          emailPattern: null,
          emailSource: null
        }
      ]
    };
    let cacheCall = 0;
    const cache: DiscoverCachePort = {
      async getOrRefresh() {
        const dataset = cacheCall++ === 0 ? softwareDataset : recruiterDataset;
        return { dataset, source: "CACHE", cacheId: `walmart-cache-${cacheCall}`, fetchedAt: new Date(), refreshedStale: false };
      }
    };
    const runner = amatRunner();
    const { service, ai } = buildService(prisma, runner.runner, ROLE_ONLY_AI, undefined, undefined, cache);

    const softwareSearch = await service.createSearch(USER_ID, {
      ...APPLIED_MATERIALS,
      companyName: "Walmart",
      companyDomain: "walmart.com",
      jobTitles: ["Software Engineer"]
    });
    await service.processSearch(USER_ID, softwareSearch.id);
    const recruiterSearch = await service.createSearch(USER_ID, {
      ...APPLIED_MATERIALS,
      companyName: "Walmart Inc.",
      companyDomain: "walmart.com",
      jobTitles: ["Recruiter"]
    });
    await service.processSearch(USER_ID, recruiterSearch.id);

    expect(prisma._state.companies).toHaveLength(1);
    expect(prisma._state.companies[0]).toMatchObject({
      canonicalKey: "domain:walmart.com",
      emailDomain: "walmart.com",
      emailPattern: "first.last"
    });
    expect(prisma._state.searches.map((search) => search.companyId)).toEqual([
      prisma._state.companies[0].id,
      prisma._state.companies[0].id
    ]);
    expect(prisma._state.people.find((person) => person.firstName === "Mohit")?.inferredEmail).toBe(
      "mohit.kumra@walmart.com"
    );
    expect(prisma._state.people.find((person) => person.firstName === "Christy")?.inferredEmail).toBe(
      "christy.stouffer@walmart.com"
    );

    await service.setCompanyEmailInferenceOverride(USER_ID, {
      companyId: prisma._state.companies[0].id,
      emailDomain: "walmart.com",
      emailPattern: "first_last",
      confidence: "HIGH",
      reason: "Manual correction"
    });
    expect(prisma._state.people.find((person) => person.firstName === "Mohit")?.inferredEmail).toBe(
      "mohit_kumra@walmart.com"
    );
    expect(prisma._state.people.find((person) => person.firstName === "Christy")?.inferredEmail).toBe(
      "christy_stouffer@walmart.com"
    );
    expect(runner.run).not.toHaveBeenCalled();
    expect(ai.calls.filter((call) => call.taskType === "email_pattern")).toHaveLength(0);
  });

  it("never passes requester identity to the shared cache (#5)", async () => {
    const runner = amatRunner();
    const { port, calls } = cacheHitPort(cacheDataset());
    const { service } = buildService(prisma, runner.runner, ROLE_ONLY_AI, undefined, undefined, port);

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });

    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).not.toMatch(/userId|u@test\.dev/i);
  });

  it("records PROVIDER as the result source on a cache miss", async () => {
    const runner = amatRunner();
    const { service } = buildService(prisma, runner.runner, AMAT_AI, amatEvidence());
    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const result = await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });

    expect(result.status).toBe("READY");
    expect(result.resultSource).toBe("PROVIDER");
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it("lets a second user reuse one shared cache entry with separate user-owned records (#14, #15, #16)", async () => {
    const cache = new DiscoverSearchCacheService({
      prisma: prisma as unknown as PrismaClient,
      lock: makeFakeCacheLock(),
      now: () => new Date(),
      ttlDays: 30,
      waitTimeoutMs: 500,
      pollIntervalMs: 5,
      cleanupOnRefresh: false
    });
    const runnerA = amatRunner();
    const runnerB = amatRunner();
    const quotaA = makeQuotaReserver();
    const quotaB = makeQuotaReserver();
    const { service: serviceA } = buildService(prisma, runnerA.runner, AMAT_AI, amatEvidence(), quotaA.reserve, cache);
    const { service: serviceB } = buildService(prisma, runnerB.runner, AMAT_AI, amatEvidence(), quotaB.reserve, cache);

    const a = await serviceA.createSearch("user_A", APPLIED_MATERIALS);
    const resA = await serviceA.processSearch("user_A", a.id, { actorEmail: "a@test.dev" });
    const b = await serviceB.createSearch("user_B", APPLIED_MATERIALS);
    const resB = await serviceB.processSearch("user_B", b.id, { actorEmail: "b@test.dev" });

    expect(resA.resultSource).toBe("PROVIDER");
    expect(resB.resultSource).toBe("CACHE");
    expect(runnerA.run).toHaveBeenCalledTimes(1);
    expect(runnerB.run).not.toHaveBeenCalled();

    // Separate user-owned records.
    const aCompany = prisma._state.companies.find((c) => c.userId === "user_A");
    const bCompany = prisma._state.companies.find((c) => c.userId === "user_B");
    expect(aCompany?.id).toBeTruthy();
    expect(bCompany?.id).toBeTruthy();
    expect(aCompany?.id).not.toBe(bCompany?.id);
    expect(prisma._state.people.filter((p) => p.userId === "user_A").length).toBeGreaterThan(0);
    expect(prisma._state.people.filter((p) => p.userId === "user_B").length).toBeGreaterThan(0);

    // Both consumed their own quota slot.
    expect(quotaA.consumed.size).toBe(1);
    expect(quotaB.consumed.size).toBe(1);

    // Exactly one shared entry, holding no requester identity.
    expect(prisma._state.discoverCache).toHaveLength(1);
    expect(JSON.stringify(prisma._state.discoverCache[0])).not.toMatch(/user_A|user_B|userId/);
  });

  it("reuses the production-shaped 98-person Apple pool for a narrower Recruiter search without Apify", async () => {
    const cache = new DiscoverSearchCacheService({
      prisma: prisma as unknown as PrismaClient,
      lock: makeFakeCacheLock(),
      now: () => new Date("2026-08-20T17:00:00.000Z"),
      ttlDays: 30,
      waitTimeoutMs: 500,
      pollIntervalMs: 5,
      cleanupOnRefresh: false
    });
    const people = Array.from({ length: 98 }, (_, index) => {
      const recruiter = index < 32;
      const humanResources = index >= 32 && index < 49;
      const title = recruiter ? "Recruiter" : humanResources ? "HR Manager" : "Software Engineer";
      const category = recruiter ? "RECRUITING" : humanResources ? "HUMAN_RESOURCES" : "SOFTWARE_ENGINEERING";
      return {
        sourceProfileId: `apple-${index + 1}`,
        firstName: `First${index + 1}`,
        lastName: `Last${index + 1}`,
        fullName: `First${index + 1} Last${index + 1}`,
        currentTitle: title,
        normalizedTitle: title.toLowerCase(),
        positionCategory: category,
        location: "United States",
        country: "United States",
        state: null,
        city: null,
        linkedinUrl: `https://www.linkedin.com/in/apple-${index + 1}`,
        inferredEmail: null,
        emailStatus: "UNAVAILABLE",
        emailConfidence: "UNAVAILABLE",
        emailPattern: null,
        emailSource: null
      };
    });
    await cache.getOrRefresh({
      fingerprint: "apple-broad-98",
      fingerprintInput: {
        companyKey: "domain:apple.com",
        roles: ["human resource", "recruiter", "software engineer"],
        locations: ["united states"],
        resultLimit: 10,
        cacheVersion: "v1"
      },
      company: { name: "Apple Inc.", domain: "apple.com", linkedinUrl: "https://linkedin.com/company/apple" },
      provider: async () => ({
        emailFormat: {
          emailDomain: "apple.com",
          emailDomainConfidence: "HIGH",
          emailDomainEvidence: [{ sourceName: "public" }],
          emailPattern: "flast",
          patternConfidence: "HIGH",
          patternEvidence: [{ pattern: "flast" }],
          emailFormatReason: "format",
          emailFormatDiscoveryStatus: "FOUND",
          emailFormatDiscoveryAt: new Date("2026-08-20T17:00:00.000Z"),
          emailFormatDiscoveryExpiresAt: new Date("2026-09-19T17:00:00.000Z")
        },
        people
      })
    });

    const run = vi.fn<ApifyRunner["run"]>();
    const { service } = buildService(
      prisma,
      { run } as ApifyRunner,
      ROLE_ONLY_AI,
      undefined,
      makeQuotaReserver().reserve,
      cache
    );
    const search = await service.createSearch("apple_requester", {
      companyName: "Apple",
      companyDomain: "apple.com",
      companyLinkedinUrl: null,
      jobTitles: ["Recruiter"],
      locations: ["United States"],
      maxResults: 10
    });

    const result = await service.processSearch("apple_requester", search.id);

    expect(result.status).toBe("READY");
    expect(result.resultSource).toBe("CACHE");
    expect(result.totalProcessed).toBe(10);
    expect(run).not.toHaveBeenCalled();
    expect(prisma._state.people).toHaveLength(10);
    expect(prisma._state.people.every((person) => person.userId === "apple_requester")).toBe(true);
    const allocatedPositionIds = new Set(prisma._state.people.map((person) => person.positionId));
    expect(
      prisma._state.positions
        .filter((position) => allocatedPositionIds.has(position.id))
        .map((position) => position.category)
    ).toEqual(["RECRUITING"]);
  });

  it("materializes four cached Recruiters as READY without a paid top-up", async () => {
    const cache = new DiscoverSearchCacheService({
      prisma: prisma as unknown as PrismaClient,
      lock: makeFakeCacheLock(),
      now: () => new Date("2026-08-20T17:00:00.000Z"),
      ttlDays: 30,
      cleanupOnRefresh: false
    });
    const cached = cacheDataset();
    cached.people = Array.from({ length: 4 }, (_, index) => ({
      ...cached.people[0],
      sourceProfileId: `partial-${index + 1}`,
      firstName: `First${index + 1}`,
      fullName: `First${index + 1} Doe`,
      currentTitle: "Recruiter",
      normalizedTitle: "recruiter",
      positionCategory: "RECRUITING",
      linkedinUrl: `https://www.linkedin.com/in/partial-${index + 1}`
    }));
    await cache.getOrRefresh({
      fingerprint: "apple-broad-partial",
      fingerprintInput: {
        companyKey: "domain:apple.com",
        roles: ["recruiter", "software engineer"],
        locations: ["united states"],
        resultLimit: 10,
        cacheVersion: "v1"
      },
      company: { name: "Apple Inc.", domain: "apple.com", linkedinUrl: null },
      provider: async () => cached
    });
    const run = vi.fn<ApifyRunner["run"]>();
    const { service } = buildService(prisma, { run } as ApifyRunner, ROLE_ONLY_AI, undefined, allowAllQuota, cache);
    const search = await service.createSearch(USER_ID, {
      companyName: "Apple",
      companyDomain: "apple.com",
      companyLinkedinUrl: null,
      jobTitles: ["Recruiter"],
      locations: ["United States"],
      maxResults: 10
    });

    const result = await service.processSearch(USER_ID, search.id);

    expect(result.status).toBe("READY");
    expect(result.totalProcessed).toBe(4);
    expect(result.resultSource).toBe("CACHE");
    expect(run).not.toHaveBeenCalled();
  });

  it("runs Apify only once for concurrent identical misses (#concurrency 1, 2)", async () => {
    const cache = new DiscoverSearchCacheService({
      prisma: prisma as unknown as PrismaClient,
      lock: makeFakeCacheLock(),
      now: () => new Date(),
      ttlDays: 30,
      waitTimeoutMs: 1000,
      pollIntervalMs: 5,
      cleanupOnRefresh: false
    });
    const runnerA = amatRunner();
    const runnerB = amatRunner();
    const { service: serviceA } = buildService(prisma, runnerA.runner, AMAT_AI, amatEvidence(), makeQuotaReserver().reserve, cache);
    const { service: serviceB } = buildService(prisma, runnerB.runner, AMAT_AI, amatEvidence(), makeQuotaReserver().reserve, cache);

    const a = await serviceA.createSearch("user_A", APPLIED_MATERIALS);
    const b = await serviceB.createSearch("user_B", APPLIED_MATERIALS);
    const [resA, resB] = await Promise.all([
      serviceA.processSearch("user_A", a.id, { actorEmail: "a@test.dev" }),
      serviceB.processSearch("user_B", b.id, { actorEmail: "b@test.dev" })
    ]);

    // Exactly one of the two Apify runners is called; both users get results.
    const apifyCalls = runnerA.run.mock.calls.length + runnerB.run.mock.calls.length;
    expect(apifyCalls).toBe(1);
    expect(resA.status).toBe("READY");
    expect(resB.status).toBe("READY");
    expect([resA.resultSource, resB.resultSource].sort()).toEqual(["CACHE", "PROVIDER"]);
  });
});

describe("Discover retry", () => {
  const RETRY_AI = {
    responses: {
      role_classification: {
        classifications: [
          {
            rawTitle: "Software Engineer",
            normalizedTitle: "software engineer",
            category: "SOFTWARE_ENGINEERING",
            displayName: "Software Engineering",
            confidence: "HIGH"
          }
        ]
      },
      email_pattern: {
        selectedEmailDomain: "amat.com",
        selectedPattern: "first_last",
        confidence: "HIGH",
        decisionCode: "SOURCE_MAJORITY",
        evidenceIndexesUsed: [0, 1]
      }
    }
  };

  function retryEvidence(): EmailEvidenceProvider {
    return {
      async findEvidence() {
        return {
          domainEvidence: [
            {
              emailDomain: "amat.com",
              sourceName: "format page",
              sourceUrl: "https://example.test/amat",
              sourceType: "public_format_page",
              observedPattern: "first_last",
              percentage: 91,
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ],
          patternEvidence: [
            {
              pattern: "first_last",
              emailDomain: "amat.com",
              percentage: 91,
              sourceName: "format page",
              sourceUrl: "https://example.test/amat",
              sourceType: "public_format_page",
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ]
        };
      }
    };
  }

  const item = () => [profile("am1", "Jane", "Doe", "Software Engineer", "Applied Materials")];

  function realCache() {
    return new DiscoverSearchCacheService({
      prisma: prisma as unknown as PrismaClient,
      lock: makeFakeCacheLock(),
      now: () => new Date(),
      ttlDays: 30,
      waitTimeoutMs: 1000,
      pollIntervalMs: 5,
      cleanupOnRefresh: false
    });
  }

  it("re-runs the provider on retry and records a new attempt, reusing the same search (#retry-1,2,3,5,14,15,18,19)", async () => {
    let calls = 0;
    const run = vi.fn<ApifyRunner["run"]>(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("temporary apify failure");
      }
      return { runId: "r2", datasetId: "d2", items: item() };
    });
    const quota = makeQuotaReserver();
    const { service } = buildService(prisma, { run } as ApifyRunner, RETRY_AI, retryEvidence(), quota.reserve, passthroughCache);

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const first = await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
    expect(first.status).toBe("FAILED");
    expect(first.attemptCount).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);

    const retried = await service.processSearch(USER_ID, created.id, {
      actorEmail: "u@test.dev",
      idempotencyKey: "click-2"
    });

    expect(retried.status).toBe("READY"); // FAILED -> PROCESSING -> READY
    expect(retried.attemptCount).toBe(2); // a new processing attempt
    expect(retried.id).toBe(created.id); // same Search History row
    expect(run).toHaveBeenCalledTimes(2); // the provider really ran again
    expect(retried.totalProcessed).toBe(1);
    expect(retried.requestedCompany).toBe("Applied Materials"); // input preserved
    expect(prisma._state.searches).toHaveLength(1); // no duplicate search
    expect(prisma._state.companies).toHaveLength(1); // no duplicate company
    expect(quota.consumed.size).toBe(1); // retry did not consume a second slot
  });

  it("returns a FAILED search with a raw internal code for the boundary to sanitize (#retry-20)", async () => {
    const run = vi.fn<ApifyRunner["run"]>(async () => {
      throw new Error("provider exploded");
    });
    const { service } = buildService(prisma, { run } as ApifyRunner, { enabled: false }, undefined, allowAllQuota, passthroughCache);

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const result = await service.processSearch(USER_ID, created.id);
    // The service persists the RAW code (the GraphQL layer maps it to a safe
    // public category); it must never invent a fake "success".
    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("PROVIDER_ERROR");
    expect(result.attemptCount).toBe(1);
  });

  it("counts a replayed idempotency key as one attempt but a fresh key as a new attempt (#retry-16,17)", async () => {
    const run = vi.fn<ApifyRunner["run"]>(async () => {
      throw new Error("still failing");
    });
    const { service } = buildService(prisma, { run } as ApifyRunner, { enabled: false }, undefined, allowAllQuota, passthroughCache);
    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);

    const a1 = await service.processSearch(USER_ID, created.id, { idempotencyKey: "net-1" });
    expect(a1.status).toBe("FAILED");
    expect(a1.attemptCount).toBe(1);

    // Browser/network replay of the SAME request — same attempt.
    const a2 = await service.processSearch(USER_ID, created.id, { idempotencyKey: "net-1" });
    expect(a2.attemptCount).toBe(1);

    // A deliberate, fresh Retry click — a new attempt.
    const a3 = await service.processSearch(USER_ID, created.id, { idempotencyKey: "net-2" });
    expect(a3.attemptCount).toBe(2);
  });

  it("does not reuse a zero-result cache entry — a later search re-runs the provider (#retry-7,9)", async () => {
    const cache = realCache();
    let calls = 0;
    const run = vi.fn<ApifyRunner["run"]>(async () => {
      calls += 1;
      return { runId: `r${calls}`, datasetId: `d${calls}`, items: calls === 1 ? [] : item() };
    });
    const { service } = buildService(prisma, { run } as ApifyRunner, RETRY_AI, retryEvidence(), makeQuotaReserver().reserve, cache);

    const s1 = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const r1 = await service.processSearch(USER_ID, s1.id, { actorEmail: "u@test.dev" });
    expect(r1.status).toBe("NO_RESULTS"); // a genuine zero-result run is never "Ready"
    expect(r1.totalProcessed).toBe(0);

    const s2 = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const r2 = await service.processSearch(USER_ID, s2.id, { actorEmail: "u@test.dev" });
    // The empty cache entry must NOT short-circuit the provider.
    expect(run).toHaveBeenCalledTimes(2);
    expect(r2.status).toBe("READY");
    expect(r2.totalProcessed).toBe(1);
  });

  it("still reuses a fresh non-empty cache without calling the provider again (#retry-6)", async () => {
    const cache = realCache();
    const run = vi.fn<ApifyRunner["run"]>(async () => ({ runId: "r1", datasetId: "d1", items: item() }));
    const { service } = buildService(prisma, { run } as ApifyRunner, RETRY_AI, retryEvidence(), makeQuotaReserver().reserve, cache);

    const s1 = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, s1.id, { actorEmail: "u@test.dev" });
    const s2 = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const r2 = await service.processSearch(USER_ID, s2.id, { actorEmail: "u@test.dev" });

    expect(run).toHaveBeenCalledTimes(1); // the second search reused the cache
    expect(r2.resultSource).toBe("CACHE");
    expect(r2.totalProcessed).toBe(1);
  });
});

describe("zero-result searches (provider succeeded, nobody found)", () => {
  const ZERO_AI = {
    responses: {
      role_classification: {
        classifications: [
          {
            rawTitle: "Software Engineer",
            normalizedTitle: "software engineer",
            category: "SOFTWARE_ENGINEERING",
            displayName: "Software Engineering",
            confidence: "HIGH"
          }
        ]
      },
      email_pattern: {
        selectedEmailDomain: "appliedmaterials.com",
        selectedPattern: "first_last",
        confidence: "HIGH",
        decisionCode: "SOURCE_MAJORITY",
        evidenceIndexesUsed: [0]
      }
    }
  };

  function zeroEvidence(findEvidence: EmailEvidenceProvider["findEvidence"]): EmailEvidenceProvider {
    return { findEvidence };
  }

  it("marks the search NO_RESULTS and skips email-format discovery entirely (#zero-1)", async () => {
    const run = vi.fn<ApifyRunner["run"]>(async () => ({ runId: "run-zero", datasetId: "ds-zero", items: [] }));
    const findEvidence = vi.fn(async () => ({ domainEvidence: [], patternEvidence: [] }));
    const { service, ai } = buildService(prisma, { run } as ApifyRunner, ZERO_AI, zeroEvidence(findEvidence));

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const result = await service.processSearch(USER_ID, created.id);

    // Neutral outcome: never READY, never FAILED, no error surface.
    expect(result.status).toBe("NO_RESULTS");
    expect(result.totalProcessed).toBe(0);
    expect(result.errorCode).toBeNull();
    expect(result.errorMessage).toBeNull();
    expect(result.completedAt).toBeTruthy();

    // Provider run metadata is preserved for diagnostics.
    expect(result.apifyRunId).toBe("run-zero");
    expect(result.apifyDatasetId).toBe("ds-zero");
    expect(result.totalFound).toBe(0);

    // The paid email-format stage never ran: no AI calls, no public-evidence
    // lookup, and no inferred email-quality records were created.
    expect(ai.callsOfType("email_pattern")).toHaveLength(0);
    expect(ai.calls).toHaveLength(0);
    expect(findEvidence).not.toHaveBeenCalled();
    expect(prisma._state.people).toHaveLength(0);
    expect(prisma._state.positions).toHaveLength(0);
    expect(prisma._state.searchPeople).toHaveLength(0);
  });

  it("marks the search NO_RESULTS when every provider item is filtered out (#zero-2)", async () => {
    // The provider returned people, but none belong to the requested company —
    // ingestion filters them all, which is still a no-result outcome.
    const items = [profile("other1", "Alex", "Chen", "Software Engineer", "Totally Different Corp")];
    const run = vi.fn<ApifyRunner["run"]>(async () => ({ runId: "run-f", datasetId: "ds-f", items }));
    const findEvidence = vi.fn(async () => ({ domainEvidence: [], patternEvidence: [] }));
    const { service, ai } = buildService(prisma, { run } as ApifyRunner, ZERO_AI, zeroEvidence(findEvidence));

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const result = await service.processSearch(USER_ID, created.id);

    expect(result.status).toBe("NO_RESULTS");
    expect(result.totalProcessed).toBe(0);
    expect(result.totalFound).toBe(1); // the raw provider count stays diagnosable
    expect(ai.callsOfType("email_pattern")).toHaveLength(0);
    expect(findEvidence).not.toHaveBeenCalled();
    expect(prisma._state.people).toHaveLength(0);
  });

  it("cannot finalize READY when the post-materialization allocation count is zero", async () => {
    const items = [profile("am1", "Jane", "Doe", "Software Engineer", "Applied Materials")];
    const run = vi.fn<ApifyRunner["run"]>(async () => ({ runId: "run-m", datasetId: "ds-m", items }));
    const { service } = buildService(prisma, { run } as ApifyRunner, ZERO_AI, undefined);
    const materializer = service as unknown as { materializeDataset: () => Promise<number> };
    vi.spyOn(materializer, "materializeDataset").mockResolvedValue(0);

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const result = await service.processSearch(USER_ID, created.id);

    // The provider/cache stage had a valid candidate, but the authoritative
    // final allocation count is zero. That must remain a neutral no-result.
    expect(result.totalFound).toBe(1);
    expect(result.status).toBe("NO_RESULTS");
    expect(result.totalProcessed).toBe(0);
    expect(prisma._state.people).toHaveLength(0);
    expect(prisma._state.positions).toHaveLength(0);
    expect(prisma._state.searchPeople).toHaveLength(0);
  });

  it("re-processing a NO_RESULTS search re-runs the provider and can become READY (#zero-3)", async () => {
    let calls = 0;
    const run = vi.fn<ApifyRunner["run"]>(async () => {
      calls += 1;
      return {
        runId: `r${calls}`,
        datasetId: `d${calls}`,
        items: calls === 1 ? [] : [profile("am1", "Jane", "Doe", "Software Engineer", "Applied Materials")]
      };
    });
    const findEvidence = vi.fn(async () => ({
      domainEvidence: [
        {
          emailDomain: "amat.com",
          sourceName: "format page",
          sourceUrl: "https://example.test/amat",
          sourceType: "public_format_page" as const,
          observedPattern: "first_last" as const,
          percentage: 91,
          confidence: "HIGH" as const,
          observedAt: "2026-06-18T00:00:00.000Z"
        }
      ],
      patternEvidence: [
        {
          pattern: "first_last" as const,
          emailDomain: "amat.com",
          percentage: 91,
          sourceName: "format page",
          sourceUrl: "https://example.test/amat",
          sourceType: "public_format_page" as const,
          confidence: "HIGH" as const,
          observedAt: "2026-06-18T00:00:00.000Z"
        }
      ]
    }));
    const quota = makeQuotaReserver();
    const { service } = buildService(
      prisma,
      { run } as ApifyRunner,
      {
        responses: {
          role_classification: { classifications: [] },
          email_pattern: {
            selectedEmailDomain: "amat.com",
            selectedPattern: "first_last",
            confidence: "HIGH",
            decisionCode: "SOURCE_MAJORITY",
            evidenceIndexesUsed: [0, 1]
          }
        }
      },
      zeroEvidence(findEvidence),
      quota.reserve,
      passthroughCache
    );

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const first = await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
    expect(first.status).toBe("NO_RESULTS");
    expect(findEvidence).not.toHaveBeenCalled();

    // "Search this company again": the SAME record re-runs the whole pipeline.
    const retried = await service.processSearch(USER_ID, created.id, {
      actorEmail: "u@test.dev",
      idempotencyKey: "again-1"
    });

    expect(retried.id).toBe(created.id); // no duplicate Search History row
    expect(retried.status).toBe("READY"); // people found this time → normal flow
    expect(retried.totalProcessed).toBe(1);
    expect(run).toHaveBeenCalledTimes(2); // the provider genuinely ran again
    expect(quota.consumed.size).toBe(1); // the retry never consumed a second slot
  });

  it("re-processes a legacy zero-result row stored as READY (#zero-4)", async () => {
    let calls = 0;
    const run = vi.fn<ApifyRunner["run"]>(async () => {
      calls += 1;
      return {
        runId: `r${calls}`,
        datasetId: `d${calls}`,
        items: calls === 1 ? [] : [profile("am1", "Jane", "Doe", "Software Engineer", "Applied Materials")]
      };
    });
    const { service } = buildService(prisma, { run } as ApifyRunner, ZERO_AI, undefined);

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id);

    // Simulate a pre-NO_RESULTS row: READY with nothing processed.
    const row = prisma._state.searches.find((search) => search.id === created.id)!;
    row.status = "READY";
    row.totalProcessed = 0;

    const retried = await service.processSearch(USER_ID, created.id, { idempotencyKey: "legacy-1" });
    expect(run).toHaveBeenCalledTimes(2); // legacy zero-result READY is retryable
    expect(retried.totalProcessed).toBe(1);
  });

  it("a completed NO_RESULTS search cannot be canceled, and a provider failure stays FAILED (#zero-5)", async () => {
    const run = vi.fn<ApifyRunner["run"]>(async () => ({ runId: "rz", datasetId: "dz", items: [] }));
    const { service } = buildService(prisma, { run } as ApifyRunner, ZERO_AI, undefined);

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const result = await service.processSearch(USER_ID, created.id);
    expect(result.status).toBe("NO_RESULTS");
    await expect(service.cancelSearch(USER_ID, created.id)).rejects.toMatchObject({ code: "INVALID_STATE" });

    // A genuine provider error is a FAILED search — never NO_RESULTS.
    const failingRun = vi.fn<ApifyRunner["run"]>(async () => {
      throw new Error("provider exploded");
    });
    const { service: failingService } = buildService(prisma, { run: failingRun } as ApifyRunner, { enabled: false });
    const failing = await failingService.createSearch(USER_ID, ESRI);
    const failed = await failingService.processSearch(USER_ID, failing.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
  });
});

describe("Discover search deletion", () => {
  function seedSearch(id: string, overrides: Record<string, unknown> = {}) {
    prisma._state.searches.push({
      id,
      userId: USER_ID,
      requestedCompany: "Apple",
      requestedTitles: [],
      requestedLocations: [],
      maxResults: 10,
      status: "READY",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides
    });
  }

  it("deletes only the owned search row, keeping the company, people, and sibling searches (#delete)", async () => {
    prisma._state.companies.push({ id: "c1", userId: USER_ID, name: "Apple", normalizedName: "apple", createdAt: new Date(), updatedAt: new Date() });
    seedSearch("s1", { companyId: "c1" });
    seedSearch("s2", { companyId: "c1" });
    prisma._state.people.push({ id: "p1", userId: USER_ID, companyId: "c1", sourceProfileId: "x1", firstName: "Jane", lastName: "Doe" });
    const { service } = buildService(prisma, { run: vi.fn() } as ApifyRunner, { enabled: false });

    const ok = await service.deleteSearch(USER_ID, "s1");

    expect(ok).toBe(true);
    expect(prisma._state.searches.map((row) => row.id)).toEqual(["s2"]); // only s1 removed
    expect(prisma._state.companies).toHaveLength(1); // company preserved
    expect(prisma._state.people).toHaveLength(1); // people preserved
  });

  it("deletes a FAILED, company-less search row (#delete-failed)", async () => {
    seedSearch("failed1", { status: "FAILED", companyId: null, errorCode: "COMPANY_UNRESOLVED" });
    const { service } = buildService(prisma, { run: vi.fn() } as ApifyRunner, { enabled: false });

    await expect(service.deleteSearch(USER_ID, "failed1")).resolves.toBe(true);
    expect(prisma._state.searches).toHaveLength(0);
  });

  it("refuses to delete a search owned by another user (#14)", async () => {
    prisma._state.searches.push({
      id: "s1",
      userId: "user_OTHER",
      requestedCompany: "Stripe",
      requestedTitles: [],
      requestedLocations: [],
      maxResults: 10,
      status: "READY",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const { service } = buildService(prisma, { run: vi.fn() } as ApifyRunner, { enabled: false });

    await expect(service.deleteSearch(USER_ID, "s1")).rejects.toThrow(/not found/i);
    expect(prisma._state.searches).toHaveLength(1); // untouched
  });
});

describe("Discover user-specific allocation cap (shared cache exposure)", () => {
  // Cache hits never run the provider, so role-classification AI is unused.
  const ROLE_ONLY_AI = { responses: { role_classification: { classifications: [] } } };

  /** A shared cached pool far larger than any single user's entitlement. */
  function pooledDataset(count: number): ResolvedDataset {
    return {
      emailFormat: {
        emailDomain: "amat.com",
        emailDomainConfidence: "HIGH",
        emailDomainEvidence: [{ sourceName: "public" }],
        emailPattern: "first_last",
        patternConfidence: "HIGH",
        patternEvidence: [{ pattern: "first_last" }],
        emailFormatReason: "format"
      },
      people: Array.from({ length: count }, (_, index) => ({
        sourceProfileId: `pool_${index + 1}`,
        firstName: "Pool",
        lastName: `Person${index + 1}`,
        fullName: `Pool Person${index + 1}`,
        currentTitle: index % 3 === 2 ? "Recruiter" : "Software Engineer",
        normalizedTitle: index % 3 === 2 ? "recruiter" : "software engineer",
        positionCategory: index % 3 === 2 ? "RECRUITING" : "SOFTWARE_ENGINEERING",
        location: "United States",
        country: "United States",
        state: null,
        city: null,
        linkedinUrl: `https://www.linkedin.com/in/pool_${index + 1}`,
        inferredEmail: `pool_person${index + 1}@amat.com`,
        emailStatus: "INFERRED_HIGH",
        emailConfidence: "HIGH",
        emailPattern: "first_last",
        emailSource: "PATTERN"
      }))
    };
  }

  function pooledCachePort(dataset: ResolvedDataset): DiscoverCachePort {
    return {
      async getOrRefresh() {
        return {
          dataset,
          source: "CACHE",
          cacheId: "cache_pool",
          fetchedAt: new Date("2026-06-10T00:00:00.000Z"),
          refreshedStale: false
        };
      }
    };
  }

  it("a new user receives only the 10-person allocation from a 30-person cached pool (#alloc-1, #alloc-3, #alloc-5)", async () => {
    const runner = { run: vi.fn() } as unknown as ApifyRunner;
    const dataset = pooledDataset(30);
    const { service } = buildService(prisma, runner, ROLE_ONLY_AI, undefined, undefined, pooledCachePort(dataset));

    const created = await service.createSearch("user_B", APPLIED_MATERIALS);
    const result = await service.processSearch("user_B", created.id, { actorEmail: "b@test.dev" });

    expect(result.status).toBe("READY");
    // The search's own count is the ALLOCATED batch, not the pool size.
    expect(result.totalProcessed).toBe(10);
    // No provider call — the fresh cache covered the batch (#4).
    expect((runner as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
    // Only the allocated 10 were ever materialized for this user: the remaining
    // 20 cached candidates are not reachable through any user-scoped read.
    const materialized = prisma._state.people.filter((person) => person.userId === "user_B");
    expect(materialized).toHaveLength(10);
    expect(materialized.map((person) => person.sourceProfileId).sort()).toEqual(
      dataset.people.slice(0, 10).map((person) => person.sourceProfileId).sort()
    );
    // Each grant is recorded with its source and stable order.
    const grants = prisma._state.searchPeople.filter((row) => row.searchId === created.id);
    expect(grants).toHaveLength(10);
    expect(grants.every((row) => row.allocationSource === "CACHE")).toBe(true);
    expect([...grants.map((row) => row.allocationOrder)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9
    ]);
  });

  it("retrying the same search never inflates its allocation (#alloc-2)", async () => {
    const runner = { run: vi.fn() } as unknown as ApifyRunner;
    const { service } = buildService(prisma, runner, ROLE_ONLY_AI, undefined, undefined, pooledCachePort(pooledDataset(30)));

    const created = await service.createSearch("user_B", APPLIED_MATERIALS);
    await service.processSearch("user_B", created.id, { actorEmail: "b@test.dev" });

    // Simulate a failure after a completed materialization, then a user retry.
    const row = prisma._state.searches.find((search) => search.id === created.id)!;
    row.status = "FAILED";
    const retried = await service.processSearch("user_B", created.id, { actorEmail: "b@test.dev" });

    expect(retried.status).toBe("READY");
    expect(retried.totalProcessed).toBe(10);
    expect(prisma._state.searchPeople.filter((r) => r.searchId === created.id)).toHaveLength(10);
    expect(prisma._state.people.filter((person) => person.userId === "user_B")).toHaveLength(10);
  });

  it("two role searches for one company consume two usage slots and keep two child records (#usage-1, #group-1)", async () => {
    const runner = { run: vi.fn() } as unknown as ApifyRunner;
    const quota = makeQuotaReserver();
    const { service } = buildService(prisma, runner, ROLE_ONLY_AI, undefined, quota.reserve, pooledCachePort(pooledDataset(30)));

    const engineer = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, engineer.id, { actorEmail: "u@test.dev" });
    const recruiter = await service.createSearch(USER_ID, { ...APPLIED_MATERIALS, jobTitles: ["Recruiter"] });
    await service.processSearch(USER_ID, recruiter.id, { actorEmail: "u@test.dev" });

    // Two distinct usage actions — same company grouping never dedupes usage.
    expect(quota.consumed.size).toBe(2);
    expect(new Set(quota.calls.map((call) => call.searchId)).size).toBe(2);
    // Two child search records remain, resolved onto ONE user-owned company (the
    // grouped dashboard consolidates them for display only).
    expect(prisma._state.searches).toHaveLength(2);
    expect(prisma._state.companies).toHaveLength(1);
    // Each search holds its own 10-person grant; the shared people rows dedupe,
    // so the grouped unique union stays at 10 — never 20.
    expect(prisma._state.searchPeople.filter((row) => row.searchId === engineer.id)).toHaveLength(10);
    expect(prisma._state.searchPeople.filter((row) => row.searchId === recruiter.id)).toHaveLength(10);
    expect(prisma._state.people.filter((person) => person.userId === USER_ID)).toHaveLength(10);
    expect(new Set(prisma._state.searchPeople.map((row) => row.personId)).size).toBe(10);
  });

  it("deleting the company removes the user's searches, grants, and people together (#delete-group)", async () => {
    const runner = { run: vi.fn() } as unknown as ApifyRunner;
    const { service } = buildService(prisma, runner, ROLE_ONLY_AI, undefined, undefined, pooledCachePort(pooledDataset(30)));

    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
    const companyId = prisma._state.companies[0].id as string;

    await service.deleteCompany(USER_ID, companyId);

    expect(prisma._state.searches).toHaveLength(0);
    expect(prisma._state.people.filter((person) => person.userId === USER_ID)).toHaveLength(0);
    expect(prisma._state.searchPeople).toHaveLength(0);
  });
});

describe("Discover zero-result reprocessing (stored dataset repair)", () => {
  const REPAIR_AI = {
    responses: {
      role_classification: {
        classifications: [
          {
            rawTitle: "Software Engineer III",
            normalizedTitle: "software engineer iii",
            category: "SOFTWARE_ENGINEERING",
            displayName: "Software Engineering",
            confidence: "HIGH"
          }
        ]
      }
    }
  };

  // Items in the CURRENT harvestapi dataset shape whose employer slug is a
  // LinkedIn punctuation alias of the queried one — the exact production shape
  // that used to be rejected wholesale.
  function storedItem(index: number, firstName: string) {
    return {
      id: `stored-${index}`,
      publicIdentifier: `person-${index}`,
      linkedinUrl: `https://www.linkedin.com/in/person-${index}`,
      firstName,
      lastName: "Doe",
      headline: "Software engineer",
      location: { linkedinText: "Plano, Texas, United States" },
      currentPosition: [
        {
          position: "Software Engineer III",
          companyName: "Applied Materials, Inc.",
          companyLinkedinUrl: "https://www.linkedin.com/company/appliedmaterials/"
        }
      ]
    };
  }
  const STORED_ITEMS = [storedItem(0, "Alice"), storedItem(1, "Bob"), storedItem(2, "Cara")];

  function buildRepairSetup() {
    // The live run stored a dataset id but surfaced zero items (the lost-data
    // production case); the stored dataset itself still holds the people.
    const run = vi.fn(async () => ({
      runId: "run-1",
      datasetId: "stored-ds",
      items: [],
      status: "SUCCEEDED",
      statusMessage: null
    }));
    const fetchDatasetItems = vi.fn(async (datasetId: string) => (datasetId === "stored-ds" ? STORED_ITEMS : []));
    const quota = makeQuotaReserver();
    const { service, ai } = buildService(
      prisma,
      { run, fetchDatasetItems } as ApifyRunner,
      REPAIR_AI,
      undefined,
      quota.reserve
    );
    return { service, ai, run, fetchDatasetItems, quota };
  }

  async function seedZeroResultSearch(service: ProspectSearchService) {
    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const ready = await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
    // A live run that surfaces zero items now finalizes as NO_RESULTS (never a
    // "Ready" search with nobody); the stored dataset id is still preserved for
    // the repair below.
    expect(ready.status).toBe("NO_RESULTS");
    expect(ready.totalProcessed).toBe(0);
    expect(ready.apifyDatasetId).toBe("stored-ds");
    expect(prisma._state.searchPeople).toHaveLength(0);
    return ready;
  }

  it("repairs a zero-people search from its stored dataset without a new run or quota charge (#repair-36..39)", async () => {
    const { service, run, fetchDatasetItems, quota } = buildRepairSetup();
    const ready = await seedZeroResultSearch(service);
    const quotaCallsAfterProcess = quota.calls.length;

    // A manual correction that arrived BEFORE the people must apply to them.
    const companyId = prisma._state.companies[0].id as string;
    await service.setCompanyEmailInferenceOverride(USER_ID, {
      companyId,
      emailDomain: "amat.com",
      emailPattern: "first.last",
      confidence: "HIGH"
    });

    const repaired = await service.reprocessSearchFromStoredDataset(USER_ID, ready.id);

    expect(repaired.status).toBe("READY");
    expect(repaired.totalProcessed).toBe(3); // provider items became visible people (#33)
    expect(repaired.totalFound).toBe(3);
    expect(prisma._state.searchPeople).toHaveLength(3); // grants created (#29)

    // The stored dataset was reused — never a second actor run, never quota.
    expect(fetchDatasetItems).toHaveBeenCalledWith("stored-ds");
    expect(run).toHaveBeenCalledTimes(1); // only the original live run (#38)
    expect(quota.calls.length).toBe(quotaCallsAfterProcess); // (#39)

    // People inherited the manual canonical format deterministically (#51,53).
    const alice = prisma._state.people.find((person) => person.firstName === "Alice")!;
    expect(alice.inferredEmail).toBe("alice.doe@amat.com");
    expect(alice.emailStatus).toBe("INFERRED_HIGH"); // inferred, never VERIFIED (#16)
    expect(prisma._state.people.every((person) => person.emailStatus !== "VERIFIED")).toBe(true);

    // The company-level format was not degraded by the repair (#47).
    const company = prisma._state.companies.find((row) => row.id === companyId)!;
    expect(company.emailDomain).toBe("amat.com");
    expect(company.emailPattern).toBe("first.last");
    expect(company.emailFormatAuthority).toBe("MANUAL");
  });

  it("is idempotent — a second repair never duplicates people or allocations (#repair-40,41)", async () => {
    const { service } = buildRepairSetup();
    const ready = await seedZeroResultSearch(service);

    await service.reprocessSearchFromStoredDataset(USER_ID, ready.id);
    const repairedAgain = await service.reprocessSearchFromStoredDataset(USER_ID, ready.id);

    expect(repairedAgain.totalProcessed).toBe(3);
    expect(prisma._state.searchPeople).toHaveLength(3);
    expect(prisma._state.people.filter((person) => person.userId === USER_ID)).toHaveLength(3);
  });

  it("never makes an email-format AI call during repair (#repair-52)", async () => {
    const { service, ai } = buildRepairSetup();
    const ready = await seedZeroResultSearch(service);

    await service.reprocessSearchFromStoredDataset(USER_ID, ready.id);

    expect(ai.callsOfType("email_pattern")).toHaveLength(0);
  });

  it("refuses to reprocess a search without a stored dataset id", async () => {
    const { service, fetchDatasetItems } = buildRepairSetup();
    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);

    await expect(service.reprocessSearchFromStoredDataset(USER_ID, created.id)).rejects.toMatchObject({
      code: "INVALID_STATE"
    });
    expect(fetchDatasetItems).not.toHaveBeenCalled();
  });

  it("fails safely when the stored dataset is no longer available", async () => {
    const { service } = buildRepairSetup();
    const ready = await seedZeroResultSearch(service);
    // Point the stored search at a dataset the provider no longer has.
    const row = prisma._state.searches.find((search) => search.id === ready.id)!;
    row.apifyDatasetId = "gone-ds";

    await expect(service.reprocessSearchFromStoredDataset(USER_ID, ready.id)).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    });
    // The search was not falsely finalized with people it does not have.
    expect(prisma._state.searchPeople).toHaveLength(0);
  });
});

describe("Discover email-format failure handling (no poisoning)", () => {
  const AMAT_PROFILE = () => [profile("am1", "Jane", "Doe", "Software Engineer", "Applied Materials")];

  // A source page whose fetch yields NO usable work-email evidence.
  function emptyPageProvider() {
    const fetchPage = vi.fn(async () => "<html><body>No email information on this page.</body></html>");
    return { provider: new EmailFormatDiscoveryService({ searchProvider: null, fetchPage }), fetchPage };
  }

  // A plain public team page exposing consistent mailto: examples (no bracket table).
  function mailtoPageProvider() {
    const fetchPage = vi.fn(async () =>
      `<ul>
         <li><a href="mailto:jane.doe@amat.com">Jane Doe</a></li>
         <li><a href="mailto:john.smith@amat.com">John Smith</a></li>
       </ul>`
    );
    return { provider: new EmailFormatDiscoveryService({ searchProvider: null, fetchPage }), fetchPage };
  }

  async function seedSearchWithPeople(evidenceProvider?: EmailEvidenceProvider) {
    const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: "r", datasetId: "d", items: AMAT_PROFILE() })) };
    const { service } = buildService(
      prisma,
      runner,
      { responses: { role_classification: { classifications: [] } } },
      evidenceProvider
    );
    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    await service.processSearch(USER_ID, created.id);
    return service;
  }

  it("an initial search that finds no email format does not stamp a freshness marker (Rippling repro)", async () => {
    await seedSearchWithPeople();
    const company = prisma._state.companies[0];
    // The core poison: an empty discovery must NOT look like a completed check.
    expect(company.emailDomain).toBeNull();
    expect(company.emailPattern).toBeNull();
    expect(company.emailFormatDiscoveredAt ?? null).toBeNull();
    const jane = prisma._state.people.find((p) => p.firstName === "Jane")!;
    expect(jane.emailStatus).toBe("UNAVAILABLE");
  });

  it("a source-URL refresh with no evidence stays inconclusive and never poisons freshness", async () => {
    const service = await seedSearchWithPeople();
    const company = prisma._state.companies[0];
    const { provider, fetchPage } = emptyPageProvider();
    // Rebuild a service that shares the SAME prisma state but uses the empty page.
    const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: "r", datasetId: "d", items: [] })) };
    const { service: refresher } = buildService(
      prisma,
      runner,
      { responses: { role_classification: { classifications: [] } } },
      provider
    );

    const updated = await refresher.refreshCompanyEmailFormat(USER_ID, company.id, "https://acme.test/team");

    expect(fetchPage).toHaveBeenCalled();
    expect(updated.emailDomain).toBeNull();
    expect(updated.emailPattern).toBeNull();
    expect(updated.emailFormatDiscoveredAt ?? null).toBeNull(); // no false "last checked"
    expect(prisma._state.people.find((p) => p.firstName === "Jane")!.emailStatus).toBe("UNAVAILABLE");
    void service;
  });

  it("a source-URL refresh that infers first.last from mailto examples updates the company and regenerates people", async () => {
    const service = await seedSearchWithPeople();
    const company = prisma._state.companies[0];
    const { provider, fetchPage } = mailtoPageProvider();
    const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: "r", datasetId: "d", items: [] })) };
    const { service: refresher } = buildService(
      prisma,
      runner,
      { responses: { role_classification: { classifications: [] } } },
      provider
    );

    const updated = await refresher.refreshCompanyEmailFormat(USER_ID, company.id, "https://amat.test/team");

    expect(fetchPage).toHaveBeenCalled();
    expect(updated.emailDomain).toBe("amat.com");
    expect(updated.emailPattern).toBe("first.last");
    expect(updated.emailFormatDiscoveredAt).toBeInstanceOf(Date); // a genuine success stamps freshness
    const jane = prisma._state.people.find((p) => p.firstName === "Jane")!;
    expect(jane.inferredEmail).toBe("jane.doe@amat.com");
    expect(jane.emailStatus).not.toBe("VERIFIED");
    void service;
  });

  it("an empty source-URL refresh never overwrites an existing manual override", async () => {
    const service = await seedSearchWithPeople();
    const company = prisma._state.companies[0];
    // Manual override first — the one flow the user confirmed works.
    await service.setCompanyEmailInferenceOverride(USER_ID, {
      companyId: company.id,
      emailDomain: "amat.com",
      emailPattern: "first_last",
      confidence: "HIGH"
    });
    const afterManual = prisma._state.companies[0];
    expect(afterManual.emailDomain).toBe("amat.com");
    expect(afterManual.emailFormatAuthority).toBe("MANUAL");

    // A later empty AI/source attempt must preserve the manual format entirely.
    const { provider } = emptyPageProvider();
    const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: "r", datasetId: "d", items: [] })) };
    const { service: refresher } = buildService(
      prisma,
      runner,
      { responses: { role_classification: { classifications: [] } } },
      provider
    );
    const updated = await refresher.refreshCompanyEmailFormat(USER_ID, company.id, "https://acme.test/none");

    expect(updated.emailDomain).toBe("amat.com");
    expect(updated.emailPattern).toBe("first_last");
    expect(updated.emailFormatAuthority).toBe("MANUAL");
    expect(prisma._state.people.find((p) => p.firstName === "Jane")!.inferredEmail).toBe("jane_doe@amat.com");
  });
});

// ---------------------------------------------------------------------------
// "Search this company" — same-company role/location search from the company
// detail page (searchCompanyRole).
// ---------------------------------------------------------------------------

describe("Search this company (same-company role/location search)", () => {
  const SCR_ROLE_ONLY = { responses: { role_classification: { classifications: [] } } };

  function companyRunner() {
    // The same provider person on every call — exercises the person-dedupe
    // guarantee for sibling role/location searches of one company.
    const run = vi.fn<ApifyRunner["run"]>(async () => ({
      runId: "run-scr",
      datasetId: "ds-scr",
      items: [profile("scr1", "Jane", "Doe", "Software Engineer", "Applied Materials")]
    }));
    return { run, runner: { run } as ApifyRunner };
  }

  /** One READY Applied Materials search (Software Engineer · United States). */
  async function seedReadyCompany(quota = makeQuotaReserver({ limit: 4 })) {
    const { run, runner } = companyRunner();
    const { service } = buildService(prisma, runner, SCR_ROLE_ONLY, undefined, quota.reserve);
    const created = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const ready = await service.processSearch(USER_ID, created.id, { actorEmail: "u@test.dev" });
    expect(ready.status).toBe("READY");
    const company = prisma._state.companies[0];
    return { service, run, quota, company, firstSearch: ready };
  }

  it("rejects a duplicate role+location without charging quota or calling the provider (#7, #8, #13)", async () => {
    const { service, run, quota, company } = await seedReadyCompany();
    const runsBefore = run.mock.calls.length;
    const consumedBefore = quota.consumed.size;

    await expect(
      service.searchCompanyRole(USER_ID, {
        companyId: company.id,
        // Casing + extra whitespace still collapse onto the existing group.
        jobTitle: "  software   ENGINEER ",
        location: " UNITED  states ",
        actorEmail: "u@test.dev"
      })
    ).rejects.toMatchObject({ code: "DUPLICATE_ROLE_LOCATION" });

    expect(run.mock.calls.length).toBe(runsBefore);
    expect(quota.consumed.size).toBe(consumedBefore);
    expect(prisma._state.searches).toHaveLength(1);
  });

  it("runs a different role for the same company and materializes into the SAME company (#12)", async () => {
    const { service, run, quota, company } = await seedReadyCompany();

    const result = await service.searchCompanyRole(USER_ID, {
      companyId: company.id,
      jobTitle: "Recruiter",
      location: "United States",
      actorEmail: "u@test.dev"
    });

    expect(result.status).toBe("READY");
    expect(result.companyId).toBe(company.id);
    expect(result.requestedTitles).toEqual(["Recruiter"]);
    expect(result.requestedLocations).toEqual(["United States"]);
    expect(prisma._state.companies).toHaveLength(1);
    expect(prisma._state.searches).toHaveLength(2);
    // A real new search: provider ran again and one more quota slot was used.
    expect(run.mock.calls.length).toBe(2);
    expect(quota.consumed.size).toBe(2);
  });

  it("keeps a zero-result same-company role retryable without adding a fake group", async () => {
    let providerCalls = 0;
    const run = vi.fn<ApifyRunner["run"]>(async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return {
          runId: "run-software",
          datasetId: "ds-software",
          items: [profile("scr-software", "Jane", "Doe", "Software Engineer", "Applied Materials")]
        };
      }
      if (providerCalls === 2) {
        return {
          runId: "run-human-zero",
          datasetId: "ds-human-zero",
          // Raw result exists, but strict company matching must reject it.
          items: [profile("wrong-company", "Alex", "Chen", "Human Resources", "Different Company")]
        };
      }
      return {
        runId: "run-human-retry",
        datasetId: "ds-human-retry",
        items: [profile("scr-human", "Morgan", "Lee", "Human Resources", "Applied Materials")]
      };
    });
    const quota = makeQuotaReserver({ limit: 4 });
    const { service } = buildService(prisma, { run } as ApifyRunner, SCR_ROLE_ONLY, undefined, quota.reserve);
    const initial = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const ready = await service.processSearch(USER_ID, initial.id, { actorEmail: "u@test.dev" });
    const company = prisma._state.companies[0];
    expect(ready.status).toBe("READY");

    const noResults = await service.searchCompanyRole(USER_ID, {
      companyId: company.id,
      jobTitle: "Human Resource",
      location: "United States",
      actorEmail: "u@test.dev"
    });

    expect(noResults.status).toBe("NO_RESULTS");
    expect(noResults.totalFound).toBe(1);
    expect(noResults.totalProcessed).toBe(0);
    expect(prisma._state.searches).toHaveLength(2);
    expect(prisma._state.people).toHaveLength(1);
    expect(prisma._state.positions).toHaveLength(1);
    expect(prisma._state.searchPeople.filter((row) => row.searchId === noResults.id)).toHaveLength(0);

    const retried = await service.searchCompanyRole(USER_ID, {
      companyId: company.id,
      jobTitle: "Human Resource",
      location: "United States",
      actorEmail: "u@test.dev",
      idempotencyKey: "retry-human"
    });

    expect(retried.id).toBe(noResults.id);
    expect(retried.status).toBe("READY");
    expect(retried.totalProcessed).toBe(1);
    expect(prisma._state.searches).toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(3);
    // Initial search + one same-company search id; retrying that id is free.
    expect(quota.consumed.size).toBe(2);
  });

  it("same role + different location creates a separate location group (#14)", async () => {
    const { service, company } = await seedReadyCompany();

    const result = await service.searchCompanyRole(USER_ID, {
      companyId: company.id,
      jobTitle: "Software Engineer",
      location: "Canada",
      actorEmail: "u@test.dev"
    });

    expect(result.status).toBe("READY");
    expect(result.companyId).toBe(company.id);
    expect(result.requestedLocations).toEqual(["Canada"]);
    expect(prisma._state.searches).toHaveLength(2);
  });

  it("never duplicates a person the company already has when the provider returns them again (#15)", async () => {
    const { service, company } = await seedReadyCompany();
    expect(prisma._state.people).toHaveLength(1);

    await service.searchCompanyRole(USER_ID, {
      companyId: company.id,
      jobTitle: "Software Engineer",
      location: "Canada",
      actorEmail: "u@test.dev"
    });

    // Same sourceProfileId from the provider → still exactly one person row.
    expect(prisma._state.people).toHaveLength(1);
  });

  it("blocks while an identical role/location search is still running (#9-running)", async () => {
    const { service, company } = await seedReadyCompany();
    prisma._state.searches.push({
      id: "search_running",
      userId: USER_ID,
      companyId: company.id,
      requestedCompany: "Applied Materials",
      requestedTitles: ["Recruiter"],
      requestedLocations: ["United States"],
      status: "SEARCHING_PEOPLE",
      maxResults: 10,
      totalProcessed: 0,
      totalFound: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await expect(
      service.searchCompanyRole(USER_ID, {
        companyId: company.id,
        jobTitle: "Recruiter",
        location: "United States",
        actorEmail: "u@test.dev"
      })
    ).rejects.toMatchObject({
      code: "DUPLICATE_ROLE_LOCATION",
      message: expect.stringContaining("already running")
    });
  });

  it("rejects another user's company before any quota is reserved (#11)", async () => {
    const { service, quota, company } = await seedReadyCompany();
    const callsBefore = quota.calls.length;

    await expect(
      service.searchCompanyRole("user_intruder", {
        companyId: company.id,
        jobTitle: "Recruiter",
        location: "Canada",
        actorEmail: "intruder@test.dev"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(quota.calls.length).toBe(callsBefore);
    expect(prisma._state.searches).toHaveLength(1);
  });

  it("rejects an empty job title with a validation error (#10-validate)", async () => {
    const { service, company } = await seedReadyCompany();
    await expect(
      service.searchCompanyRole(USER_ID, { companyId: company.id, jobTitle: "   ", actorEmail: "u@test.dev" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(prisma._state.searches).toHaveLength(1);
  });

  it("blocks an incomplete location before creating a row, reserving quota, or calling the provider", async () => {
    const { service, run, quota, company } = await seedReadyCompany();
    const runsBefore = run.mock.calls.length;
    const quotaCallsBefore = quota.calls.length;

    await expect(
      service.searchCompanyRole(USER_ID, {
        companyId: company.id,
        jobTitle: "Recruiter",
        location: "Un",
        actorEmail: "u@test.dev"
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(prisma._state.searches).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(runsBefore);
    expect(quota.calls).toHaveLength(quotaCallsBefore);
  });

  it("uses corrected canonical values for duplicate identity before any write or quota", async () => {
    const { service, run, quota, company } = await seedReadyCompany();
    const runsBefore = run.mock.calls.length;
    const quotaCallsBefore = quota.calls.length;

    await expect(
      service.searchCompanyRole(USER_ID, {
        companyId: company.id,
        jobTitle: "Softwre Engineer",
        location: "united states",
        actorEmail: "u@test.dev"
      })
    ).rejects.toMatchObject({ code: "DUPLICATE_ROLE_LOCATION" });

    expect(prisma._state.searches).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(runsBefore);
    expect(quota.calls).toHaveLength(quotaCallsBefore);
  });

  it("a quota-blocked new role leaves a reusable draft — no second row on resubmit (#10-quota)", async () => {
    const quota = makeQuotaReserver({ limit: 1 });
    const { service, company } = await seedReadyCompany(quota);

    await expect(
      service.searchCompanyRole(USER_ID, {
        companyId: company.id,
        jobTitle: "Recruiter",
        location: "Canada",
        actorEmail: "u@test.dev"
      })
    ).rejects.toMatchObject({ code: "DISCOVER_DAILY_LIMIT_REACHED" });
    expect(prisma._state.searches).toHaveLength(2);

    // Resubmitting the same role/location reuses the stranded DRAFT instead of
    // stacking another row (and is blocked by the same quota, not a duplicate).
    await expect(
      service.searchCompanyRole(USER_ID, {
        companyId: company.id,
        jobTitle: "Recruiter",
        location: "Canada",
        actorEmail: "u@test.dev"
      })
    ).rejects.toMatchObject({ code: "DISCOVER_DAILY_LIMIT_REACHED" });
    expect(prisma._state.searches).toHaveLength(2);
  });
});
