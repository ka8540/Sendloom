import { beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@prisma/client";

import { AiCallBudget } from "@/services/prospects/prospect-ai";
import { RoleClassificationService, deterministicCategory } from "@/services/prospects/role-classification-service";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { createMockAi } from "@/services/prospects/__test-utils__/mock-ai";

function budget() {
  return new AiCallBudget({ company_resolution: 2, role_classification: 1, email_pattern: 1, person_identity: 5 });
}

function aiClassification(entries: Array<{ raw: string; normalized: string; category: string }>) {
  return {
    classifications: entries.map((entry) => ({
      rawTitle: entry.raw,
      normalizedTitle: entry.normalized,
      category: entry.category,
      displayName: entry.category,
      confidence: "MEDIUM"
    }))
  };
}

let prisma: FakePrisma;

beforeEach(() => {
  prisma = createFakePrisma();
});

describe("deterministicCategory", () => {
  it("maps known title shapes without AI", () => {
    expect(deterministicCategory("software engineer")).toBe("SOFTWARE_ENGINEERING");
    expect(deterministicCategory("senior backend engineer")).toBe("SOFTWARE_ENGINEERING");
    expect(deterministicCategory("technical recruiter")).toBe("RECRUITING");
    expect(deterministicCategory("people operations manager")).toBe("HUMAN_RESOURCES");
    expect(deterministicCategory("data analyst")).toBe("DATA_ANALYTICS");
    expect(deterministicCategory("data engineer")).toBe("DATA_ENGINEERING");
    expect(deterministicCategory("data scientist")).toBe("DATA_SCIENCE");
    expect(deterministicCategory("application developer")).toBe("SOFTWARE_ENGINEERING");
    expect(deterministicCategory("ios developer")).toBe("SOFTWARE_ENGINEERING");
    expect(deterministicCategory("forward deployed engineer")).toBe("SOFTWARE_ENGINEERING");
  });

  it("returns null for genuinely unknown titles", () => {
    expect(deterministicCategory("quantum mechanic")).toBeNull();
  });
});

describe("RoleClassificationService.classify", () => {
  it("never calls AI when every title is deterministically known (#11)", async () => {
    const ai = createMockAi();
    const service = new RoleClassificationService(prisma as unknown as PrismaClient, ai.client);

    const result = await service.classify(["Software Engineer", "Technical Recruiter", "Data Analyst"], {
      budget: budget()
    });

    expect(ai.calls).toHaveLength(0);
    expect(result.get("software engineer")?.category).toBe("SOFTWARE_ENGINEERING");
    expect(result.get("data analyst")?.category).toBe("DATA_ANALYTICS");
  });

  it("batches unique unknown titles into a single AI call (#10, #18)", async () => {
    const ai = createMockAi({
      responses: {
        role_classification: aiClassification([{ raw: "Quantum Mechanic", normalized: "quantum mechanic", category: "OTHER" }])
      }
    });
    const service = new RoleClassificationService(prisma as unknown as PrismaClient, ai.client);

    // Five people, but only one unique unknown title.
    await service.classify(
      ["Quantum Mechanic", "Quantum Mechanic", "Quantum Mechanic", "Quantum Mechanic", "Software Engineer"],
      { budget: budget() }
    );

    expect(ai.callsOfType("role_classification")).toHaveLength(1);
    expect(ai.callsOfType("role_classification")[0].inputItemCount).toBe(1);
  });

  it("coerces unknown/invalid AI categories to OTHER (#12, #13)", async () => {
    const ai = createMockAi({
      responses: {
        role_classification: aiClassification([{ raw: "Chief Vibes Officer", normalized: "chief vibes officer", category: "WIZARDRY" }])
      }
    });
    const service = new RoleClassificationService(prisma as unknown as PrismaClient, ai.client);

    const result = await service.classify(["Chief Vibes Officer"], { budget: budget() });
    expect(result.get("chief vibes officer")?.category).toBe("OTHER");
  });

  it("falls back to OTHER when AI is disabled (#13)", async () => {
    const ai = createMockAi({ enabled: false });
    const service = new RoleClassificationService(prisma as unknown as PrismaClient, ai.client);

    const result = await service.classify(["Quantum Mechanic"], { budget: budget() });
    expect(ai.calls).toHaveLength(0);
    expect(result.get("quantum mechanic")?.category).toBe("OTHER");
  });

  it("uses the database cache and skips AI on a second classification (#19)", async () => {
    const first = createMockAi({
      responses: {
        role_classification: aiClassification([{ raw: "Quantum Mechanic", normalized: "quantum mechanic", category: "OTHER" }])
      }
    });
    const serviceA = new RoleClassificationService(prisma as unknown as PrismaClient, first.client);
    await serviceA.classify(["Quantum Mechanic"], { budget: budget() });
    expect(first.calls).toHaveLength(1);

    // A fresh service + AI that would throw if called proves the cache is used.
    const second = createMockAi({ handler: () => { throw new Error("AI must not be called for a cached title"); } });
    const serviceB = new RoleClassificationService(prisma as unknown as PrismaClient, second.client);
    const result = await serviceB.classify(["Quantum Mechanic"], { budget: budget() });

    expect(second.calls).toHaveLength(0);
    expect(result.get("quantum mechanic")?.category).toBe("OTHER");
    expect(result.get("quantum mechanic")?.source).toBe("CACHE");
  });
});
