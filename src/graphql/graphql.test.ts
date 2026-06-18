import type { PrismaClient, User } from "@prisma/client";
import { graphql, parse, validate } from "graphql";
import { describe, expect, it, vi } from "vitest";

import type { GraphQLContext } from "@/graphql/context";
import { createLoaders } from "@/graphql/loaders";
import { resolveFirst } from "@/graphql/pagination";
import { createDepthLimitRule } from "@/graphql/security";
import { prospectSchema, resolveGraphiqlEnabled } from "@/graphql/server";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";

function makeContext(options: { user: User | null; prisma?: FakePrisma; userId?: string; authError?: string | null }): GraphQLContext {
  const prisma = options.prisma ?? createFakePrisma();
  const userId = options.userId ?? options.user?.id ?? "__anonymous__";
  return {
    user: options.user,
    authError: options.authError ?? null,
    requestId: "test-request",
    prisma: prisma as unknown as PrismaClient,
    services: {} as GraphQLContext["services"],
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
