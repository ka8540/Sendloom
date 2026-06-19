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
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { createMockAi } from "@/services/prospects/__test-utils__/mock-ai";

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
  evidenceProvider?: EmailEvidenceProvider
) {
  const ai = createMockAi(aiResponses);
  const apify = new ApifyProfileSearchService({ token: "t", actorId: "actor", runner });
  const service = new ProspectSearchService({
    prisma: prisma as unknown as PrismaClient,
    apify,
    companyResolution: new CompanyResolutionService(ai.client),
    roleClassifier: new RoleClassificationService(prisma as unknown as PrismaClient, ai.client),
    emailDomain: new EmailDomainService(prisma as unknown as PrismaClient, ai.client, evidenceProvider)
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
