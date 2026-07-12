// API contracts for the discoverSuggestions query: authentication, strict
// per-user scoping, company/role/location matching, current-company
// prioritization, the result limit, and the empty-query response. Runs against
// the real schema + resolvers with the in-memory fake Prisma.

import type { PrismaClient, User } from "@prisma/client";
import { graphql } from "graphql";
import { describe, expect, it } from "vitest";

import type { GraphQLContext } from "@/graphql/context";
import { createLoaders } from "@/graphql/loaders";
import { prospectSchema } from "@/graphql/server";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";

const USER_A = { id: "user_A", email: "a@example.com" } as User;

function makeContext(user: User | null, prisma: FakePrisma): GraphQLContext {
  return {
    user,
    authError: null,
    requestId: "test-request",
    prisma: prisma as unknown as PrismaClient,
    services: {} as GraphQLContext["services"],
    loaders: createLoaders(prisma as unknown as PrismaClient, user?.id ?? "__anonymous__")
  };
}

function seedCompany(prisma: FakePrisma, overrides: Record<string, unknown>) {
  prisma._state.companies.push({
    id: `company_${prisma._state.companies.length + 1}`,
    userId: USER_A.id,
    canonicalKey: "domain:example.com",
    name: "Example",
    normalizedName: "example",
    officialName: null,
    officialDomain: null,
    officialWebsiteDomain: null,
    emailDomain: null,
    ...overrides
  });
}

function seedSearch(prisma: FakePrisma, overrides: Record<string, unknown>) {
  prisma._state.searches.push({
    id: `search_${prisma._state.searches.length + 1}`,
    userId: USER_A.id,
    companyId: null,
    requestedCompany: "Example",
    requestedTitles: [],
    requestedLocations: [],
    status: "READY",
    createdAt: new Date(),
    ...overrides
  });
}

const QUERY = /* GraphQL */ `
  query Suggest($query: String!, $types: [DiscoverSuggestionType!], $companyId: ID) {
    discoverSuggestions(query: $query, types: $types, companyId: $companyId) {
      companies { value detail companyId canonicalKey kind }
      roles { value count kind }
      locations { value count kind }
    }
  }
`;

type SuggestionRow = {
  value: string;
  detail?: string | null;
  count?: number | null;
  companyId?: string | null;
  canonicalKey?: string | null;
  kind: string;
};
type SuggestionResult = { companies: SuggestionRow[]; roles: SuggestionRow[]; locations: SuggestionRow[] };

async function run(
  prisma: FakePrisma,
  variables: { query: string; types?: string[]; companyId?: string | null },
  user: User | null = USER_A
) {
  const result = await graphql({
    schema: prospectSchema,
    source: QUERY,
    contextValue: makeContext(user, prisma),
    variableValues: variables
  });
  const data = result.data as { discoverSuggestions: SuggestionResult } | null | undefined;
  return { errors: result.errors, suggestions: data?.discoverSuggestions ?? null };
}

describe("discoverSuggestions — authentication (#9)", () => {
  it("rejects an unauthenticated request", async () => {
    const prisma = createFakePrisma();
    const result = await run(prisma, { query: "str" }, null);
    expect(result.suggestions).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });
});

describe("discoverSuggestions — company scoping + matching (#10, #11)", () => {
  it("returns only the current user's companies (#10)", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { name: "Stripe", normalizedName: "stripe", officialDomain: "stripe.com" });
    // Another user's company must never surface.
    seedCompany(prisma, {
      userId: "user_B",
      name: "Stripedelivery",
      normalizedName: "stripedelivery",
      officialDomain: "stripedelivery.com"
    });
    const { suggestions } = await run(prisma, { query: "str", types: ["COMPANY"] });
    expect(suggestions?.companies.map((company) => company.value)).toEqual(["Stripe"]);
  });

  it("matches a company by its domain and preserves dedupe hints (#11)", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      name: "Snowflake Inc.",
      normalizedName: "snowflake",
      canonicalKey: "domain:snowflake.com",
      officialDomain: "snowflake.com"
    });
    const { suggestions } = await run(prisma, { query: "snowflake.com", types: ["COMPANY"] });
    const first = suggestions?.companies[0];
    expect(first?.value).toBe("Snowflake Inc.");
    expect(first?.detail).toBe("snowflake.com");
    expect(first?.canonicalKey).toBe("domain:snowflake.com");
    expect(first?.companyId).toBeTruthy();
  });
});

describe("discoverSuggestions — role + location scoping (#12, #13)", () => {
  it("returns the user's own role labels (#12)", async () => {
    const prisma = createFakePrisma();
    seedSearch(prisma, { requestedTitles: ["Software Engineer"] });
    seedSearch(prisma, { userId: "user_B", requestedTitles: ["Secret Role"] });
    const { suggestions } = await run(prisma, { query: "soft", types: ["ROLE"] });
    expect(suggestions?.roles.map((role) => role.value)).toEqual(["Software Engineer"]);
  });

  it("returns the user's own locations (#13)", async () => {
    const prisma = createFakePrisma();
    seedSearch(prisma, { requestedLocations: ["United States"] });
    seedSearch(prisma, { userId: "user_B", requestedLocations: ["Antarctica"] });
    const { suggestions } = await run(prisma, { query: "unit", types: ["LOCATION"] });
    expect(suggestions?.locations.map((location) => location.value)).toEqual(["United States"]);
  });

  it("offers a typo correction for a known location", async () => {
    const prisma = createFakePrisma();
    seedSearch(prisma, { requestedLocations: ["United States"] });
    const { suggestions } = await run(prisma, { query: "untied states", types: ["LOCATION"] });
    expect(suggestions?.locations).toEqual([{ value: "United States", count: 1, kind: "CORRECTION" }]);
  });
});

describe("discoverSuggestions — current-company prioritization (#14)", () => {
  it("ranks the current company's roles ahead of broader ones on a tie", async () => {
    const prisma = createFakePrisma();
    // Both roles start with "eng" (word-prefix), so match rank ties — the
    // companyId boost must break the tie toward the current company's role.
    seedSearch(prisma, { companyId: "company_current", requestedTitles: ["Engineering Manager"] });
    seedSearch(prisma, { companyId: "company_other", requestedTitles: ["Engineer"] });
    seedSearch(prisma, { companyId: "company_other", requestedTitles: ["Engineer"] });
    const { suggestions } = await run(prisma, { query: "eng", types: ["ROLE"], companyId: "company_current" });
    expect(suggestions?.roles[0]?.value).toBe("Engineering Manager");
  });
});

describe("discoverSuggestions — limit + empty query (#15, #16)", () => {
  it("caps each type at the suggestion limit (#15)", async () => {
    const prisma = createFakePrisma();
    for (let index = 0; index < 20; index += 1) {
      seedSearch(prisma, { requestedTitles: [`Engineer ${index}`] });
    }
    const { suggestions } = await run(prisma, { query: "engineer", types: ["ROLE"] });
    expect(suggestions?.roles.length).toBe(8);
  });

  it("returns empty lists for an empty query rather than erroring (#16)", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, { name: "Stripe", normalizedName: "stripe" });
    const { errors, suggestions } = await run(prisma, { query: "   " });
    expect(errors).toBeUndefined();
    expect(suggestions).toEqual({ companies: [], roles: [], locations: [] });
  });
});
