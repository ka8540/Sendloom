import type { PrismaClient, User } from "@prisma/client";
import { graphql, parse, validate } from "graphql";
import { describe, expect, it, vi } from "vitest";

import type { GraphQLContext } from "@/graphql/context";
import { createLoaders } from "@/graphql/loaders";
import { resolveFirst } from "@/graphql/pagination";
import { typeDefs } from "@/graphql/schema";
import { createDepthLimitRule } from "@/graphql/security";
import { prospectSchema, resolveGraphiqlEnabled } from "@/graphql/server";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { ProspectError } from "@/services/prospects/prospect-search-service";

function makeContext(options: {
  user: User | null;
  prisma?: FakePrisma;
  userId?: string;
  authError?: string | null;
  services?: Partial<GraphQLContext["services"]>;
}): GraphQLContext {
  const prisma = options.prisma ?? createFakePrisma();
  const userId = options.userId ?? options.user?.id ?? "__anonymous__";
  return {
    user: options.user,
    authError: options.authError ?? null,
    requestId: "test-request",
    prisma: prisma as unknown as PrismaClient,
    services: (options.services ?? {}) as GraphQLContext["services"],
    loaders: createLoaders(prisma as unknown as PrismaClient, userId)
  };
}

const FAKE_USER = { id: "user_A", email: "a@example.com" } as User;

function seedCompany(prisma: FakePrisma, overrides: Record<string, unknown>) {
  const row = {
    name: "Apple",
    normalizedName: "apple",
    officialName: "Apple Inc.",
    officialDomain: "apple.com",
    officialWebsiteDomain: "apple.com",
    officialWebsite: "https://www.apple.com",
    linkedinUrl: null,
    domainConfidence: "HIGH",
    emailDomain: "apple.com",
    emailDomainConfidence: "MEDIUM",
    emailDomainEvidence: null,
    emailPattern: "flast",
    patternConfidence: "MEDIUM",
    patternEvidence: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
  prisma._state.companies.push(row);
  return row;
}

describe("GraphQL authentication (#1)", () => {
  it("rejects unauthenticated access to prospect data", async () => {
    const result = await graphql({
      schema: prospectSchema,
      source: `{ company(id: "x") { id } }`,
      contextValue: makeContext({ user: null })
    });

    expect(result.data?.company ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("surfaces a FORBIDDEN error for a restricted user", async () => {
    const result = await graphql({
      schema: prospectSchema,
      source: `{ companies(first: 5) { totalCount } }`,
      contextValue: makeContext({ user: FAKE_USER, authError: "Your account has been restricted." })
    });
    expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });
});

describe("Production GraphiQL is disabled (#2)", () => {
  it("never enables GraphiQL in production even when the flag is on", () => {
    expect(resolveGraphiqlEnabled("production", true)).toBe(false);
    expect(resolveGraphiqlEnabled("development", true)).toBe(true);
    expect(resolveGraphiqlEnabled("development", false)).toBe(false);
  });
});

describe("Query depth limiting (#3)", () => {
  it("rejects queries deeper than the configured maximum", () => {
    const deepQuery = `
      query {
        company(id: "x") {
          positions {
            people {
              company {
                positions {
                  people {
                    company {
                      positions { id }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    const errors = validate(prospectSchema, parse(deepQuery), [createDepthLimitRule(8)]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/exceeds the maximum allowed depth/);
  });

  it("allows a reasonable shallow query", () => {
    const shallow = `{ company(id: "x") { id name positions { id category } } }`;
    expect(validate(prospectSchema, parse(shallow), [createDepthLimitRule(8)])).toHaveLength(0);
  });
});

describe("Pagination maximum (#4)", () => {
  it("rejects page sizes over 100 and under 1", () => {
    expect(() => resolveFirst(101)).toThrow(/at most 100/);
    expect(() => resolveFirst(0)).toThrow(/positive integer/);
    expect(resolveFirst(50)).toBe(50);
    expect(resolveFirst(undefined, 20)).toBe(20);
  });

  it("enforces the bound through the companies resolver", async () => {
    const result = await graphql({
      schema: prospectSchema,
      source: `{ companies(first: 500) { totalCount } }`,
      contextValue: makeContext({ user: FAKE_USER })
    });
    expect(result.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });
});

describe("Cross-user isolation (#23)", () => {
  it("cannot read another user's company graph", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_B", userId: "user_B" });

    const result = await graphql({
      schema: prospectSchema,
      source: `{ company(id: "comp_B") { id name } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.company).toBeNull();
  });
});

describe("DataLoader batching (#24)", () => {
  it("collapses nested position/person lookups into batched queries", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_A", userId: "user_A" });
    for (const category of ["SOFTWARE_ENGINEERING", "RECRUITING", "DATA_ANALYTICS"]) {
      prisma._state.positions.push({
        id: `pos_${category}`,
        companyId: "comp_A",
        category,
        displayName: category,
        rawTitles: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    for (let i = 0; i < 6; i += 1) {
      prisma._state.people.push({
        id: `person_${i}`,
        userId: "user_A",
        companyId: "comp_A",
        positionId: `pos_${["SOFTWARE_ENGINEERING", "RECRUITING", "DATA_ANALYTICS"][i % 3]}`,
        firstName: `P${i}`,
        lastName: "X",
        fullName: `P${i} X`,
        linkedinUrl: `https://www.linkedin.com/in/p${i}`,
        emailStatus: "UNAVAILABLE",
        emailConfidence: "UNAVAILABLE",
        createdAt: new Date()
      });
    }

    const groupBySpy = vi.spyOn(prisma.prospectPerson, "groupBy");
    const positionsSpy = vi.spyOn(prisma.prospectCompanyPosition, "findMany");
    const peopleSpy = vi.spyOn(prisma.prospectPerson, "findMany");

    const result = await graphql({
      schema: prospectSchema,
      source: `{ company(id: "comp_A") { positions { category peopleCount people { id } } } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    // 3 positions, but each kind of lookup is batched into a single query.
    expect(positionsSpy).toHaveBeenCalledTimes(1);
    expect(peopleSpy).toHaveBeenCalledTimes(1);
    expect(groupBySpy).toHaveBeenCalledTimes(1);
  });
});

describe("No secrets in responses (#25)", () => {
  it("only exposes safe company fields", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_A", userId: "user_A" });

    const result = await graphql({
      schema: prospectSchema,
      source: `{ company(id: "comp_A") { id name officialWebsiteDomain emailDomain emailDomainConfidence emailPattern patternConfidence } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toMatch(/token|secret|apiKey|bearer|password/i);
    expect(result.data?.company).toMatchObject({
      officialWebsiteDomain: "apple.com",
      emailDomain: "apple.com",
      emailPattern: "flast"
    });
  });
});

describe("Company email inference API", () => {
  it("does not expose a stale pattern when email domain is unavailable", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      id: "comp_A",
      userId: "user_A",
      emailDomain: null,
      emailDomainConfidence: "UNAVAILABLE",
      emailPattern: "first.last",
      patternConfidence: "HIGH",
      patternEvidence: [
        {
          pattern: "first.last",
          emailDomain: "esri.com",
          sourceName: "legacy row",
          sourceType: "search_snippet",
          confidence: "HIGH",
          observedAt: "2026-06-18T00:00:00.000Z"
        }
      ]
    });

    const result = await graphql({
      schema: prospectSchema,
      source: `{ company(id: "comp_A") { emailDomain emailPattern patternConfidence patternEvidence { pattern } } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.company).toMatchObject({
      emailDomain: null,
      emailPattern: null,
      patternConfidence: "UNAVAILABLE",
      patternEvidence: []
    });
  });

  it("deletes a company through the owner-scoped mutation", async () => {
    const deleteCompany = vi.fn(async () => true);

    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { deleteCompany(companyId: "comp_A") }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: { prospectSearch: { deleteCompany } as unknown as GraphQLContext["services"]["prospectSearch"] }
      })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deleteCompany).toBe(true);
    expect(deleteCompany).toHaveBeenCalledWith("user_A", "comp_A");
  });

  it("requires auth for refreshing company email format", async () => {
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { refreshCompanyEmailFormat(companyId: "comp_A") { id } }`,
      contextValue: makeContext({ user: null })
    });

    expect(result.data?.refreshCompanyEmailFormat ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("refreshes company email format through the owner-scoped mutation", async () => {
    const refreshCompanyEmailFormat = vi.fn(async () => ({
      id: "comp_A",
      userId: "user_A",
      name: "Esri",
      normalizedName: "esri",
      officialName: "Esri",
      officialDomain: "esri.com",
      officialWebsiteDomain: "esri.com",
      officialWebsite: "https://www.esri.com",
      linkedinUrl: null,
      domainConfidence: "HIGH",
      emailDomain: "esri.com",
      emailDomainConfidence: "HIGH",
      emailDomainEvidence: [],
      emailPattern: "flast",
      patternConfidence: "HIGH",
      patternEvidence: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { refreshCompanyEmailFormat(companyId: "comp_A", sourceUrl: "https://rocketreach.co/esri-email-format_b5c60d6df42e0c51") { id emailDomain emailPattern } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: {
            refreshCompanyEmailFormat
          } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.refreshCompanyEmailFormat).toMatchObject({
      id: "comp_A",
      emailDomain: "esri.com",
      emailPattern: "flast"
    });
    expect(refreshCompanyEmailFormat).toHaveBeenCalledWith(
      "user_A",
      "comp_A",
      "https://rocketreach.co/esri-email-format_b5c60d6df42e0c51"
    );
  });

  it("returns a clear error when email-format search is not configured", async () => {
    const refreshCompanyEmailFormat = vi.fn(async () => {
      throw new ProspectError(
        "NOT_CONFIGURED",
        "No web search provider configured. Paste a public email-format source URL or set WEB_SEARCH_PROVIDER to serper/brave with its API key."
      );
    });

    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { refreshCompanyEmailFormat(companyId: "comp_A") { id } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: {
            refreshCompanyEmailFormat
          } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });

    expect(result.data?.refreshCompanyEmailFormat ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    expect(result.errors?.[0]?.message).toContain("No web search provider configured");
  });

  it("requires auth for AI email-format discovery (#12)", async () => {
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { discoverCompanyEmailFormat(companyId: "comp_A") { id } }`,
      contextValue: makeContext({ user: null })
    });

    expect(result.data?.discoverCompanyEmailFormat ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("discovers an email format through the owner-scoped mutation", async () => {
    const discoverCompanyEmailFormat = vi.fn(async () => ({
      id: "comp_A",
      userId: "user_A",
      name: "Applied Materials",
      normalizedName: "applied materials",
      officialName: "Applied Materials, Inc.",
      officialDomain: "appliedmaterials.com",
      officialWebsiteDomain: "appliedmaterials.com",
      officialWebsite: "https://www.appliedmaterials.com",
      linkedinUrl: null,
      domainConfidence: "HIGH",
      emailDomain: "amat.com",
      emailDomainConfidence: "HIGH",
      emailDomainEvidence: [],
      emailPattern: "first_last",
      patternConfidence: "HIGH",
      patternEvidence: [],
      emailFormatReason: "Public evidence shows first_last on amat.com.",
      emailFormatDiscoveredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { discoverCompanyEmailFormat(companyId: "comp_A", force: true) { id emailDomain emailPattern emailFormatReason } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: {
            discoverCompanyEmailFormat
          } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.discoverCompanyEmailFormat).toMatchObject({
      emailDomain: "amat.com",
      emailPattern: "first_last",
      emailFormatReason: "Public evidence shows first_last on amat.com."
    });
    expect(discoverCompanyEmailFormat).toHaveBeenCalledWith("user_A", "comp_A", { force: true });
  });

  it("surfaces a safe rate-limit error from AI discovery", async () => {
    const discoverCompanyEmailFormat = vi.fn(async () => {
      throw new ProspectError(
        "RATE_LIMITED",
        "You've reached the AI email-format search limit. Try again in about 30 minutes."
      );
    });

    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { discoverCompanyEmailFormat(companyId: "comp_A") { id } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: {
            discoverCompanyEmailFormat
          } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });

    expect(result.data?.discoverCompanyEmailFormat ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    expect(result.errors?.[0]?.message).toContain("limit");
  });
});

describe("Discover quota GraphQL surface", () => {
  it("maps a DISCOVER_DAILY_LIMIT_REACHED service error to a safe structured error (#9)", async () => {
    const processSearch = vi.fn(async () => {
      throw new ProspectError(
        "DISCOVER_DAILY_LIMIT_REACHED",
        "You have used today's 4 Discover searches. You can search again after Jun 20, 2026, 12:00 AM UTC."
      );
    });

    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { processProspectSearch(id: "s1") { id status } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: {
            processSearch
          } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });

    expect(result.data?.processProspectSearch ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("DISCOVER_DAILY_LIMIT_REACHED");
    expect(result.errors?.[0]?.message).toContain("Discover searches");
    // The authenticated session email is what reaches the service — never input.
    expect(processSearch).toHaveBeenCalledWith("user_A", "s1", { actorEmail: "a@example.com" });
  });

  it("requires authentication for the discoverQuota query", async () => {
    const result = await graphql({
      schema: prospectSchema,
      source: `{ discoverQuota { searchesRemaining } }`,
      contextValue: makeContext({ user: null })
    });
    expect(result.data?.discoverQuota ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("exposes the quota query/type and never accepts an email on the create input (#15)", () => {
    expect(typeDefs).toContain("discoverQuota: DiscoverQuota!");
    expect(typeDefs).toContain("type DiscoverQuota");
    const inputBlock = typeDefs.match(/input CreateProspectSearchInput \{[^}]*\}/)?.[0] ?? "";
    expect(inputBlock).not.toContain("email");
  });
});

describe("addMoreDiscoverPeople expansion mutation", () => {
  it("delegates to the expansion service with the session email, never input", async () => {
    const addMorePeople = vi.fn(async () => ({
      id: "exp_1",
      searchId: "s1",
      status: "READY",
      requestedCount: 10,
      addedCount: 10,
      totalPeopleCount: 20,
      quotaRemaining: 2,
      exhausted: false,
      message: "10 new people were added."
    }));

    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { addMoreDiscoverPeople(searchId: "s1", idempotencyKey: "k1") { id status addedCount totalPeopleCount quotaRemaining exhausted message } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          discoverExpansion: { addMorePeople } as unknown as GraphQLContext["services"]["discoverExpansion"]
        }
      })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.addMoreDiscoverPeople).toMatchObject({ addedCount: 10, totalPeopleCount: 20, exhausted: false });
    expect(addMorePeople).toHaveBeenCalledWith({
      userId: "user_A",
      actorEmail: "a@example.com",
      searchId: "s1",
      idempotencyKey: "k1"
    });
  });

  it("requires authentication", async () => {
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { addMoreDiscoverPeople(searchId: "s1", idempotencyKey: "k1") { id } }`,
      contextValue: makeContext({ user: null })
    });
    expect(result.data?.addMoreDiscoverPeople ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a blank idempotency key", async () => {
    const addMorePeople = vi.fn();
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { addMoreDiscoverPeople(searchId: "s1", idempotencyKey: "   ") { id } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: { discoverExpansion: { addMorePeople } as unknown as GraphQLContext["services"]["discoverExpansion"] }
      })
    });
    expect(result.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect(addMorePeople).not.toHaveBeenCalled();
  });

  it("maps the already-running error to its safe code", async () => {
    const addMorePeople = vi.fn(async () => {
      throw new ProspectError("DISCOVER_EXPANSION_ALREADY_RUNNING", "This search is already adding more people.");
    });
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { addMoreDiscoverPeople(searchId: "s1", idempotencyKey: "k1") { id } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: { discoverExpansion: { addMorePeople } as unknown as GraphQLContext["services"]["discoverExpansion"] }
      })
    });
    expect(result.errors?.[0]?.extensions?.code).toBe("DISCOVER_EXPANSION_ALREADY_RUNNING");
  });

  it("resolves ProspectSearch.exhausted from the shared cache state", async () => {
    const prisma = createFakePrisma();
    const fingerprint = "fp_exhausted";
    prisma._state.companies.push({
      id: "comp_A",
      userId: "user_A",
      name: "Apple",
      normalizedName: "apple",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    prisma._state.searches.push({
      id: "s1",
      userId: "user_A",
      companyId: "comp_A",
      requestedCompany: "Apple",
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      maxResults: 10,
      status: "READY",
      totalProcessed: 10,
      cacheFingerprint: fingerprint,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    prisma._state.discoverCache.push({
      id: "dc_1",
      fingerprint,
      providerExhausted: true,
      resultCount: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    // The single cached person is already owned by the user → nothing left.
    prisma._state.discoverCachePeople.push({ id: "dcp_1", cacheId: "dc_1", sortIndex: 0, sourceProfileId: "x1", linkedinUrl: "https://linkedin.com/in/x1" });
    prisma._state.people.push({
      id: "p1",
      userId: "user_A",
      companyId: "comp_A",
      sourceProfileId: "x1",
      linkedinUrl: "https://linkedin.com/in/x1"
    });

    const result = await graphql({
      schema: prospectSchema,
      source: `{ prospectSearch(id: "s1") { id exhausted } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.prospectSearch).toMatchObject({ id: "s1", exhausted: true });
  });
});
