import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedCachePerson } from "@/services/prospects/discover-cache-service";
import {
  DiscoverRoleIntelligenceService,
  type DiscoverRoleIntelligenceConfig,
  validateRoleIntelligenceConfig
} from "@/services/prospects/discover-role-intelligence-service";
import type { RoleEmbeddingPort } from "@/services/prospects/role-embedding-service";
import { AiCallBudget } from "@/services/prospects/prospect-ai";
import type {
  RoleSemanticIdentity,
  RoleSemanticRecord,
  RoleSemanticSimilarity,
  RoleSemanticStorePort,
  RoleSemanticVector,
  RoleSemanticWrite
} from "@/services/prospects/role-semantic-store";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { createMockAi } from "@/services/prospects/__test-utils__/mock-ai";

const DIMENSIONS = 1536;

function vector(first: number, second = 0): number[] {
  const result = Array.from({ length: DIMENSIONS }, () => 0);
  result[0] = first;
  result[1] = second;
  return result;
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function identityKey(identity: RoleSemanticIdentity, title: string): string {
  return `${identity.embeddingModel}\u0000${identity.embeddingDimensions}\u0000${identity.semanticVersion}\u0000${title}`;
}

class MemoryRoleStore implements RoleSemanticStorePort {
  readonly records = new Map<string, RoleSemanticVector>();
  upsertCalls = 0;

  async findByTitles(titles: readonly string[], identity: RoleSemanticIdentity) {
    const rows = titles.flatMap((title) => {
      const row = this.records.get(identityKey(identity, title));
      return row ? [[title, row] as const] : [];
    });
    return new Map<string, RoleSemanticRecord>(rows);
  }

  async findVectorsByTitles(titles: readonly string[], identity: RoleSemanticIdentity) {
    const rows = titles.flatMap((title) => {
      const row = this.records.get(identityKey(identity, title));
      return row ? [[title, row] as const] : [];
    });
    return new Map(rows);
  }

  async upsertMany(records: readonly RoleSemanticWrite[]) {
    this.upsertCalls += 1;
    for (const record of records) {
      this.records.set(identityKey(record, record.normalizedTitle), {
        id: `semantic-${this.records.size + 1}`,
        ...record
      });
    }
  }

  async findSimilarMany(
    queries: readonly { queryKey: string; category: RoleSemanticRecord["category"]; embedding: number[] }[],
    identity: RoleSemanticIdentity,
    topK: number
  ): Promise<RoleSemanticSimilarity[]> {
    return queries.flatMap((query) =>
      [...this.records.values()]
        .filter(
          (row) =>
            row.embeddingModel === identity.embeddingModel &&
            row.embeddingDimensions === identity.embeddingDimensions &&
            row.semanticVersion === identity.semanticVersion &&
            row.category === query.category
        )
        .map((row) => ({ ...row, queryKey: query.queryKey, similarity: cosine(query.embedding, row.embedding) }))
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, topK)
    );
  }
}

class FakeEmbeddings implements RoleEmbeddingPort {
  readonly enabled: boolean;
  readonly calls: string[][] = [];

  constructor(
    private readonly values: Record<string, number[]>,
    private readonly failure: Error | null = null,
    enabled = true
  ) {
    this.enabled = enabled;
  }

  async embedTitles(titles: readonly string[]): Promise<Map<string, number[]>> {
    this.calls.push([...titles]);
    if (this.failure) throw this.failure;
    return new Map(titles.map((title) => [title, this.values[title] ?? vector(0.5, 0.5)]));
  }
}

function config(overrides: Partial<DiscoverRoleIntelligenceConfig> = {}): DiscoverRoleIntelligenceConfig {
  return {
    enabled: true,
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: DIMENSIONS,
    semanticVersion: "v1",
    maxApifyTitlesPerRole: 5,
    maxApifyTitlesTotal: 8,
    ...overrides
  };
}

function budget() {
  return new AiCallBudget({ company_resolution: 2, role_classification: 1, email_pattern: 1, person_identity: 5 });
}

function person(id: string, title: string, category: string): ResolvedCachePerson {
  return {
    sourceProfileId: id,
    firstName: "Test",
    lastName: id,
    fullName: `Test ${id}`,
    currentTitle: title,
    normalizedTitle: title.toLowerCase(),
    positionCategory: category,
    location: "United States",
    country: "United States",
    state: null,
    city: null,
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    inferredEmail: null,
    emailStatus: "UNAVAILABLE",
    emailConfidence: "UNAVAILABLE",
    emailPattern: null,
    emailSource: null
  };
}

let prisma: FakePrisma;
let classifier: RoleClassificationService;

beforeEach(() => {
  prisma = createFakePrisma();
  classifier = new RoleClassificationService(
    prisma as unknown as PrismaClient,
    createMockAi({ enabled: false }).client
  );
});

describe("DiscoverRoleIntelligenceService", () => {
  it("rejects configuration that cannot match the vector column or title caps", () => {
    expect(() => validateRoleIntelligenceConfig(config({ embeddingDimensions: 3072 }))).toThrow(/vector\(1536\)/);
    expect(() => validateRoleIntelligenceConfig(config({ semanticVersion: "" }))).toThrow(/non-empty/);
    expect(() => validateRoleIntelligenceConfig(config({ maxApifyTitlesPerRole: 9 }))).toThrow(/between 1 and 8/);
  });

  it("ranks exact/related software titles and rejects category or specialty drift", async () => {
    const embeddings = new FakeEmbeddings({
      "software engineer": vector(1, 0),
      "software developer": vector(0.99, 0.01),
      "backend software engineer": vector(0.96, 0.04),
      "product manager": vector(0.99, 0.01),
      "engineering manager": vector(0.99, 0.01),
      "data engineer": vector(0.99, 0.01)
    });
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());
    const ranked = await service.filterAndRankPeople({
      people: [
        person("backend", "Backend Software Engineer", "SOFTWARE_ENGINEERING"),
        person("product", "Product Manager", "PRODUCT"),
        person("exact", "Software Engineer", "SOFTWARE_ENGINEERING"),
        person("alias", "Software Developer", "SOFTWARE_ENGINEERING"),
        person("manager", "Engineering Manager", "SOFTWARE_ENGINEERING"),
        person("data", "Data Engineer", "DATA_ENGINEERING")
      ],
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      context: "CACHE",
      options: { budget: budget(), searchId: "search-role" }
    });

    expect(ranked.map((entry) => entry.sourceProfileId)).toEqual(["exact", "alias", "backend"]);
  });

  it("keeps the audited Software Engineer provider family without admitting unrelated roles", async () => {
    const embeddings = new FakeEmbeddings({ "software engineer": vector(1, 0) });
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());
    const valid = [
      ["software", "Software Engineer"],
      ["senior", "Senior Software Engineer"],
      ["staff", "Staff Software Engineer"],
      ["principal", "Principal Software Engineer"],
      ["architect", "Principal Software Engineer / Architect"],
      ["backend", "Backend Software Engineer"],
      ["frontend", "Frontend Software Engineer"],
      ["application", "Application Developer"],
      ["developer", "Software Developer"],
      ["platform", "Platform Software Engineer"]
    ] as const;
    const ranked = await service.filterAndRankPeople({
      people: [
        ...valid.map(([id, title]) => person(id, title, "SOFTWARE_ENGINEERING")),
        person("recruiter", "Technical Recruiter, Software Engineering", "RECRUITING"),
        person("product", "Product Manager", "PRODUCT"),
        person("data", "Data Engineer", "DATA_ENGINEERING"),
        person("manager", "Engineering Manager", "SOFTWARE_ENGINEERING"),
        person("cto", "CTO", "MANAGEMENT")
      ],
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      context: "PROVIDER",
      options: { budget: budget(), searchId: "rtx-provider-family" }
    });

    expect(ranked.map((entry) => entry.sourceProfileId).sort()).toEqual(valid.map(([id]) => id).sort());
  });

  it("accepts the broad HR provider family with low vector similarity and rejects boundary roles", async () => {
    const valid = [
      ["hrbp-long", "Human Resources Business Partner"],
      ["hrbp", "HR Business Partner"],
      ["generalist-long", "Human Resources Generalist"],
      ["generalist", "HR Generalist"],
      ["specialist-long", "Human Resources Specialist"],
      ["specialist", "HR Specialist"],
      ["coordinator-long", "Human Resources Coordinator"],
      ["coordinator", "HR Coordinator"],
      ["associate-long", "Human Resources Associate"],
      ["associate", "HR Associate"],
      ["people-ops", "People Operations"],
      ["people-ops-specialist", "People Operations Specialist"],
      ["people-partner", "People Partner"],
      ["hr-ops", "HR Operations"]
    ] as const;
    const embeddings = new FakeEmbeddings({
      "human resource": vector(1, 0),
      ...Object.fromEntries(valid.map(([, title]) => [title.toLowerCase(), vector(0, 1)]))
    });
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());
    const ranked = await service.filterAndRankPeople({
      people: [
        ...valid.map(([id, title]) => person(id, title, "HUMAN_RESOURCES")),
        person("recruiter", "Recruiter", "RECRUITING"),
        person("software", "Software Engineer", "SOFTWARE_ENGINEERING"),
        person("sales", "Sales Manager", "SALES"),
        person("director", "HR Director", "HUMAN_RESOURCES"),
        person("vp", "VP Human Resources", "HUMAN_RESOURCES"),
        person("chief", "Chief People Officer", "HUMAN_RESOURCES"),
        person("head", "Head of Human Resources", "HUMAN_RESOURCES")
      ],
      requestedTitles: ["Human Resource"],
      requestedLocations: ["United States"],
      context: "PROVIDER",
      options: { budget: budget(), searchId: "capital-one-broad-hr" }
    });

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.map((entry) => entry.sourceProfileId).sort()).toEqual(valid.map(([id]) => id).sort());
  });

  it("reuses the same broad HR family from cache without vector authorization", async () => {
    const embeddings = new FakeEmbeddings({
      hr: vector(1, 0),
      "human resources specialist": vector(0, 1),
      "people operations": vector(0, 1),
      recruiter: vector(1, 0)
    });
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());
    const ranked = await service.filterAndRankPeople({
      people: [
        person("specialist", "Human Resources Specialist", "HUMAN_RESOURCES"),
        person("people-ops", "People Operations", "HUMAN_RESOURCES"),
        person("recruiter", "Recruiter", "RECRUITING")
      ],
      requestedTitles: ["HR"],
      requestedLocations: ["United States"],
      context: "CACHE",
      options: { budget: budget(), searchId: "broad-hr-cache" }
    });

    expect(ranked.map((entry) => entry.sourceProfileId).sort()).toEqual(["people-ops", "specialist"]);
  });

  it("authorizes broad functional categories without requiring provider vector similarity", async () => {
    const cases = [
      ["Sales Specialist", "SALES", "Senior Sales Specialist", "Sales Coordinator", "Marketing Specialist", "MARKETING"],
      ["Marketing Specialist", "MARKETING", "Senior Marketing Specialist", "Marketing Coordinator", "Sales Specialist", "SALES"],
      ["Finance Analyst", "FINANCE", "Senior Finance Analyst", "Finance Associate", "Data Analyst", "DATA_ANALYTICS"],
      ["Operations Specialist", "OPERATIONS", "Senior Operations Specialist", "Operations Coordinator", "Account Executive", "SALES"],
      ["Product Manager", "PRODUCT", "Senior Product Manager", "Group Product Manager", "Software Engineering Manager", "SOFTWARE_ENGINEERING"],
      ["Design Specialist", "DESIGN", "Senior Design Specialist", "Design Coordinator", "Product Manager", "PRODUCT"],
      ["Data Analyst", "DATA_ANALYTICS", "Senior Data Analyst", "Analytics Specialist", "Data Engineer", "DATA_ENGINEERING"]
    ] as const;

    for (const [rawQuery, category, firstValid, secondValid, invalid, invalidCategory] of cases) {
      const embeddings = new FakeEmbeddings({
        [rawQuery.toLowerCase()]: vector(1, 0),
        [firstValid.toLowerCase()]: vector(0, 1),
        [secondValid.toLowerCase()]: vector(0, 1),
        [invalid.toLowerCase()]: vector(1, 0)
      });
      const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());
      const ranked = await service.filterAndRankPeople({
        people: [
          person("first", firstValid, category),
          person("second", secondValid, category),
          person("invalid", invalid, invalidCategory)
        ],
        requestedTitles: [rawQuery],
        requestedLocations: ["United States"],
        context: "PROVIDER",
        options: { budget: budget(), searchId: `broad-${category.toLowerCase()}` }
      });

      expect(ranked.map((entry) => entry.sourceProfileId).sort()).toEqual(["first", "second"]);
    }
  });

  it("keeps specialized functional queries narrow in the shared decision path", async () => {
    const cases = [
      ["Sales Operations Specialist", "SALES", "Senior Sales Operations Coordinator", "Account Executive"],
      ["Product Marketing Specialist", "MARKETING", "Senior Product Marketing Specialist", "Marketing Coordinator"],
      ["Financial Planning Analyst", "FINANCE", "Senior Financial Planning Analyst", "Finance Analyst"],
      ["Revenue Operations Analyst", "OPERATIONS", "Senior Revenue Operations Specialist", "Operations Specialist"],
      ["Data Governance Analyst", "DATA_ANALYTICS", "Senior Data Governance Specialist", "Data Analyst"]
    ] as const;

    for (const [rawQuery, category, valid, invalid] of cases) {
      const embeddings = new FakeEmbeddings({
        [rawQuery.toLowerCase()]: vector(1, 0),
        [valid.toLowerCase()]: vector(0, 1),
        [invalid.toLowerCase()]: vector(1, 0)
      });
      const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());
      const ranked = await service.filterAndRankPeople({
        people: [person("valid", valid, category), person("invalid", invalid, category)],
        requestedTitles: [rawQuery],
        requestedLocations: ["United States"],
        context: "PROVIDER",
        options: { budget: budget(), searchId: `narrow-${category.toLowerCase()}` }
      });

      expect(ranked.map((entry) => entry.sourceProfileId)).toEqual(["valid"]);
    }
  });

  it("reports aggregate policy, category, and leadership outcomes without candidate PII", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const service = new DiscoverRoleIntelligenceService(
        classifier,
        new FakeEmbeddings({ "sales specialist": vector(1, 0) }),
        new MemoryRoleStore(),
        config()
      );
      const ranked = await service.filterAndRankPeople({
        people: [
          person("valid", "Senior Sales Specialist", "SALES"),
          person("executive", "VP Sales", "SALES"),
          person("category", "Marketing Specialist", "MARKETING")
        ],
        requestedTitles: ["Sales Specialist"],
        requestedLocations: ["United States"],
        context: "PROVIDER",
        options: { budget: budget(), searchId: "aggregate-diagnostics" }
      });

      expect(ranked.map((entry) => entry.sourceProfileId)).toEqual(["valid"]);
      expect(info).toHaveBeenCalledWith(
        "[discover-role-semantic]",
        expect.objectContaining({
          event: "DISCOVER_ROLE_SEMANTIC_POLICY",
          searchId: "aggregate-diagnostics",
          semanticCandidateCount: 3,
          semanticAcceptedCount: 1,
          semanticRejectedCount: 2,
          broadPolicyAcceptedCount: 1,
          categoryRejectedCount: 1,
          leadershipRejectedCount: 1,
          vectorRejectedCount: 0
        })
      );
      expect(JSON.stringify(info.mock.calls)).not.toMatch(/Senior Sales Specialist|VP Sales|Marketing Specialist/);
    } finally {
      info.mockRestore();
    }
  });

  it("keeps the Recruiter provider family including recruiting leaders", async () => {
    const embeddings = new FakeEmbeddings({ "recruiter": vector(1, 0) });
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());
    const valid = [
      ["recruiter", "Recruiter"],
      ["technical", "Technical Recruiter"],
      ["engineering", "Engineering Recruiter"],
      ["ta-recruiter", "Talent Acquisition Recruiter"],
      ["ta-partner", "Talent Acquisition Business Partner"],
      ["ta-specialist", "Talent Acquisition Specialist"],
      ["leader", "Recruiting Leader"],
      ["executive", "Executive Technology Recruiting Leader"],
      ["campus", "Campus Recruiter"]
    ] as const;
    const ranked = await service.filterAndRankPeople({
      people: [
        ...valid.map(([id, title]) => person(id, title, "RECRUITING")),
        person("hr", "HR Business Partner", "HUMAN_RESOURCES"),
        person("engineer", "Software Engineer", "SOFTWARE_ENGINEERING")
      ],
      requestedTitles: ["Recruiter"],
      requestedLocations: ["United States"],
      context: "PROVIDER",
      options: { budget: budget(), searchId: "rtx-recruiter-family" }
    });

    expect(ranked.map((entry) => entry.sourceProfileId).sort()).toEqual(valid.map(([id]) => id).sort());
  });

  it("stores one vector per normalized title and makes no second embedding call", async () => {
    const embeddings = new FakeEmbeddings({ "software engineer": vector(1, 0) });
    const store = new MemoryRoleStore();
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, store, config());

    const first = await service.persistTitleKnowledge(
      [" Software Engineer ", "software engineer", "SOFTWARE ENGINEER"],
      { budget: budget() }
    );
    const second = await service.persistTitleKnowledge(["Software Engineer"], { budget: budget() });

    expect(first).toMatchObject({ existing: 0, created: 1, failed: false });
    expect(second).toMatchObject({ existing: 1, created: 0, failed: false });
    expect(embeddings.calls).toHaveLength(1);
    expect(embeddings.calls[0]).toEqual(["software engineer"]);
    expect(store.records.size).toBe(1);
  });

  it("does not reuse an embedding across semantic versions", async () => {
    const store = new MemoryRoleStore();
    const firstEmbeddings = new FakeEmbeddings({ "software engineer": vector(1, 0) });
    const secondEmbeddings = new FakeEmbeddings({ "software engineer": vector(1, 0) });
    const first = new DiscoverRoleIntelligenceService(classifier, firstEmbeddings, store, config());
    const second = new DiscoverRoleIntelligenceService(
      classifier,
      secondEmbeddings,
      store,
      config({ semanticVersion: "v2" })
    );

    await first.persistTitleKnowledge(["Software Engineer"], { budget: budget() });
    await second.persistTitleKnowledge(["Software Engineer"], { budget: budget() });
    expect(firstEmbeddings.calls).toHaveLength(1);
    expect(secondEmbeddings.calls).toHaveLength(1);
    expect(store.records.size).toBe(2);
  });

  it("uses safe deterministic provider expansions in one bounded plan", async () => {
    const embeddings = new FakeEmbeddings({
      "software engineer": vector(1, 0),
      "ios engineer": vector(0, 1),
      cto: vector(0.5, 0.5)
    });
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());

    expect(await service.buildProviderTitlePlan(["Software Engineer"], { budget: budget() })).toEqual([
      "Software Engineer",
      "Software Developer",
      "Backend Software Engineer",
      "Frontend Software Engineer",
      "Application Developer"
    ]);
    expect(await service.buildProviderTitlePlan(["Software Developer"], { budget: budget() })).toEqual([
      "Software Developer",
      "Backend Software Engineer",
      "Frontend Software Engineer",
      "Application Developer",
      "software engineer"
    ]);
    expect(await service.buildProviderTitlePlan(["iOS Engineer"], { budget: budget() })).toEqual([
      "iOS Engineer",
      "iOS Developer",
      "Mobile iOS Engineer"
    ]);
    expect(await service.buildProviderTitlePlan(["CTO"], { budget: budget() })).toEqual(["CTO", "Chief Technology Officer"]);
  });

  it("expands broad HR in one provider plan while respecting per-role and total caps", async () => {
    const embeddings = new FakeEmbeddings({
      "human resource": vector(1, 0),
      hr: vector(1, 0)
    });
    const expanded = new DiscoverRoleIntelligenceService(
      classifier,
      embeddings,
      new MemoryRoleStore(),
      config({ maxApifyTitlesPerRole: 6, maxApifyTitlesTotal: 6 })
    );
    expect(await expanded.buildProviderTitlePlan(["Human Resource"], { budget: budget() })).toEqual([
      "Human Resource",
      "Human Resources",
      "HR Business Partner",
      "HR Generalist",
      "HR Specialist",
      "People Operations"
    ]);

    const perRoleCapped = new DiscoverRoleIntelligenceService(
      classifier,
      embeddings,
      new MemoryRoleStore(),
      config({ maxApifyTitlesPerRole: 3, maxApifyTitlesTotal: 8 })
    );
    expect(await perRoleCapped.buildProviderTitlePlan(["Human Resource"], { budget: budget() })).toEqual([
      "Human Resource",
      "Human Resources",
      "HR Business Partner"
    ]);

    const totalCapped = new DiscoverRoleIntelligenceService(
      classifier,
      embeddings,
      new MemoryRoleStore(),
      config({ maxApifyTitlesPerRole: 5, maxApifyTitlesTotal: 5 })
    );
    expect(await totalCapped.buildProviderTitlePlan(["Human Resource", "HR"], { budget: budget() })).toEqual([
      "Human Resource",
      "HR",
      "Human Resources",
      "HR Business Partner",
      "HR Generalist"
    ]);
  });

  it("builds one bounded generalized provider plan and keeps narrow inputs exact", async () => {
    const service = new DiscoverRoleIntelligenceService(
      classifier,
      new FakeEmbeddings({
        "sales specialist": vector(1, 0),
        "sales operations specialist": vector(1, 0)
      }),
      new MemoryRoleStore(),
      config({ maxApifyTitlesPerRole: 5, maxApifyTitlesTotal: 5 })
    );

    expect(await service.buildProviderTitlePlan(["Sales Specialist"], { budget: budget() })).toEqual([
      "Sales Specialist",
      "Sales Representative",
      "Sales Associate",
      "Sales Coordinator"
    ]);
    expect(await service.buildProviderTitlePlan(["Sales Operations Specialist"], { budget: budget() })).toEqual([
      "Sales Operations Specialist"
    ]);
  });

  it("falls back safely when embeddings fail and keeps narrow provider filtering", async () => {
    const embeddings = new FakeEmbeddings({}, new Error("provider unavailable"));
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());
    expect(await service.buildProviderTitlePlan(["Software Engineer"], { budget: budget() })).toEqual([
      "Software Engineer",
      "Software Developer",
      "Backend Software Engineer",
      "Frontend Software Engineer",
      "Application Developer"
    ]);
    const cachePeople = await service.filterAndRankPeople({
      people: [
        person("exact", "Software Engineer", "SOFTWARE_ENGINEERING"),
        person("backend", "Backend Engineer", "SOFTWARE_ENGINEERING"),
        person("product", "Product Manager", "PRODUCT")
      ],
      requestedTitles: ["Software Engineer"],
      requestedLocations: [],
      context: "CACHE",
      options: { budget: budget() }
    });
    expect(cachePeople.map((entry) => entry.sourceProfileId)).toEqual(["exact", "backend"]);

    const providerPeople = await service.filterAndRankPeople({
      people: [
        person("ios", "iOS Developer", "SOFTWARE_ENGINEERING"),
        person("backend", "Backend Engineer", "SOFTWARE_ENGINEERING")
      ],
      requestedTitles: ["iOS Engineer"],
      requestedLocations: [],
      context: "PROVIDER",
      options: { budget: budget() }
    });
    expect(providerPeople.map((entry) => entry.sourceProfileId)).toEqual(["ios"]);
  });

  it("performs no embedding or vector-store call when the feature flag is off", async () => {
    const embeddings = new FakeEmbeddings({}, new Error("must not run"), true);
    const store: RoleSemanticStorePort = {
      findByTitles: vi.fn(() => Promise.reject(new Error("must not run"))),
      findVectorsByTitles: vi.fn(() => Promise.reject(new Error("must not run"))),
      upsertMany: vi.fn(() => Promise.reject(new Error("must not run"))),
      findSimilarMany: vi.fn(() => Promise.reject(new Error("must not run")))
    };
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, store, config({ enabled: false }));
    const filtered = await service.filterAndRankPeople({
      people: [person("swe", "Software Developer", "SOFTWARE_ENGINEERING")],
      requestedTitles: ["Software Engineer"],
      requestedLocations: [],
      context: "CACHE",
      options: { budget: budget() }
    });

    expect(filtered).toHaveLength(1);
    expect(await service.buildProviderTitlePlan(["Software Engineer"], { budget: budget() })).toEqual(["Software Engineer"]);
    expect(embeddings.calls).toHaveLength(0);
    expect(store.findByTitles).not.toHaveBeenCalled();
  });

  it("preserves deterministic cache and provider authorization when pgvector storage is unavailable", async () => {
    const embeddings = new FakeEmbeddings({ "software engineer": vector(1, 0) });
    const store: RoleSemanticStorePort = {
      findByTitles: vi.fn(() => Promise.reject(new Error("vector extension unavailable"))),
      findVectorsByTitles: vi.fn(() => Promise.reject(new Error("vector extension unavailable"))),
      upsertMany: vi.fn(() => Promise.reject(new Error("vector extension unavailable"))),
      findSimilarMany: vi.fn(() => Promise.reject(new Error("vector extension unavailable")))
    };
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, store, config());
    const filtered = await service.filterAndRankPeople({
      people: [
        person("software", "Software Developer", "SOFTWARE_ENGINEERING"),
        person("product", "Product Manager", "PRODUCT")
      ],
      requestedTitles: ["Software Engineer"],
      requestedLocations: [],
      context: "CACHE",
      options: { budget: budget() }
    });

    expect(filtered.map((entry) => entry.sourceProfileId)).toEqual(["software"]);
    expect(embeddings.calls).toHaveLength(0);

    const providerFiltered = await service.filterAndRankPeople({
      people: [
        person("sales", "Senior Sales Specialist", "SALES"),
        person("marketing", "Marketing Specialist", "MARKETING")
      ],
      requestedTitles: ["Sales Specialist"],
      requestedLocations: [],
      context: "PROVIDER",
      options: { budget: budget() }
    });
    expect(providerFiltered.map((entry) => entry.sourceProfileId)).toEqual(["sales"]);
    expect(embeddings.calls).toHaveLength(0);
  });
});
