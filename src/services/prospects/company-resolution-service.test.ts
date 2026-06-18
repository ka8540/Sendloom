import { describe, expect, it } from "vitest";

import { CompanyResolutionService } from "@/services/prospects/company-resolution-service";
import { AiCallBudget } from "@/services/prospects/prospect-ai";
import { createMockAi } from "@/services/prospects/__test-utils__/mock-ai";

function budget() {
  return new AiCallBudget({ company_resolution: 2, role_classification: 1, email_pattern: 1 });
}

describe("CompanyResolutionService", () => {
  it("resolves deterministically from a provided domain without calling AI", async () => {
    const ai = createMockAi();
    const service = new CompanyResolutionService(ai.client);

    const result = await service.resolve({ companyName: "Apple", providedDomain: "apple.com", budget: budget() });

    expect(ai.calls).toHaveLength(0);
    expect(result.officialDomain).toBe("apple.com");
    expect(result.domainConfidence).toBe("HIGH");
    expect(result.normalizedName).toBe("apple");
  });

  it("uses AI to resolve a domain when none is provided", async () => {
    const ai = createMockAi({
      responses: {
        company_resolution: {
          officialName: "Apple Inc.",
          normalizedName: "apple",
          officialDomain: "apple.com",
          officialWebsite: "https://www.apple.com",
          linkedinCompanyUrl: "https://www.linkedin.com/company/apple/",
          confidence: "HIGH",
          requiresConfirmation: false,
          evidence: [{ sourceUrl: null, sourceName: "knowledge", claim: "Apple's domain is apple.com" }]
        }
      }
    });
    const service = new CompanyResolutionService(ai.client);

    const result = await service.resolve({ companyName: "Apple", budget: budget() });
    expect(ai.callsOfType("company_resolution")).toHaveLength(1);
    expect(result.officialDomain).toBe("apple.com");
    expect(result.linkedinCompanyUrl).toBe("https://www.linkedin.com/company/apple/");
  });

  it("never accepts a personal email domain from AI", async () => {
    const ai = createMockAi({
      responses: {
        company_resolution: {
          officialName: "Sketchy Co",
          normalizedName: "sketchy",
          officialDomain: "gmail.com",
          officialWebsite: null,
          linkedinCompanyUrl: null,
          confidence: "HIGH",
          requiresConfirmation: false,
          evidence: []
        }
      }
    });
    const service = new CompanyResolutionService(ai.client);

    const result = await service.resolve({ companyName: "Sketchy Co", budget: budget() });
    expect(result.officialDomain).toBeNull();
    expect(result.requiresConfirmation).toBe(true);
  });

  it("falls back to UNAVAILABLE when AI is disabled and no domain is provided", async () => {
    const ai = createMockAi({ enabled: false });
    const service = new CompanyResolutionService(ai.client);

    const result = await service.resolve({ companyName: "Apple", budget: budget() });
    expect(ai.calls).toHaveLength(0);
    expect(result.officialDomain).toBeNull();
    expect(result.domainConfidence).toBe("UNAVAILABLE");
  });
});
