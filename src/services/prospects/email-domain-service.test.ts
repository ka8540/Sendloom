import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  EmailDomainService,
  type EmailEvidenceProvider,
  inferPatternFromEmailSample
} from "@/services/prospects/email-domain-service";
import { AiCallBudget } from "@/services/prospects/prospect-ai";
import { createFakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { createMockAi } from "@/services/prospects/__test-utils__/mock-ai";

function budget() {
  return new AiCallBudget({ company_resolution: 2, role_classification: 1, email_pattern: 1 });
}

function evidenceProvider(): EmailEvidenceProvider {
  return {
    async findEvidence() {
      return {
        domainEvidence: [
          {
            emailDomain: "amat.com",
            sourceName: "public format page",
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
            sourceName: "public format page",
            sourceUrl: "https://example.test/applied-materials-email-format",
            sourceType: "public_format_page",
            confidence: "HIGH",
            observedAt: "2026-06-18T00:00:00.000Z"
          }
        ]
      };
    }
  };
}

describe("EmailDomainService.infer", () => {
  it("selects an evidence-backed email domain and pattern", async () => {
    const ai = createMockAi({
      responses: {
        email_pattern: {
          selectedEmailDomain: "amat.com",
          selectedPattern: "first_last",
          confidence: "HIGH",
          reasonSummary: "Evidence indicates amat.com and first_last.",
          evidenceIndexesUsed: [0, 1]
        }
      }
    });
    const service = new EmailDomainService(createFakePrisma() as unknown as PrismaClient, ai.client, evidenceProvider());

    const result = await service.infer({
      userId: "user_1",
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com",
      budget: budget()
    });

    expect(result.selectedEmailDomain).toBe("amat.com");
    expect(result.selectedPattern).toBe("first_last");
    expect(result.emailDomainConfidence).toBe("HIGH");
    expect(result.patternConfidence).toBe("HIGH");
    expect(ai.callsOfType("email_pattern")).toHaveLength(1);
  });

  it("does not call AI or guess when no evidence exists", async () => {
    const ai = createMockAi();
    const service = new EmailDomainService(createFakePrisma() as unknown as PrismaClient, ai.client);

    const result = await service.infer({
      userId: "user_1",
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com",
      budget: budget()
    });

    expect(result.selectedEmailDomain).toBeNull();
    expect(result.selectedPattern).toBeNull();
    expect(result.emailDomainConfidence).toBe("UNAVAILABLE");
    expect(ai.calls).toHaveLength(0);
  });

  it("rejects an AI-selected domain that is not present in evidence", async () => {
    const ai = createMockAi({
      responses: {
        email_pattern: {
          selectedEmailDomain: "appliedmaterials.com",
          selectedPattern: "first_last",
          confidence: "HIGH",
          reasonSummary: "Bad guess",
          evidenceIndexesUsed: [0, 1]
        }
      }
    });
    const service = new EmailDomainService(createFakePrisma() as unknown as PrismaClient, ai.client, evidenceProvider());

    const result = await service.infer({
      userId: "user_1",
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com",
      budget: budget()
    });

    expect(result.selectedEmailDomain).toBe("amat.com");
    expect(result.selectedPattern).toBe("first_last");
  });

  it("rejects an AI-selected pattern that is not present in evidence", async () => {
    const ai = createMockAi({
      responses: {
        email_pattern: {
          selectedEmailDomain: "amat.com",
          selectedPattern: "first.last",
          confidence: "HIGH",
          reasonSummary: "Bad guess",
          evidenceIndexesUsed: [0]
        }
      }
    });
    const service = new EmailDomainService(createFakePrisma() as unknown as PrismaClient, ai.client, evidenceProvider());

    const result = await service.infer({
      userId: "user_1",
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com",
      budget: budget()
    });

    expect(result.selectedEmailDomain).toBe("amat.com");
    expect(result.selectedPattern).toBe("first_last");
  });

  it("rejects personal email domains from evidence", async () => {
    const ai = createMockAi();
    const service = new EmailDomainService(createFakePrisma() as unknown as PrismaClient, ai.client, {
      async findEvidence() {
        return {
          domainEvidence: [
            {
              emailDomain: "gmail.com",
              sourceName: "bad source",
              sourceType: "search_snippet",
              observedPattern: "first_last",
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ],
          patternEvidence: [
            {
              pattern: "first_last",
              emailDomain: "gmail.com",
              sourceName: "bad source",
              sourceType: "search_snippet",
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ]
        };
      }
    });

    const result = await service.infer({
      userId: "user_1",
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com",
      budget: budget()
    });

    expect(result.selectedEmailDomain).toBeNull();
    expect(result.selectedPattern).toBeNull();
    expect(ai.calls).toHaveLength(0);
  });
});

describe("inferPatternFromEmailSample", () => {
  it("detects first_last from a sample email and name", () => {
    expect(inferPatternFromEmailSample("jane_doe@amat.com", "Jane", "Doe")).toBe("first_last");
  });
});
