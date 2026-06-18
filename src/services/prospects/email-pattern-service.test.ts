import { describe, expect, it } from "vitest";

import { EmailPatternService } from "@/services/prospects/email-pattern-service";
import { AiCallBudget } from "@/services/prospects/prospect-ai";
import { createMockAi } from "@/services/prospects/__test-utils__/mock-ai";

function budget() {
  return new AiCallBudget({ company_resolution: 2, role_classification: 1, email_pattern: 1 });
}

describe("EmailPatternService.infer", () => {
  it("selects a supported pattern from the AI response", async () => {
    const ai = createMockAi({
      responses: {
        email_pattern: { selectedPattern: "flast", confidence: "MEDIUM", reasonSummary: "published format", evidenceCount: 1 }
      }
    });
    const service = new EmailPatternService(ai.client);

    const result = await service.infer({ company: "Apple", domain: "apple.com", budget: budget() });
    expect(result.selectedPattern).toBe("flast");
    expect(result.confidence).toBe("MEDIUM");
    expect(ai.callsOfType("email_pattern")).toHaveLength(1);
  });

  it("rejects an unsupported pattern from AI", async () => {
    const ai = createMockAi({
      responses: {
        email_pattern: { selectedPattern: "weird-format", confidence: "HIGH", reasonSummary: null, evidenceCount: 0 }
      }
    });
    const service = new EmailPatternService(ai.client);

    const result = await service.infer({ company: "Apple", domain: "apple.com", budget: budget() });
    expect(result.selectedPattern).toBeNull();
    expect(result.confidence).toBe("UNAVAILABLE");
  });

  it("does not call AI without a domain", async () => {
    const ai = createMockAi();
    const service = new EmailPatternService(ai.client);

    const result = await service.infer({ company: "Apple", domain: null, budget: budget() });
    expect(ai.calls).toHaveLength(0);
    expect(result.selectedPattern).toBeNull();
  });

  it("respects the per-search budget (runs at most once)", async () => {
    const ai = createMockAi({
      responses: { email_pattern: { selectedPattern: "flast", confidence: "MEDIUM", reasonSummary: null, evidenceCount: 0 } }
    });
    const service = new EmailPatternService(ai.client);
    const sharedBudget = budget();

    await service.infer({ company: "Apple", domain: "apple.com", budget: sharedBudget });
    await service.infer({ company: "Apple", domain: "apple.com", budget: sharedBudget });

    // Budget allows only one pattern call per search.
    expect(ai.callsOfType("email_pattern")).toHaveLength(1);
  });
});
