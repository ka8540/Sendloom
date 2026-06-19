import type { PrismaClient, User } from "@prisma/client";
import { graphql, parse, validate } from "graphql";
import { describe, expect, it, vi } from "vitest";

import type { GraphQLContext } from "@/graphql/context";
import { createLoaders } from "@/graphql/loaders";
import { resolveFirst } from "@/graphql/pagination";
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
