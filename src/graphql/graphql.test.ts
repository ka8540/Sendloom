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
import { ProspectError, ProspectSearchService } from "@/services/prospects/prospect-search-service";

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

describe("Company emailStatusCounts aggregate (Discover detail dashboard)", () => {
  function seedPerson(prisma: FakePrisma, id: string, emailStatus: string, userId = "user_A") {
    prisma._state.people.push({
      id,
      userId,
      companyId: "comp_A",
      positionId: "pos_1",
      firstName: "Avery",
      // A real surname: a single-letter placeholder is now read as an
      // unresolved initial and correctly yields no inferred address.
      lastName: "Example",
      fullName: "Avery Example",
      linkedinUrl: `https://www.linkedin.com/in/${id}`,
      emailStatus,
      emailConfidence: "UNAVAILABLE",
      createdAt: new Date()
    });
  }

  it("returns user-scoped per-status counts for the company", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_A", userId: "user_A" });
    for (const [index, status] of ["INFERRED_HIGH", "INFERRED_HIGH", "INFERRED_LOW", "UNAVAILABLE", "SUPPRESSED", "INVALID"].entries()) {
      seedPerson(prisma, `person_${index}`, status);
    }
    // Another user's person against the same company id must never be counted.
    seedPerson(prisma, "person_other", "INFERRED_HIGH", "user_B");

    const result = await graphql({
      schema: prospectSchema,
      source: `{ company(id: "comp_A") { emailStatusCounts { status count } } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    const rows = (result.data?.company as { emailStatusCounts: Array<{ status: string; count: number }> })
      .emailStatusCounts;
    const counts = Object.fromEntries(rows.map((row) => [row.status, row.count]));
    // Legacy rows with no persisted address are repaired from the current
    // company format; the weakest company confidence is MEDIUM.
    expect(counts).toEqual({ INFERRED_MEDIUM: 4, SUPPRESSED: 1, INVALID: 1 });
  });

  it("coerces an unknown stored status to UNAVAILABLE instead of breaking the enum", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_A", userId: "user_A" });
    seedPerson(prisma, "person_legacy", "SOMETHING_LEGACY");

    const result = await graphql({
      schema: prospectSchema,
      source: `{ company(id: "comp_A") { emailStatusCounts { status count } } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    const rows = (result.data?.company as { emailStatusCounts: Array<{ status: string; count: number }> })
      .emailStatusCounts;
    expect(rows).toEqual([{ status: "UNAVAILABLE", count: 1 }]);
  });

  it("returns an empty list for a company with no people", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_A", userId: "user_A" });

    const result = await graphql({
      schema: prospectSchema,
      source: `{ company(id: "comp_A") { emailStatusCounts { status count } } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    expect((result.data?.company as { emailStatusCounts: unknown[] }).emailStatusCounts).toEqual([]);
  });
});

describe("Discover delivery-failure overlay (suppression-aware statuses)", () => {
  function seedOverlayPerson(prisma: FakePrisma, id: string, inferredEmail: string | null, emailStatus = "INFERRED_HIGH") {
    prisma._state.people.push({
      id,
      userId: "user_A",
      companyId: "comp_A",
      positionId: "pos_1",
      firstName: "Avery",
      lastName: "Example",
      fullName: "Avery Example",
      linkedinUrl: `https://www.linkedin.com/in/${id}`,
      inferredEmail,
      emailStatus,
      emailConfidence: "HIGH",
      createdAt: new Date()
    });
  }

  const OVERLAY_QUERY = `{
    company(id: "comp_A") { emailStatusCounts { status count } }
    people(companyId: "comp_A", first: 10) { edges { node { id emailStatus } } }
  }`;

  it("a hard-bounced address reads INVALID everywhere (an address problem, not an app failure) and is never counted usable", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_A", userId: "user_A" });
    seedOverlayPerson(prisma, "p_ok", "good@example.com");
    seedOverlayPerson(prisma, "p_failed", "Bounced@Example.com");
    prisma._state.suppressions.push({
      id: "sup_1",
      userId: "user_A",
      email: "bounced@example.com",
      reason: "HARD_BOUNCE",
      source: "gmail-dsn"
    });

    const result = await graphql({
      schema: prospectSchema,
      source: OVERLAY_QUERY,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    const counts = Object.fromEntries(
      (result.data?.company as { emailStatusCounts: Array<{ status: string; count: number }> }).emailStatusCounts.map(
        (row) => [row.status, row.count]
      )
    );
    // The stored INFERRED_HIGH is overlaid to INVALID — no double counting.
    expect(counts).toEqual({ INFERRED_HIGH: 1, INVALID: 1 });
    const statuses = Object.fromEntries(
      (result.data?.people as { edges: Array<{ node: { id: string; emailStatus: string } }> }).edges.map((edge) => [
        edge.node.id,
        edge.node.emailStatus
      ])
    );
    expect(statuses).toEqual({ p_ok: "INFERRED_HIGH", p_failed: "INVALID" });
  });

  it("unsubscribed addresses are never mislabelled INVALID, and manual blocks read SUPPRESSED", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_A", userId: "user_A" });
    seedOverlayPerson(prisma, "p_unsub", "optout@example.com");
    seedOverlayPerson(prisma, "p_blocked", "blocked@example.com");
    prisma._state.suppressions.push(
      { id: "sup_1", userId: "user_A", email: "optout@example.com", reason: "UNSUBSCRIBED", source: "unsubscribe-link" },
      { id: "sup_2", userId: "user_A", email: "blocked@example.com", reason: "MANUAL_BLOCK", source: "manual" }
    );

    const result = await graphql({
      schema: prospectSchema,
      source: OVERLAY_QUERY,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    const statuses = (result.data?.people as { edges: Array<{ node: { emailStatus: string } }> }).edges.map(
      (edge) => edge.node.emailStatus
    );
    expect(statuses.sort()).toEqual(["SUPPRESSED", "UNSUBSCRIBED"]);
    expect(statuses).not.toContain("INVALID");
  });

  it("another user's failure record never affects this user's results", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_A", userId: "user_A" });
    seedOverlayPerson(prisma, "p_1", "shared@example.com");
    prisma._state.suppressions.push({
      id: "sup_other",
      userId: "user_B",
      email: "shared@example.com",
      reason: "HARD_BOUNCE",
      source: "gmail-dsn"
    });

    const result = await graphql({
      schema: prospectSchema,
      source: OVERLAY_QUERY,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    const statuses = (result.data?.people as { edges: Array<{ node: { emailStatus: string } }> }).edges.map(
      (edge) => edge.node.emailStatus
    );
    expect(statuses).toEqual(["INFERRED_HIGH"]);
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
      emailFormatDiscoveryStatus: "FOUND",
      emailFormatDiscoveryReason: null,
      emailFormatDiscoveryAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { discoverCompanyEmailFormat(companyId: "comp_A", force: true) { id emailDomain emailPattern emailFormatReason emailFormatDiscoveryStatus emailFormatDiscoveryReason } }`,
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
      emailFormatReason: "Public evidence shows first_last on amat.com.",
      emailFormatDiscoveryStatus: "FOUND",
      emailFormatDiscoveryReason: null
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

  it("exposes parser failure distinctly from genuine no-evidence", async () => {
    const discoverCompanyEmailFormat = vi.fn(async () => ({
      id: "comp_A",
      userId: "user_A",
      name: "Example",
      normalizedName: "example",
      canonicalKey: "domain:example.com",
      officialName: "Example",
      officialDomain: "example.com",
      officialWebsiteDomain: "example.com",
      officialWebsite: "https://example.com",
      linkedinUrl: null,
      domainConfidence: "HIGH",
      emailDomain: null,
      emailDomainConfidence: "UNAVAILABLE",
      emailDomainEvidence: [],
      emailPattern: null,
      patternConfidence: "UNAVAILABLE",
      patternEvidence: [],
      emailFormatAuthority: "UNRESOLVED",
      emailFormatReason: null,
      emailFormatDiscoveredAt: null,
      emailFormatDiscoveryStatus: "PARSER_REJECTED_RESPONSE",
      emailFormatDiscoveryReason: "The provider response could not be parsed safely.",
      emailFormatDiscoveryAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { discoverCompanyEmailFormat(companyId: "comp_A") { emailFormatDiscoveryStatus emailFormatDiscoveryReason } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: { discoverCompanyEmailFormat } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.discoverCompanyEmailFormat).toEqual({
      emailFormatDiscoveryStatus: "PARSER_REJECTED_RESPONSE",
      emailFormatDiscoveryReason: "The provider response could not be parsed safely."
    });
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
    expect(processSearch).toHaveBeenCalledWith("user_A", "s1", {
      actorEmail: "a@example.com",
      idempotencyKey: null
    });
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

describe("Discover failure surface is sanitized", () => {
  it("maps a FAILED search's raw internal code to a safe public category + copy (#error-1, #error-2)", async () => {
    const prisma = createFakePrisma();
    prisma._state.searches.push({
      id: "s1",
      userId: "user_A",
      requestedCompany: "Totally Unknown Co",
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      maxResults: 10,
      status: "FAILED",
      // The raw internal code + technical instructions live only in the DB.
      errorCode: "COMPANY_UNRESOLVED",
      errorMessage:
        "Could not resolve this company well enough to run a targeted profile search. Add a company website domain or LinkedIn company URL and try again.",
      totalProcessed: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const result = await graphql({
      schema: prospectSchema,
      source: `{ prospectSearch(id: "s1") { status errorCode errorTitle errorMessage retryable } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma })
    });

    const search = result.data?.prospectSearch as Record<string, unknown> | null;
    expect(search?.status).toBe("FAILED");
    expect(search?.errorCode).toBe("COMPANY_NOT_FOUND");
    expect(search?.errorTitle).toBe("We couldn't identify this company");
    expect(search?.retryable).toBe(true);
    // The raw internal code + technical instructions never reach the client.
    const serialized = JSON.stringify(search);
    expect(serialized).not.toContain("COMPANY_UNRESOLVED");
    expect(serialized).not.toMatch(/LinkedIn company URL|website domain/i);
  });

  it("exposes no error fields for a non-FAILED search", async () => {
    const prisma = createFakePrisma();
    prisma._state.searches.push({
      id: "s2",
      userId: "user_A",
      requestedCompany: "Apple",
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      maxResults: 10,
      status: "DRAFT",
      errorCode: null,
      errorMessage: null,
      totalProcessed: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const result = await graphql({
      schema: prospectSchema,
      source: `{ prospectSearch(id: "s2") { status errorCode errorTitle errorMessage retryable } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma })
    });

    const search = result.data?.prospectSearch as Record<string, unknown> | null;
    expect(search?.errorCode).toBeNull();
    expect(search?.errorTitle).toBeNull();
    expect(search?.retryable).toBe(false);
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
      totalPeopleCount: 45,
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
    expect(result.data?.addMoreDiscoverPeople).toMatchObject({ addedCount: 10, totalPeopleCount: 45, exhausted: false });
    expect(addMorePeople).toHaveBeenCalledWith({
      userId: "user_A",
      actorEmail: "a@example.com",
      searchId: "s1",
      idempotencyKey: "k1"
    });
  });

  it("resolves the UI-facing search people count from 45 durable allocations", async () => {
    const prisma = createFakePrisma();
    prisma._state.searches.push({
      id: "rtx_search",
      userId: FAKE_USER.id,
      companyId: null,
      requestedCompany: "RTX Corporation",
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      maxResults: 10,
      status: "READY",
      // Deliberately stale: the resolver must prefer durable grants.
      totalProcessed: 35,
      totalFound: 35,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    for (let index = 1; index <= 45; index += 1) {
      prisma._state.searchPeople.push({
        id: `rtx_allocation_${index}`,
        searchId: "rtx_search",
        personId: `rtx_person_${index}`,
        userId: FAKE_USER.id,
        allocationOrder: index - 1,
        allocationSource: index <= 35 ? "CACHE" : "ADD_MORE_PROVIDER",
        allocatedAt: new Date()
      });
    }

    const result = await graphql({
      schema: prospectSchema,
      source: `{ prospectSearch(id: "rtx_search") { peopleCount } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.prospectSearch).toEqual({ peopleCount: 45 });
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

describe("deleteProspectSearch mutation", () => {
  // deleteSearch only touches prisma; the other deps are never exercised here.
  function realProspectService(prisma: FakePrisma) {
    return new ProspectSearchService({
      prisma: prisma as unknown as PrismaClient,
      apify: {} as never,
      companyResolution: {} as never,
      roleClassifier: {} as never,
      emailDomain: {} as never
    });
  }

  function seed(prisma: FakePrisma, id: string, userId: string) {
    prisma._state.searches.push({
      id,
      userId,
      requestedCompany: "Apple",
      requestedTitles: [],
      requestedLocations: [],
      maxResults: 10,
      status: "READY",
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  it("deletes the owner's search but refuses another user's id (#8, #14)", async () => {
    const prisma = createFakePrisma();
    seed(prisma, "mine", "user_A");
    seed(prisma, "theirs", "user_B");
    const services = { prospectSearch: realProspectService(prisma) } as unknown as GraphQLContext["services"];

    const ok = await graphql({
      schema: prospectSchema,
      source: `mutation { deleteProspectSearch(id: "mine") }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, services })
    });
    expect(ok.errors).toBeUndefined();
    expect(ok.data?.deleteProspectSearch).toBe(true);
    expect(prisma._state.searches.map((row) => row.id)).toEqual(["theirs"]);

    const denied = await graphql({
      schema: prospectSchema,
      source: `mutation { deleteProspectSearch(id: "theirs") }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, services })
    });
    // A non-owned id reads as not-found and is never deleted.
    expect(denied.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    expect(prisma._state.searches.map((row) => row.id)).toEqual(["theirs"]);
  });

  it("requires authentication", async () => {
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { deleteProspectSearch(id: "s1") }`,
      contextValue: makeContext({ user: null })
    });
    expect(result.data?.deleteProspectSearch ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });
});

describe("Grouped Search History GraphQL surface", () => {
  it("requires authentication for discoverCompanyGroups (#47)", async () => {
    const result = await graphql({
      schema: prospectSchema,
      source: `{ discoverCompanyGroups { totalCount } }`,
      contextValue: makeContext({ user: null })
    });
    expect(result.data?.discoverCompanyGroups ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("exposes the grouped connection, search categories, and company searches in the schema", () => {
    expect(typeDefs).toContain("discoverCompanyGroups(first: Int = 20, after: String): DiscoverCompanyGroupConnection!");
    expect(typeDefs).toContain("type DiscoverCompanyGroup");
    expect(typeDefs).toContain("positionCategories: [PositionCategory!]!");
    expect(typeDefs).toContain("searches: [ProspectSearch!]!");
  });

  it("groups the user's role searches into one company entry with a UNIQUE allocated people count (#18, #21, #22, #23)", async () => {
    const prisma = createFakePrisma();
    const COMPANY_ID = "comp_walmart";
    seedCompany(prisma, { id: COMPANY_ID, userId: "user_A", name: "Walmart Inc." });
    prisma._state.positions.push({
      id: "pos_se",
      companyId: COMPANY_ID,
      category: "SOFTWARE_ENGINEERING",
      displayName: "Software Engineering",
      rawTitles: ["Software Engineer"],
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const mkSearch = (id: string, titles: string[], createdAt: Date) => {
      prisma._state.searches.push({
        id,
        userId: "user_A",
        companyId: COMPANY_ID,
        requestedCompany: "Walmart",
        requestedTitles: titles,
        requestedLocations: ["United States"],
        maxResults: 10,
        status: "READY",
        totalProcessed: 2,
        totalFound: 2,
        createdAt,
        updatedAt: createdAt
      });
    };
    mkSearch("s_engineer", ["Software Engineer"], new Date("2026-07-04T10:00:00.000Z"));
    mkSearch("s_recruiter", ["Recruiter"], new Date("2026-07-04T09:00:00.000Z"));
    const mkPerson = (id: string, sourceProfileId: string) => {
      prisma._state.people.push({
        id,
        userId: "user_A",
        companyId: COMPANY_ID,
        positionId: "pos_se",
        sourceProfileId,
        firstName: "P",
        lastName: id,
        fullName: `P ${id}`,
        linkedinUrl: `https://www.linkedin.com/in/${id}`,
        currentTitle: "Software Engineer",
        normalizedTitle: "software engineer",
        inferredEmail: null,
        emailStatus: "UNAVAILABLE",
        emailConfidence: "UNAVAILABLE",
        emailPattern: null,
        emailSource: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    };
    mkPerson("p1", "sp1");
    mkPerson("p2", "sp2");
    mkPerson("p3", "sp3");
    // p2 is allocated by BOTH role searches — the grouped count must be 3, not 4.
    const grant = (searchId: string, personId: string, order: number) =>
      prisma._state.searchPeople.push({
        id: `g_${searchId}_${personId}`,
        searchId,
        personId,
        userId: "user_A",
        allocationOrder: order,
        allocationSource: "CACHE",
        allocatedAt: new Date()
      });
    grant("s_engineer", "p1", 0);
    grant("s_engineer", "p2", 1);
    grant("s_recruiter", "p2", 0);
    grant("s_recruiter", "p3", 1);

    const result = await graphql({
      schema: prospectSchema,
      source: `{
        discoverCompanyGroups {
          totalCount
          edges {
            node {
              id
              displayName
              requestedRoles
              peopleCount
              searches { id }
              company { id name }
            }
          }
        }
      }`,
      contextValue: makeContext({ user: FAKE_USER, prisma })
    });

    expect(result.errors).toBeUndefined();
    const connection = result.data?.discoverCompanyGroups as {
      totalCount: number;
      edges: Array<{
        node: {
          id: string;
          requestedRoles: string[];
          peopleCount: number;
          searches: Array<{ id: string }>;
          company: { id: string; name: string } | null;
        };
      }>;
    };
    // ONE grouped entry (pagination counts groups), holding BOTH child searches.
    expect(connection.totalCount).toBe(1);
    expect(connection.edges).toHaveLength(1);
    const node = connection.edges[0].node;
    expect(node.company?.id).toBe("comp_walmart");
    expect(node.requestedRoles).toEqual(["Software Engineer", "Recruiter"]);
    expect(node.searches.map((child) => child.id).sort()).toEqual(["s_engineer", "s_recruiter"]);
    // Unique union of the user's allocations: p1, p2, p3 → 3 (p2 counted once).
    expect(node.peopleCount).toBe(3);
  });

  it("never exposes another user's searches through the grouped query (#42, #47)", async () => {
    const prisma = createFakePrisma();
    const OTHER_COMPANY_ID = "comp_other";
    seedCompany(prisma, { id: OTHER_COMPANY_ID, userId: "user_B", name: "Walmart Inc." });
    prisma._state.searches.push({
      id: "s_other",
      userId: "user_B",
      companyId: OTHER_COMPANY_ID,
      requestedCompany: "Walmart",
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      maxResults: 10,
      status: "READY",
      totalProcessed: 10,
      totalFound: 10,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const result = await graphql({
      schema: prospectSchema,
      source: `{ discoverCompanyGroups { totalCount edges { node { id } } } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma })
    });

    expect(result.errors).toBeUndefined();
    expect((result.data?.discoverCompanyGroups as { totalCount: number }).totalCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Discover role/location input-integrity boundaries.
// ---------------------------------------------------------------------------

describe("createProspectSearch input integrity", () => {
  const MUTATION = `mutation Create($input: CreateProspectSearchInput!) {
    createProspectSearch(input: $input) { id requestedTitles requestedLocations }
  }`;

  it("rejects an incomplete location before the service can write a search", async () => {
    const createSearch = vi.fn();
    const result = await graphql({
      schema: prospectSchema,
      source: MUTATION,
      variableValues: {
        input: { companyName: "Apple", jobTitles: ["Recruiter"], locations: ["Un"] }
      },
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: { createSearch } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });

    expect(result.data?.createProspectSearch ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect(createSearch).not.toHaveBeenCalled();
  });

  it("passes only canonical corrected labels to the service", async () => {
    const createSearch = vi.fn(async (_userId: string, input: Record<string, unknown>) => ({
      id: "s_canonical",
      userId: "user_A",
      companyId: null,
      requestedCompany: "Apple",
      requestedTitles: input.jobTitles,
      requestedLocations: input.locations,
      maxResults: 10,
      status: "DRAFT",
      totalProcessed: 0,
      totalFound: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    const result = await graphql({
      schema: prospectSchema,
      source: MUTATION,
      variableValues: {
        input: {
          companyName: "Apple",
          jobTitles: ["Softwre Engineer", "SOFtenginner"],
          locations: ["united states"]
        }
      },
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: { createSearch } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });

    expect(result.errors).toBeUndefined();
    expect(createSearch).toHaveBeenCalledWith(
      "user_A",
      expect.objectContaining({ jobTitles: ["Software Engineer"], locations: ["United States"] })
    );
    expect(result.data?.createProspectSearch).toMatchObject({
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"]
    });
  });
});

// ---------------------------------------------------------------------------
// "Search this company" mutation + location-filtered people query.
// ---------------------------------------------------------------------------

describe("searchCompanyRole mutation (Search this company)", () => {
  const MUTATION = `mutation {
    searchCompanyRole(companyId: "comp_A", jobTitle: "Recruiter", location: "Canada", idempotencyKey: "k1") {
      id
      status
      peopleCount
      requestedTitles
      requestedLocations
    }
  }`;

  it("rejects unauthenticated requests before touching the service (#10)", async () => {
    const searchCompanyRole = vi.fn();
    const result = await graphql({
      schema: prospectSchema,
      source: MUTATION,
      contextValue: makeContext({
        user: null,
        services: {
          prospectSearch: { searchCompanyRole } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    expect(searchCompanyRole).not.toHaveBeenCalled();
  });

  it("rejects an incomplete location before the same-company service is called", async () => {
    const searchCompanyRole = vi.fn();
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation {
        searchCompanyRole(companyId: "comp_A", jobTitle: "Recruiter", location: "Un") { id }
      }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: { searchCompanyRole } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });

    expect(result.data?.searchCompanyRole ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect(searchCompanyRole).not.toHaveBeenCalled();
  });

  it("runs a valid new role/location with the session user's id and email (#12)", async () => {
    const searchCompanyRole = vi.fn(async () => ({
      id: "s_new",
      userId: "user_A",
      companyId: "comp_A",
      requestedCompany: "Apple",
      requestedTitles: ["Recruiter"],
      requestedLocations: ["Canada"],
      maxResults: 10,
      status: "READY",
      errorCode: null,
      totalProcessed: 10,
      totalFound: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date()
    }));
    const result = await graphql({
      schema: prospectSchema,
      source: MUTATION,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: { searchCompanyRole } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.searchCompanyRole).toMatchObject({
      id: "s_new",
      status: "READY",
      peopleCount: 10,
      requestedTitles: ["Recruiter"],
      requestedLocations: ["Canada"]
    });
    expect(searchCompanyRole).toHaveBeenCalledWith("user_A", {
      companyId: "comp_A",
      jobTitle: "Recruiter",
      location: "Canada",
      actorEmail: "a@example.com",
      idempotencyKey: "k1"
    });
  });

  it("maps a duplicate role+location to the safe DUPLICATE_ROLE_LOCATION error (#13)", async () => {
    const message = "This role and location already exist. Use Add 10 more to extend this group.";
    const searchCompanyRole = vi.fn(async () => {
      throw new ProspectError("DUPLICATE_ROLE_LOCATION", message);
    });
    const result = await graphql({
      schema: prospectSchema,
      source: MUTATION,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: { searchCompanyRole } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });
    expect(result.data?.searchCompanyRole ?? null).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("DUPLICATE_ROLE_LOCATION");
    expect(result.errors?.[0]?.message).toBe(message);
  });

  it("maps an empty job title to BAD_USER_INPUT (#11-validate)", async () => {
    const searchCompanyRole = vi.fn(async () => {
      throw new ProspectError("INVALID_INPUT", "Enter a job title to search.");
    });
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation { searchCompanyRole(companyId: "comp_A", jobTitle: "  ") { id } }`,
      contextValue: makeContext({
        user: FAKE_USER,
        services: {
          prospectSearch: { searchCompanyRole } as unknown as GraphQLContext["services"]["prospectSearch"]
        }
      })
    });
    expect(result.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });
});

describe("people query location filter (role/location groups)", () => {
  function seedLocationGraph() {
    const prisma = createFakePrisma();
    seedCompany(prisma, { id: "comp_A", userId: "user_A" });
    prisma._state.positions.push(
      { id: "pos_se", companyId: "comp_A", category: "SOFTWARE_ENGINEERING", displayName: "Software Engineering", rawTitles: [] },
      { id: "pos_rec", companyId: "comp_A", category: "RECRUITING", displayName: "Recruiting", rawTitles: [] }
    );
    const searchBase = {
      userId: "user_A",
      companyId: "comp_A",
      requestedCompany: "Apple",
      maxResults: 10,
      status: "READY",
      totalProcessed: 0,
      totalFound: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    prisma._state.searches.push(
      { ...searchBase, id: "s_us", requestedTitles: ["Software Engineer"], requestedLocations: ["United States"] },
      { ...searchBase, id: "s_ca", requestedTitles: ["Software Engineer"], requestedLocations: ["Canada"] },
      { ...searchBase, id: "s_bare", requestedTitles: ["Recruiter"], requestedLocations: [] }
    );
    const personBase = {
      userId: "user_A",
      companyId: "comp_A",
      lastName: "X",
      inferredEmail: null,
      emailStatus: "UNAVAILABLE",
      emailConfidence: "UNAVAILABLE",
      createdAt: new Date()
    };
    prisma._state.people.push(
      { ...personBase, id: "p_us_se", positionId: "pos_se", firstName: "UsSe", fullName: "UsSe X", linkedinUrl: "https://www.linkedin.com/in/us-se" },
      { ...personBase, id: "p_us_rec", positionId: "pos_rec", firstName: "UsRec", fullName: "UsRec X", linkedinUrl: "https://www.linkedin.com/in/us-rec" },
      { ...personBase, id: "p_ca_se", positionId: "pos_se", firstName: "CaSe", fullName: "CaSe X", linkedinUrl: "https://www.linkedin.com/in/ca-se" },
      { ...personBase, id: "p_bare", positionId: "pos_rec", firstName: "Bare", fullName: "Bare X", linkedinUrl: "https://www.linkedin.com/in/bare" }
    );
    prisma._state.searchPeople.push(
      { id: "a1", searchId: "s_us", personId: "p_us_se" },
      { id: "a2", searchId: "s_us", personId: "p_us_rec" },
      { id: "a3", searchId: "s_ca", personId: "p_ca_se" },
      { id: "a4", searchId: "s_bare", personId: "p_bare" }
    );
    return prisma;
  }

  async function queryPeople(prisma: FakePrisma, args: string) {
    const result = await graphql({
      schema: prospectSchema,
      source: `{ people(companyId: "comp_A"${args}, first: 10) { totalCount edges { node { id } } } }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });
    expect(result.errors).toBeUndefined();
    const connection = result.data?.people as { totalCount: number; edges: Array<{ node: { id: string } }> };
    return { totalCount: connection.totalCount, ids: connection.edges.map((edge) => edge.node.id).sort() };
  }

  it("filters people to the matching location group through allocations (#24)", async () => {
    const prisma = seedLocationGraph();
    expect(await queryPeople(prisma, `, location: "United States"`)).toEqual({
      totalCount: 2,
      ids: ["p_us_rec", "p_us_se"]
    });
    expect(await queryPeople(prisma, `, location: "Canada"`)).toEqual({ totalCount: 1, ids: ["p_ca_se"] });
  });

  it("normalizes the location filter (casing + duplicated spaces) (#24-normalized)", async () => {
    const prisma = seedLocationGraph();
    expect(await queryPeople(prisma, `, location: "  united   STATES "`)).toEqual({
      totalCount: 2,
      ids: ["p_us_rec", "p_us_se"]
    });
  });

  it("an empty-string location targets the searches run WITHOUT a location", async () => {
    const prisma = seedLocationGraph();
    expect(await queryPeople(prisma, `, location: ""`)).toEqual({ totalCount: 1, ids: ["p_bare"] });
  });

  it("role and location filters combine (#25)", async () => {
    const prisma = seedLocationGraph();
    expect(
      await queryPeople(prisma, `, location: "United States", positionCategory: SOFTWARE_ENGINEERING`)
    ).toEqual({ totalCount: 1, ids: ["p_us_se"] });
  });

  it("no location filter returns everyone (regression #31)", async () => {
    const prisma = seedLocationGraph();
    expect(await queryPeople(prisma, "")).toEqual({
      totalCount: 4,
      ids: ["p_bare", "p_ca_se", "p_us_rec", "p_us_se"]
    });
  });

  it("searches the full matching set before pagination", async () => {
    const prisma = seedLocationGraph();
    const personBase = {
      userId: "user_A",
      companyId: "comp_A",
      positionId: "pos_se",
      lastName: "Person",
      currentTitle: "Software Engineer",
      inferredEmail: null,
      emailStatus: "UNAVAILABLE",
      emailConfidence: "UNAVAILABLE",
      createdAt: new Date()
    };
    for (let index = 0; index < 6; index += 1) {
      prisma._state.people.push({
        ...personBase,
        id: `p_filler_${index}`,
        firstName: `Filler${index}`,
        fullName: `Filler${index} Person`,
        linkedinUrl: `https://www.linkedin.com/in/filler-${index}`
      });
    }
    prisma._state.people.push({
      ...personBase,
      id: "p_louis",
      firstName: "Louis",
      fullName: "Louis Armstrong",
      linkedinUrl: "https://www.linkedin.com/in/louis-armstrong"
    });

    const firstPage = await queryPeople(prisma, "");
    expect(firstPage.totalCount).toBe(11);
    expect(firstPage.ids).not.toContain("p_louis");
    expect(await queryPeople(prisma, `, search: "lOuIs"`)).toEqual({ totalCount: 1, ids: ["p_louis"] });
  });

  it("accepts the full ALL_MATCHING scope and reviews exactly the filtered People set", async () => {
    const prisma = seedLocationGraph();
    const result = await graphql({
      schema: prospectSchema,
      source: `mutation {
        reviewProspectSelection(input: {
          companyId: "comp_A"
          mode: ALL_MATCHING
          positionCategory: SOFTWARE_ENGINEERING
          location: "Canada"
          search: "case"
        }) {
          selectedCount
        }
      }`,
      contextValue: makeContext({ user: FAKE_USER, prisma, userId: "user_A" })
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.reviewProspectSelection).toEqual({ selectedCount: 1 });
  });

  it("an unknown location matches nothing — never leaks other groups", async () => {
    const prisma = seedLocationGraph();
    expect(await queryPeople(prisma, `, location: "Mars"`)).toEqual({ totalCount: 0, ids: [] });
  });

  it("legacy searches without allocation rows fall back to the whole company", async () => {
    const prisma = seedLocationGraph();
    // Simulate the pre-allocation era: no grants exist at all.
    prisma._state.searchPeople.length = 0;
    expect((await queryPeople(prisma, `, location: "United States"`)).totalCount).toBe(4);
  });
});
