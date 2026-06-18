import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApifyProfileSearchService, type ApifyRunner } from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService } from "@/services/prospects/company-resolution-service";
import { EmailPatternService } from "@/services/prospects/email-pattern-service";
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

function profile(id: string, firstName: string, lastName: string, title: string) {
  return {
    id,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    headline: title,
    currentPosition: [{ title, companyName: "Apple" }],
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

function buildService(prisma: FakePrisma, runner: ApifyRunner, aiResponses: Parameters<typeof createMockAi>[0]) {
  const ai = createMockAi(aiResponses);
  const apify = new ApifyProfileSearchService({ token: "t", actorId: "actor", runner });
  const service = new ProspectSearchService({
    prisma: prisma as unknown as PrismaClient,
    apify,
    companyResolution: new CompanyResolutionService(ai.client),
    roleClassifier: new RoleClassificationService(prisma as unknown as PrismaClient, ai.client),
    emailPattern: new EmailPatternService(ai.client)
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
    email_pattern: { selectedPattern: "flast", confidence: "MEDIUM", reasonSummary: "format", evidenceCount: 0 }
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
    const { service, ai } = buildService(prisma, runner, AI_RESPONSES);

    const created = await service.createSearch(USER_ID, VALIDATED);
    const result = await service.processSearch(USER_ID, created.id);

    expect(result.status).toBe("READY"); // (#27)
    expect(result.totalProcessed).toBe(5);

    // One company resolved deterministically from the provided domain.
    const company = prisma._state.companies[0];
    expect(company.officialDomain).toBe("apple.com");
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
