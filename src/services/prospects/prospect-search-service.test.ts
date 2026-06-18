import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApifyProfileSearchService, type ApifyRunner } from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService } from "@/services/prospects/company-resolution-service";
import { EmailDomainService, type EmailEvidenceProvider } from "@/services/prospects/email-domain-service";
import { ProspectSearchService } from "@/services/prospects/prospect-search-service";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";
import type { ValidatedCreateProspectSearch } from "@/services/prospects/prospect-validation";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { createMockAi } from "@/services/prospects/__test-utils__/mock-ai";

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
});
