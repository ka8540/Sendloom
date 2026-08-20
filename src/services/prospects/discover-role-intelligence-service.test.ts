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

  it("falls back safely when embeddings fail and keeps narrow provider filtering", async () => {
    const embeddings = new FakeEmbeddings({}, new Error("provider unavailable"));
    const service = new DiscoverRoleIntelligenceService(classifier, embeddings, new MemoryRoleStore(), config());
    expect(await service.buildProviderTitlePlan(["Software Engineer"], { budget: budget() })).toEqual([
      "Software Engineer"
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

  it("preserves deterministic cache behavior when pgvector storage is unavailable", async () => {
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
  });
});
