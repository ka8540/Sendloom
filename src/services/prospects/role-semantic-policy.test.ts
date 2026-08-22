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
    expect(decideRoleMatch({ query, candidate: intent("Backend Software Engineer", "SOFTWARE_ENGINEERING"), context: "CACHE", vectorSimilarity: 0.2 })?.kind).toBe("BROAD_POLICY");
    expect(decideRoleMatch({ query, candidate: intent("Frontend Software Engineer", "SOFTWARE_ENGINEERING"), context: "CACHE" })?.kind).toBe("BROAD_POLICY");
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
      ).toBe("BROAD_POLICY");
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

  it("maps broad HR queries and non-management HR-family titles to one canonical role", () => {
    const queries = ["Human Resource", "Human Resources", "HR"].map((title) =>
      intent(title, "HUMAN_RESOURCES")
    );
    const family = [
      "Human Resources Business Partner",
      "HR Business Partner",
      "Human Resources Generalist",
      "HR Generalist",
      "Human Resources Specialist",
      "HR Specialist",
      "Human Resources Coordinator",
      "HR Coordinator",
      "Human Resources Associate",
      "HR Associate",
      "People Operations",
      "People Operations Specialist",
      "People Partner",
      "HR Operations"
    ].map((title) => intent(title, "HUMAN_RESOURCES"));

    expect(queries.map((query) => query.canonicalRoleKey)).toEqual([
      "human_resources:general",
      "human_resources:general",
      "human_resources:general"
    ]);
    expect(family.every((candidate) => candidate.canonicalRoleKey === "human_resources:general")).toBe(true);
  });

  it("authorizes broad HR-family provider and cache matches without a vector threshold", () => {
    const humanResource = intent("Human Resource", "HUMAN_RESOURCES");
    const hr = intent("HR", "HUMAN_RESOURCES");
    const humanResources = intent("Human Resources", "HUMAN_RESOURCES");

    expect(
      decideRoleMatch({
        query: humanResource,
        candidate: intent("HR Business Partner", "HUMAN_RESOURCES"),
        context: "PROVIDER",
        vectorSimilarity: 0.1
      })?.kind
    ).toBe("ALIAS");
    expect(
      decideRoleMatch({
        query: humanResource,
        candidate: intent("Human Resources Generalist", "HUMAN_RESOURCES"),
        context: "PROVIDER"
      })?.kind
    ).toBe("ALIAS");
    expect(
      decideRoleMatch({
        query: hr,
        candidate: intent("Human Resources Specialist", "HUMAN_RESOURCES"),
        context: "PROVIDER",
        vectorSimilarity: 0.2
      })?.kind
    ).toBe("ALIAS");
    expect(
      decideRoleMatch({
        query: humanResources,
        candidate: intent("People Operations", "HUMAN_RESOURCES"),
        context: "CACHE"
      })?.kind
    ).toBe("ALIAS");
  });

  it("keeps broad HR separate from unrelated, recruiting, and management roles", () => {
    const query = intent("Human Resource", "HUMAN_RESOURCES");
    for (const [title, category] of [
      ["Software Engineer", "SOFTWARE_ENGINEERING"],
      ["Data Scientist", "DATA_SCIENCE"],
      ["Account Executive", "SALES"],
      ["Sales Manager", "SALES"],
      ["Financial Analyst", "FINANCE"],
      ["Product Manager", "PRODUCT"],
      ["Recruiter", "RECRUITING"],
      ["Engineering Manager", "SOFTWARE_ENGINEERING"]
    ] as const) {
      expect(
        decideRoleMatch({
          query,
          candidate: intent(title, category),
          context: "PROVIDER",
          vectorSimilarity: 0.99
        })
      ).toBeNull();
    }

    for (const title of ["HR Director", "VP Human Resources", "Chief People Officer", "Head of Human Resources"]) {
      const candidate = intent(title, "HUMAN_RESOURCES");
      expect(candidate.specialty).toBe("HUMAN_RESOURCES");
      expect(candidate.leadership).toBe("EXECUTIVE");
      expect(candidate.canonicalRoleKey).toBe("human_resources:general");
      expect(decideRoleMatch({ query, candidate, context: "PROVIDER", vectorSimilarity: 0.99 })).toBeNull();
      expect(decideRoleMatch({ query, candidate, context: "CACHE", vectorSimilarity: 0.99 })).toBeNull();
    }
  });

  it("detects broad functional intents algorithmically and authorizes same-category variants", () => {
    const cases = [
      ["Sales Specialist", "SALES", "Senior Sales Specialist", "Sales Coordinator"],
      ["Marketing Specialist", "MARKETING", "Senior Marketing Specialist", "Marketing Coordinator"],
      ["Finance Analyst", "FINANCE", "Senior Finance Analyst", "Finance Associate"],
      ["Operations Specialist", "OPERATIONS", "Senior Operations Specialist", "Operations Coordinator"],
      ["Product Manager", "PRODUCT", "Senior Product Manager", "Group Product Manager"],
      ["Design Specialist", "DESIGN", "Senior Design Specialist", "Design Coordinator"],
      ["Data Analyst", "DATA_ANALYTICS", "Senior Data Analyst", "Analytics Specialist"]
    ] as const;

    for (const [rawQuery, category, firstCandidate, secondCandidate] of cases) {
      const query = intent(rawQuery, category);
      expect(query.breadth).toBe("BROAD");
      for (const title of [firstCandidate, secondCandidate]) {
        expect(
          decideRoleMatch({
            query,
            candidate: intent(title, category),
            context: "PROVIDER",
            vectorSimilarity: 0.1
          })
        ).not.toBeNull();
      }
    }
  });

  it("preserves meaningful specialization and deterministically matches only the same narrow family", () => {
    const cases = [
      ["Sales Operations Specialist", "SALES", "Senior Sales Operations Coordinator", "Account Executive", "SALES"],
      ["Product Marketing Specialist", "MARKETING", "Senior Product Marketing Specialist", "Marketing Coordinator", "MARKETING"],
      ["Financial Planning Analyst", "FINANCE", "Senior Financial Planning Analyst", "Finance Analyst", "FINANCE"],
      ["Revenue Operations Analyst", "OPERATIONS", "Senior Revenue Operations Specialist", "Operations Specialist", "OPERATIONS"],
      ["Data Governance Analyst", "DATA_ANALYTICS", "Senior Data Governance Specialist", "Data Analyst", "DATA_ANALYTICS"]
    ] as const;

    for (const [rawQuery, category, sameFamily, incompatible, incompatibleCategory] of cases) {
      const query = intent(rawQuery, category);
      expect(query.breadth).toBe("NARROW");
      expect(
        decideRoleMatch({
          query,
          candidate: intent(sameFamily, category),
          context: "PROVIDER",
          vectorSimilarity: 0.1
        })?.kind
      ).toBe("FAMILY");
      expect(
        decideRoleMatch({
          query,
          candidate: intent(incompatible, incompatibleCategory),
          context: "PROVIDER",
          vectorSimilarity: 0.99
        })
      ).toBeNull();
    }
  });

  it("uses vectors only as a secondary narrow same-category path with family-token evidence", () => {
    const query = intent("Strategic Financial Planning Analyst", "FINANCE");
    const candidate = intent("Financial Planning and Analysis Consultant", "FINANCE");

    expect(decideRoleMatch({ query, candidate, context: "PROVIDER", vectorSimilarity: 0.89 })).toBeNull();
    expect(
      decideRoleMatch({ query, candidate, context: "PROVIDER", vectorSimilarity: 0.95 })?.kind
    ).toBe("VECTOR");
    expect(
      decideRoleMatch({
        query,
        candidate: intent("Strategic Planning Consultant", "MARKETING"),
        context: "PROVIDER",
        vectorSimilarity: 0.99
      })
    ).toBeNull();
  });

  it("keeps functional identity separate from leadership and applies leadership compatibility", () => {
    const productManager = intent("Product Manager", "PRODUCT");
    const seniorProductManager = intent("Senior Product Manager", "PRODUCT");
    expect(productManager.specialty).not.toBe("MANAGEMENT");
    expect(productManager.leadership).toBe("MANAGER");
    expect(productManager.category).toBe("PRODUCT");
    expect(
      decideRoleMatch({ query: productManager, candidate: seniorProductManager, context: "PROVIDER" })
    ).not.toBeNull();
    expect(
      decideRoleMatch({
        query: productManager,
        candidate: intent("Software Engineering Manager", "SOFTWARE_ENGINEERING"),
        context: "PROVIDER",
        vectorSimilarity: 0.99
      })
    ).toBeNull();

    const salesSpecialist = intent("Sales Specialist", "SALES");
    for (const title of ["Sales Manager", "Sales Director", "VP Sales", "Chief Sales Officer", "Head of Sales"]) {
      expect(
        decideRoleMatch({
          query: salesSpecialist,
          candidate: intent(title, "SALES"),
          context: "PROVIDER",
          vectorSimilarity: 0.99
        })
      ).toBeNull();
    }

    const marketingManager = intent("Marketing Manager", "MARKETING");
    expect(
      decideRoleMatch({
        query: marketingManager,
        candidate: intent("Senior Marketing Manager", "MARKETING"),
        context: "PROVIDER"
      })
    ).not.toBeNull();
    expect(
      decideRoleMatch({
        query: marketingManager,
        candidate: intent("Marketing Specialist", "MARKETING"),
        context: "PROVIDER",
        vectorSimilarity: 0.99
      })
    ).toBeNull();
  });

  it("keeps OTHER fail-closed even with high vector similarity", () => {
    const query = intent("Quantum Mechanic", "OTHER");
    expect(decideRoleMatch({ query, candidate: intent("Quantum Mechanic", "OTHER"), context: "CACHE" })?.kind).toBe("EXACT");
    expect(
      decideRoleMatch({
        query,
        candidate: intent("Chief Wizard", "OTHER"),
        context: "CACHE",
        vectorSimilarity: 0.999
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

  it("builds a useful bounded HR provider plan with the exact request first", () => {
    const intents = [intent("Human Resource", "HUMAN_RESOURCES")];
    expect(buildDeterministicProviderTitlePlan({ intents, maxPerRole: 6, maxTotal: 6 })).toEqual([
      "Human Resource",
      "Human Resources",
      "HR Business Partner",
      "HR Generalist",
      "HR Specialist",
      "People Operations"
    ]);
    expect(buildDeterministicProviderTitlePlan({ intents, maxPerRole: 3, maxTotal: 8 })).toEqual([
      "Human Resource",
      "Human Resources",
      "HR Business Partner"
    ]);
    expect(
      buildDeterministicProviderTitlePlan({
        intents: [intent("Human Resource", "HUMAN_RESOURCES"), intent("HR", "HUMAN_RESOURCES")],
        maxPerRole: 5,
        maxTotal: 5
      })
    ).toEqual(["Human Resource", "HR", "Human Resources", "HR Business Partner", "HR Generalist"]);
  });

  it("builds small generalized broad provider plans without widening narrow families", () => {
    expect(
      buildDeterministicProviderTitlePlan({
        intents: [intent("Sales Specialist", "SALES")],
        maxPerRole: 5,
        maxTotal: 8
      })
    ).toEqual(["Sales Specialist", "Sales Representative", "Sales Associate", "Sales Coordinator"]);
    expect(
      buildDeterministicProviderTitlePlan({
        intents: [intent("Sales Operations Specialist", "SALES")],
        maxPerRole: 5,
        maxTotal: 8
      })
    ).toEqual(["Sales Operations Specialist"]);
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
