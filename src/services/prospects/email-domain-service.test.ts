import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  EMAIL_FORMAT_MAX_AI_SOURCES,
  CompositeEmailEvidenceProvider,
  EmailDomainService,
  buildCompactEmailFormatAiPayload,
  type EmailEvidenceProvider,
  inferPatternFromEmailSample
} from "@/services/prospects/email-domain-service";
import { AiCallBudget } from "@/services/prospects/prospect-ai";
import { createFakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { createMockAi } from "@/services/prospects/__test-utils__/mock-ai";

function budget() {
  return new AiCallBudget({ company_resolution: 2, role_classification: 1, email_pattern: 1, person_identity: 5 });
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

function conflictingEvidenceProvider(): EmailEvidenceProvider {
  return {
    async findEvidence() {
      return {
        domainEvidence: [
          {
            emailDomain: "amat.com",
            sourceName: "Source A",
            sourceUrl: "https://source-a.test/format",
            sourceType: "public_format_page" as const,
            observedPattern: "first_last" as const,
            percentage: 60,
            confidence: "MEDIUM" as const,
            observedAt: "2026-06-18T00:00:00.000Z"
          },
          {
            emailDomain: "amat.com",
            sourceName: "Source B",
            sourceUrl: "https://source-b.test/format",
            sourceType: "public_format_page" as const,
            observedPattern: "first.last" as const,
            percentage: 55,
            confidence: "MEDIUM" as const,
            observedAt: "2026-06-18T00:00:00.000Z"
          }
        ],
        patternEvidence: [
          {
            pattern: "first_last" as const,
            emailDomain: "amat.com",
            sourceName: "Source A",
            sourceUrl: "https://source-a.test/format",
            sourceType: "public_format_page" as const,
            percentage: 60,
            confidence: "MEDIUM" as const,
            observedAt: "2026-06-18T00:00:00.000Z"
          },
          {
            pattern: "first.last" as const,
            emailDomain: "amat.com",
            sourceName: "Source B",
            sourceUrl: "https://source-b.test/format",
            sourceType: "public_format_page" as const,
            percentage: 55,
            confidence: "MEDIUM" as const,
            observedAt: "2026-06-18T00:00:00.000Z"
          }
        ]
      };
    }
  };
}

describe("CompositeEmailEvidenceProvider", () => {
  it("stops before the AI fallback when deterministic evidence is sufficient", async () => {
    const fallback = { findEvidence: vi.fn(async () => ({})) };
    const provider = new CompositeEmailEvidenceProvider([evidenceProvider(), fallback]);

    const result = await provider.findEvidence({
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com"
    });
    expect(result.domainEvidence?.[0]?.emailDomain).toBe("amat.com");
    expect(fallback.findEvidence).not.toHaveBeenCalled();
  });

  it("continues to the fallback when deterministic evidence is weak", async () => {
    const weak: EmailEvidenceProvider = {
      async findEvidence() {
        return {
          domainEvidence: [{
            emailDomain: "example.com",
            sourceName: "Search snippet",
            sourceType: "search_snippet",
            observedPattern: "first.last",
            confidence: "LOW",
            observedAt: "2026-06-18T00:00:00.000Z"
          }],
          patternEvidence: [{
            pattern: "first.last",
            emailDomain: "example.com",
            sourceName: "Search snippet",
            sourceType: "search_snippet",
            confidence: "LOW",
            observedAt: "2026-06-18T00:00:00.000Z"
          }]
        };
      }
    };
    const fallback = { findEvidence: vi.fn(async () => ({})) };
    const provider = new CompositeEmailEvidenceProvider([weak, fallback]);

    await provider.findEvidence({ companyName: "Example", officialWebsiteDomain: "example.com" });
    expect(fallback.findEvidence).toHaveBeenCalledTimes(1);
  });
});

describe("EmailDomainService.infer", () => {
  it("resolves clear evidence deterministically without calling AI", async () => {
    const ai = createMockAi();
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
    expect(result.decision.decisionCode).toBe("EXACT_COMPANY_MATCH");
    expect(ai.callsOfType("email_pattern")).toHaveLength(0);
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

  it("lowers deterministic confidence when structured source metadata reports a conflict", async () => {
    const ai = createMockAi({ enabled: false });
    const baseProvider = evidenceProvider();
    const service = new EmailDomainService(createFakePrisma() as unknown as PrismaClient, ai.client, {
      async findEvidence(input) {
        return {
          ...(await baseProvider.findEvidence(input)),
          decision: {
            decisionCode: "SOURCE_MAJORITY",
            supportingSourceCount: 2,
            conflictingSourceCount: 1
          }
        };
      }
    });

    const result = await service.infer({
      userId: "user_1",
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com",
      budget: budget()
    });
    expect(result.emailDomainConfidence).toBe("MEDIUM");
    expect(result.patternConfidence).toBe("MEDIUM");
    expect(result.decision.conflictingSourceCount).toBe(1);
  });

  it("calls AI once when credible sources conflict", async () => {
    const ai = createMockAi({
      responses: {
        email_pattern: {
          selectedEmailDomain: "amat.com",
          selectedPattern: "first_last",
          confidence: "MEDIUM",
          decisionCode: "SOURCE_MAJORITY",
          evidenceIndexesUsed: [0, 2]
        }
      }
    });
    const service = new EmailDomainService(
      createFakePrisma() as unknown as PrismaClient,
      ai.client,
      conflictingEvidenceProvider()
    );

    const result = await service.infer({
      userId: "user_1",
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com",
      budget: budget()
    });

    expect(result.selectedEmailDomain).toBe("amat.com");
    expect(result.selectedPattern).toBe("first_last");
    expect(result.patternConfidence).toBe("MEDIUM");
    expect(result.decision.conflictingSourceCount).toBe(1);
    expect(ai.callsOfType("email_pattern")).toHaveLength(1);
  });

  it("retries invalid AI JSON once, then falls back to Needs review", async () => {
    const ai = createMockAi({
      handler() {
        return {
          selectedEmailDomain: "amat.com",
          selectedPattern: "unsupported_pattern",
          confidence: "HIGH",
          decisionCode: "SOURCE_MAJORITY",
          evidenceIndexesUsed: [0]
        };
      }
    });
    const service = new EmailDomainService(
      createFakePrisma() as unknown as PrismaClient,
      ai.client,
      conflictingEvidenceProvider()
    );

    const result = await service.infer({
      userId: "user_1",
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com",
      budget: budget()
    });

    expect(result.selectedEmailDomain).toBe("amat.com");
    expect(result.selectedPattern).toBeNull();
    expect(result.patternConfidence).toBe("UNAVAILABLE");
    expect(result.decision.decisionCode).toBe("INSUFFICIENT_EVIDENCE");
    expect(ai.callsOfType("email_pattern")).toHaveLength(2);
    expect(ai.callsOfType("email_pattern")[1]?.instructions).toContain("corrected JSON only");
  });

  it("does not retry a provider transport failure", async () => {
    const ai = createMockAi({
      handler() {
        throw new Error("provider unavailable");
      }
    });
    const service = new EmailDomainService(
      createFakePrisma() as unknown as PrismaClient,
      ai.client,
      conflictingEvidenceProvider()
    );

    const result = await service.infer({
      userId: "user_1",
      companyName: "Applied Materials",
      officialWebsiteDomain: "appliedmaterials.com",
      budget: budget()
    });
    expect(result.selectedPattern).toBeNull();
    expect(result.decision.decisionCode).toBe("INSUFFICIENT_EVIDENCE");
    expect(ai.callsOfType("email_pattern")).toHaveLength(1);
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

  it("chooses the highest percentage public format evidence", async () => {
    const ai = createMockAi({ enabled: false });
    const service = new EmailDomainService(createFakePrisma() as unknown as PrismaClient, ai.client, {
      async findEvidence() {
        return {
          domainEvidence: [
            {
              emailDomain: "esri.com",
              sourceName: "RocketReach",
              sourceUrl: "https://rocketreach.co/esri-email-format_b5c60d6df42e0c51",
              sourceType: "public_format_page",
              observedPattern: "flast",
              percentage: 84.7,
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            },
            {
              emailDomain: "esri.com",
              sourceName: "RocketReach",
              sourceUrl: "https://rocketreach.co/esri-email-format_b5c60d6df42e0c51",
              sourceType: "public_format_page",
              observedPattern: "firstlast",
              percentage: 6.3,
              confidence: "LOW",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ],
          patternEvidence: [
            {
              pattern: "flast",
              emailDomain: "esri.com",
              percentage: 84.7,
              sourceName: "RocketReach",
              sourceUrl: "https://rocketreach.co/esri-email-format_b5c60d6df42e0c51",
              sourceType: "public_format_page",
              confidence: "HIGH",
              observedAt: "2026-06-18T00:00:00.000Z"
            },
            {
              pattern: "firstlast",
              emailDomain: "esri.com",
              percentage: 6.3,
              sourceName: "RocketReach",
              sourceUrl: "https://rocketreach.co/esri-email-format_b5c60d6df42e0c51",
              sourceType: "public_format_page",
              confidence: "LOW",
              observedAt: "2026-06-18T00:00:00.000Z"
            }
          ]
        };
      }
    });

    const result = await service.infer({
      userId: "user_1",
      companyName: "Esri",
      officialWebsiteDomain: "esri.com",
      budget: budget()
    });

    expect(result.selectedEmailDomain).toBe("esri.com");
    expect(result.selectedPattern).toBe("flast");
    expect(result.patternConfidence).toBe("HIGH");
    expect(result.decision.conflictingSourceCount).toBe(0);
    expect(ai.callsOfType("email_pattern")).toHaveLength(0);
  });

  it("uses the public example email domain over the website domain", async () => {
    const ai = createMockAi({ enabled: false });
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
});

describe("buildCompactEmailFormatAiPayload", () => {
  it("deduplicates and caps structured source claims without page content", () => {
    const base = {
      emailDomain: "example.com",
      sourceType: "public_format_page" as const,
      observedPattern: "first.last" as const,
      percentage: 80,
      confidence: "HIGH" as const,
      observedAt: "2026-06-18T00:00:00.000Z"
    };
    const domainEvidence = Array.from({ length: 8 }, (_, index) => ({
      ...base,
      sourceName: `Source ${index}`,
      sourceUrl: `https://source-${index}.test/format`
    }));
    domainEvidence.push({ ...base, sourceName: "Duplicate", sourceUrl: "https://source-0.test/format" });

    const payload = buildCompactEmailFormatAiPayload({
      companyName: "Example Co",
      websiteDomain: "example.test",
      domainEvidence,
      patternEvidence: []
    });
    expect(payload.sources).toHaveLength(EMAIL_FORMAT_MAX_AI_SOURCES);
    expect(new Set(payload.sources.map((source) => source.url)).size).toBe(payload.sources.length);
    expect(Object.keys(payload)).toEqual(["company", "websiteDomain", "sources"]);
    expect(Object.keys(payload.sources[0] ?? {})).toEqual([
      "index",
      "label",
      "url",
      "sourceType",
      "domain",
      "pattern",
      "percentage",
      "confidence"
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/<html|navigation|employee list|snippet/i);
  });
});

describe("inferPatternFromEmailSample", () => {
  it("detects first_last from a sample email and name", () => {
    expect(inferPatternFromEmailSample("jane_doe@amat.com", "Jane", "Doe")).toBe("first_last");
  });
});
