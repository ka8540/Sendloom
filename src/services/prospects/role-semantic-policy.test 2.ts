import { describe, expect, it } from "vitest";

import {
  buildDeterministicProviderTitlePlan,
  decideRoleMatch,
  deriveRoleIntent,
  type RoleIntent
} from "@/services/prospects/role-semantic-policy";

function intent(rawTitle: string, category: Parameters<typeof deriveRoleIntent>[0]["category"]): RoleIntent {
  return deriveRoleIntent({ rawTitle, category, confidence: "HIGH" })!;
}

describe("role semantic policy", () => {
  it("accepts broad software aliases/specialties but rejects incompatible categories and management", () => {
    const query = intent("Software Engineer", "SOFTWARE_ENGINEERING");
    expect(decideRoleMatch({ query, candidate: intent("Software Developer", "SOFTWARE_ENGINEERING"), context: "CACHE" })?.kind).toBe("ALIAS");
    expect(decideRoleMatch({ query, candidate: intent("Backend Software Engineer", "SOFTWARE_ENGINEERING"), context: "CACHE", vectorSimilarity: 0.91 })?.kind).toBe("VECTOR");
    expect(decideRoleMatch({ query, candidate: intent("Frontend Software Engineer", "SOFTWARE_ENGINEERING"), context: "CACHE", vectorSimilarity: 0.9 })?.kind).toBe("VECTOR");
    expect(decideRoleMatch({ query, candidate: intent("Product Manager", "PRODUCT"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();
    expect(decideRoleMatch({ query, candidate: intent("CTO", "MANAGEMENT"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();
    expect(decideRoleMatch({ query, candidate: intent("Engineering Manager", "SOFTWARE_ENGINEERING"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();
    expect(decideRoleMatch({ query, candidate: intent("Data Engineer", "DATA_ENGINEERING"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();
  });

  it("authorizes the bounded broad-SWE provider family even when vector ranking is missing or low", () => {
    const query = intent("Software Engineer", "SOFTWARE_ENGINEERING");
    for (const title of [
      "Backend Software Engineer",
      "Frontend Software Engineer",
      "Full Stack Software Engineer",
      "Platform Software Engineer",
      "Infrastructure Software Engineer"
    ]) {
      expect(
        decideRoleMatch({
          query,
          candidate: intent(title, "SOFTWARE_ENGINEERING"),
          context: "PROVIDER",
          vectorSimilarity: 0.1
        })?.kind
      ).toBe("POLICY");
    }
    expect(
      decideRoleMatch({
        query,
        candidate: intent("Engineering Manager", "SOFTWARE_ENGINEERING"),
        context: "PROVIDER",
        vectorSimilarity: 0.99
      })
    ).toBeNull();
    expect(
      decideRoleMatch({
        query,
        candidate: intent("Data Engineer", "DATA_ENGINEERING"),
        context: "PROVIDER",
        vectorSimilarity: 0.99
      })
    ).toBeNull();
  });

  it("keeps iOS and Forward Deployed intent narrow", () => {
    const ios = intent("iOS Engineer", "SOFTWARE_ENGINEERING");
    expect(decideRoleMatch({ query: ios, candidate: intent("iOS Developer", "SOFTWARE_ENGINEERING"), context: "CACHE" })?.kind).toBe("ALIAS");
    expect(decideRoleMatch({ query: ios, candidate: intent("Mobile iOS Engineer", "SOFTWARE_ENGINEERING"), context: "CACHE" })?.kind).toBe("ALIAS");
    expect(decideRoleMatch({ query: ios, candidate: intent("Backend Engineer", "SOFTWARE_ENGINEERING"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();
    expect(decideRoleMatch({ query: ios, candidate: intent("Data Engineer", "DATA_ENGINEERING"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();

    const fde = intent("Forward Deployed Engineer", "SOFTWARE_ENGINEERING");
    expect(decideRoleMatch({ query: fde, candidate: intent("Forward Deployed Software Engineer", "SOFTWARE_ENGINEERING"), context: "CACHE" })?.kind).toBe("ALIAS");
    expect(decideRoleMatch({ query: fde, candidate: intent("Software Engineer", "SOFTWARE_ENGINEERING"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();
  });

  it("builds bounded, round-robin provider plans with exact roles first", () => {
    const intents = [
      intent("Software Engineer", "SOFTWARE_ENGINEERING"),
      intent("iOS Engineer", "SOFTWARE_ENGINEERING")
    ];
    const plan = buildDeterministicProviderTitlePlan({ intents, maxPerRole: 3, maxTotal: 6 });
    expect(plan.slice(0, 2)).toEqual(["Software Engineer", "iOS Engineer"]);
    expect(plan).toEqual([
      "Software Engineer",
      "iOS Engineer",
      "Software Developer",
      "iOS Developer",
      "Backend Software Engineer",
      "Mobile iOS Engineer"
    ]);

    expect(
      buildDeterministicProviderTitlePlan({
        intents: [intent("Software Developer", "SOFTWARE_ENGINEERING")],
        maxPerRole: 3,
        maxTotal: 5
      })
    ).toEqual(["Software Developer", "Backend Software Engineer", "Frontend Software Engineer"]);
  });

  it("does not expand generic SWE to FDE and keeps CTO narrow", () => {
    const softwarePlan = buildDeterministicProviderTitlePlan({
      intents: [intent("Software Engineer", "SOFTWARE_ENGINEERING")],
      maxPerRole: 8,
      maxTotal: 8
    });
    expect(softwarePlan).not.toContain("Forward Deployed Engineer");

    const ctoPlan = buildDeterministicProviderTitlePlan({
      intents: [intent("CTO", "MANAGEMENT")],
      maxPerRole: 5,
      maxTotal: 8
    });
    expect(ctoPlan).toEqual(["CTO", "Chief Technology Officer"]);
    expect(ctoPlan).not.toContain("Software Engineer");
  });

  it("keeps recruiting separate from HR and specialized engineering from generic SWE", () => {
    const recruiter = intent("Recruiter", "RECRUITING");
    expect(decideRoleMatch({ query: recruiter, candidate: intent("HR Generalist", "HUMAN_RESOURCES"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();

    const software = intent("Software Engineer", "SOFTWARE_ENGINEERING");
    expect(decideRoleMatch({ query: software, candidate: intent("DevOps Engineer", "SOFTWARE_ENGINEERING"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();
    expect(decideRoleMatch({ query: software, candidate: intent("Solutions Engineer", "OTHER"), context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();
  });
});
