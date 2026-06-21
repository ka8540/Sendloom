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
      reasonSummary: "format",
      evidenceIndexesUsed: [0, 1]
    }
  }
};

let prisma: FakePrisma;

beforeEach(() => {
  prisma = createFakePrisma();
});

describe("ProspectSearchService pipeline", () => {
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

    // AI is used at most once per task, never per person (#18, #16):
    // company resolved deterministically (0), roles batched (1), pattern (1).
    expect(ai.callsOfType("company_resolution")).toHaveLength(0);
    expect(ai.callsOfType("role_classification")).toHaveLength(1);
    expect(ai.callsOfType("email_pattern")).toHaveLength(1);
    expect(ai.calls).toHaveLength(2);
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
            reasonSummary: "Evidence indicates amat.com with first_last local parts.",
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
          reasonSummary: "RocketReach evidence indicates flast at esri.com.",
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
      )
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
  companyName: "Applied Materials, Inc.",
  websiteDomain: "appliedmaterials.com",
  selectedEmailDomain: "amat.com",
  selectedPattern: "first_last",
  confidence: "HIGH",
  reasonSummary: "Public evidence shows first_last on amat.com.",
  evidence: [
    {
      sourceName: "RocketReach",
      sourceUrl: "https://rocketreach.co/applied-materials-email-format",
      sourceType: "rocketreach",
      patternRaw: "[first]_[last]",
      normalizedPattern: "first_last",
      exampleEmail: "jane_doe@amat.com",
      emailDomain: "amat.com",
      percentage: 84.7,
      quote: "most common"
    }
  ]
};

const ESRI_RAW = {
  companyName: "Esri",
  websiteDomain: "esri.com",
  selectedEmailDomain: "esri.com",
  selectedPattern: "flast",
  confidence: "HIGH",
  reasonSummary: "RocketReach shows flast on esri.com.",
  evidence: [
    {
      sourceName: "RocketReach",
      sourceUrl: "https://rocketreach.co/esri-email-format",
      sourceType: "rocketreach",
      patternRaw: "[first_initial][last]",
      normalizedPattern: "flast",
      exampleEmail: "jdoe@esri.com",
      emailDomain: "esri.com",
      percentage: 84.7,
      quote: "most common"
    }
  ]
};

function discoveryCaller(response: unknown): EmailFormatWebSearchCaller & { search: ReturnType<typeof vi.fn> } {
  return { enabled: true, model: "gpt-5.5", search: vi.fn(async () => response) };
}

function buildDiscoverService(
  prismaState: FakePrisma,
  options: {
    caller?: EmailFormatWebSearchCaller | null;
    rateLimiter?: (userId: string) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  } = {}
) {
  const ai = createMockAi({ responses: { role_classification: { classifications: [] } } });
  const runner: ApifyRunner = { run: vi.fn(async () => ({ runId: null, datasetId: null, items: [] })) };
  const evidence = options.caller ? new OpenAIEmailFormatDiscoveryService({ caller: options.caller }) : undefined;
  return new ProspectSearchService({
    prisma: prismaState as unknown as PrismaClient,
    apify: new ApifyProfileSearchService({ token: "t", actorId: "actor", runner }),
    companyResolution: new CompanyResolutionService(ai.client),
    roleClassifier: new RoleClassificationService(prismaState as unknown as PrismaClient, ai.client),
    emailDomain: new EmailDomainService(prismaState as unknown as PrismaClient, ai.client, evidence),
    emailFormatRateLimiter: options.rateLimiter ?? (async () => ({ allowed: true, retryAfterSeconds: 0 }))
  });
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
    const service = buildDiscoverService(prisma, { caller });

    await service.discoverCompanyEmailFormat(USER_ID, company.id);

    const updated = prisma._state.companies[0];
    expect(updated.emailDomain).toBe("amat.com");
    expect(updated.emailPattern).toBe("first_last");
    expect(updated.officialWebsiteDomain).toBe("appliedmaterials.com"); // website domain unchanged
    expect(updated.emailFormatReason).toContain("amat.com");
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
    const service = buildDiscoverService(prisma, { caller: discoveryCaller(ESRI_RAW) });

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
      emailFormatDiscoveredAt: new Date()
    });
    seedPerson(prisma, company.id, "p1", "Jane", "Doe");
    const caller = discoveryCaller(APPLIED_MATERIALS_RAW);
    const service = buildDiscoverService(prisma, { caller });

    await service.discoverCompanyEmailFormat(USER_ID, company.id);
    // Cached: no model call, but new people still get their emails generated.
    expect(caller.search).not.toHaveBeenCalled();
    expect(prisma._state.people[0].inferredEmail).toBe("jane_doe@amat.com");

    // Forcing a refresh bypasses the cache and runs the search.
    await service.discoverCompanyEmailFormat(USER_ID, company.id, { force: true });
    expect(caller.search).toHaveBeenCalledTimes(1);
  });

  it("rate limits repeated AI discovery and never calls the model when blocked (#11)", async () => {
    const company = seedDiscoverCompany(prisma);
    seedPerson(prisma, company.id, "p1", "Jane", "Doe");
    const caller = discoveryCaller(APPLIED_MATERIALS_RAW);
    const service = buildDiscoverService(prisma, {
      caller,
      rateLimiter: async () => ({ allowed: false, retryAfterSeconds: 1800 })
    });

    await expect(service.discoverCompanyEmailFormat(USER_ID, company.id)).rejects.toThrow(/limit/i);
    expect(caller.search).not.toHaveBeenCalled();
  });

  it("rejects AI discovery for a company owned by another user (#13)", async () => {
    const company = seedDiscoverCompany(prisma);
    const service = buildDiscoverService(prisma, { caller: discoveryCaller(APPLIED_MATERIALS_RAW) });

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
        reasonSummary: "Evidence indicates amat.com with first_last.",
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
        reasonSummary: "format",
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
    expect(r1.status).toBe("READY");
    expect(r1.totalProcessed).toBe(0); // a genuine zero-result run

    const s2 = await service.createSearch(USER_ID, APPLIED_MATERIALS);
    const r2 = await service.processSearch(USER_ID, s2.id, { actorEmail: "u@test.dev" });
    // The empty cache entry must NOT short-circuit the provider.
    expect(run).toHaveBeenCalledTimes(2);
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
