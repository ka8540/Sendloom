// API contracts for the discoverSuggestions query: authentication, GLOBAL
// company-identity matching (with strict per-user scoping for roles/locations
// and for what identity is exposed), current-company prioritization, the
// result limit, and the empty-query response. Runs against the real schema +
// resolvers with the in-memory fake Prisma.

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
    linkedinUrl: null,
    ...overrides
  });
}

function seedSearch(prisma: FakePrisma, overrides: Record<string, unknown>) {
  prisma._state.searches.push({
    id: `search_${prisma._state.searches.length + 1}`,
    userId: USER_A.id,
    companyId: null,
    requestedCompany: "Example",
    requestedDomain: null,
    requestedLinkedin: null,
    requestedTitles: [],
    requestedLocations: [],
    status: "READY",
    createdAt: new Date(),
    ...overrides
  });
}

function seedCacheEntry(prisma: FakePrisma, overrides: Record<string, unknown>) {
  prisma._state.discoverCache.push({
    id: `dcache_${prisma._state.discoverCache.length + 1}`,
    fingerprint: `fp_${prisma._state.discoverCache.length + 1}`,
    companyKey: "domain:example.com",
    companyName: "Example",
    companyDomain: "example.com",
    companyLinkedinUrl: null,
    status: "READY",
    ...overrides
  });
}

const QUERY = /* GraphQL */ `
  query Suggest($query: String!, $types: [DiscoverSuggestionType!], $companyId: ID) {
    discoverSuggestions(query: $query, types: $types, companyId: $companyId) {
      companies { value detail count companyId canonicalKey kind }
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

describe("discoverSuggestions — GLOBAL company matching (#10, #11)", () => {
  it("suggests companies from the global database, not only the current user's rows (#10)", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      name: "Stripe",
      normalizedName: "stripe",
      canonicalKey: "domain:stripe.test",
      officialDomain: "stripe.test"
    });
    // Another user's company DOES surface — company identity is shared app-wide.
    seedCompany(prisma, {
      userId: "user_B",
      name: "Stripedelivery",
      normalizedName: "stripedelivery",
      canonicalKey: "domain:stripedelivery.test",
      officialDomain: "stripedelivery.test"
    });
    const { suggestions } = await run(prisma, { query: "str", types: ["COMPANY"] });
    expect(suggestions?.companies.map((company) => company.value)).toEqual(["Stripe", "Stripedelivery"]);
    // The user's own company keeps its row id; the other user's exposes identity only.
    expect(suggestions?.companies[0]?.companyId).toBeTruthy();
    expect(suggestions?.companies[1]?.companyId).toBeNull();
    expect(suggestions?.companies[1]?.detail).toBe("stripedelivery.test");
  });

  it("matches a global company this user never searched by partial, full, casing, and domain", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      userId: "user_B",
      name: "Helix Analytics",
      normalizedName: "helix analytics",
      canonicalKey: "domain:helix-analytics.test",
      officialDomain: "helix-analytics.test"
    });

    for (const query of ["hel", "Helix Analytics", "helix analytics", "HELIX", "helix-analytics.test"]) {
      const { suggestions } = await run(prisma, { query, types: ["COMPANY"] });
      expect(suggestions?.companies.map((company) => company.value)).toEqual(["Helix Analytics"]);
    }
  });

  it("exposes ONLY safe identity fields for another user's company — no ids, counts, or history", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      userId: "user_B",
      name: "Helix Analytics",
      normalizedName: "helix analytics",
      canonicalKey: "domain:helix-analytics.test",
      officialDomain: "helix-analytics.test"
    });
    // user_B's private search history must never shape user_A's role/location lists.
    seedSearch(prisma, {
      userId: "user_B",
      companyId: "company_1",
      requestedCompany: "Helix Analytics",
      requestedTitles: ["Secret Role"],
      requestedLocations: ["Secret City"]
    });

    const { suggestions } = await run(prisma, { query: "helix" });
    expect(suggestions?.companies).toEqual([
      {
        value: "Helix Analytics",
        detail: "helix-analytics.test",
        count: null,
        companyId: null,
        canonicalKey: "domain:helix-analytics.test",
        kind: "MATCH"
      }
    ]);
    expect(suggestions?.roles).toEqual([]);
    expect(suggestions?.locations).toEqual([]);
  });

  it("dedupes the same company held by multiple users into one suggestion (own identity wins)", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      id: "company_own",
      name: "Acme",
      normalizedName: "acme",
      canonicalKey: "domain:acme.test"
    });
    seedCompany(prisma, {
      userId: "user_B",
      id: "company_foreign",
      name: "Acme Inc.",
      normalizedName: "acme",
      canonicalKey: "domain:acme.test",
      officialDomain: "acme.test"
    });

    const { suggestions } = await run(prisma, { query: "acme", types: ["COMPANY"] });
    expect(suggestions?.companies).toHaveLength(1);
    expect(suggestions?.companies[0]).toEqual(
      // The duplicate's domain still fills in, but the row id is the user's own.
      expect.objectContaining({ value: "Acme", detail: "acme.test", companyId: "company_own" })
    );
  });

  it("suggests a company known only from the shared Discover cache", async () => {
    const prisma = createFakePrisma();
    seedCacheEntry(prisma, {
      companyKey: "domain:orbit.test",
      companyName: "Orbit Dynamics",
      companyDomain: "orbit.test"
    });

    const { suggestions } = await run(prisma, { query: "orbit", types: ["COMPANY"] });
    expect(suggestions?.companies).toEqual([
      {
        value: "Orbit Dynamics",
        detail: "orbit.test",
        count: null,
        companyId: null,
        canonicalKey: "domain:orbit.test",
        kind: "MATCH"
      }
    ]);
  });

  it("dedupes a shared-cache entry against the matching resolved company", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      id: "company_orbit",
      name: "Orbit Dynamics",
      normalizedName: "orbit dynamics",
      canonicalKey: "domain:orbit.test",
      officialDomain: "orbit.test"
    });
    seedCacheEntry(prisma, {
      companyKey: "domain:orbit.test",
      companyName: "Orbit Dynamics",
      companyDomain: "orbit.test"
    });

    const { suggestions } = await run(prisma, { query: "orbit", types: ["COMPANY"] });
    expect(suggestions?.companies).toHaveLength(1);
    expect(suggestions?.companies[0]?.companyId).toBe("company_orbit");
  });

  it("caps company suggestions at the result limit (#15)", async () => {
    const prisma = createFakePrisma();
    for (let index = 0; index < 12; index += 1) {
      seedCompany(prisma, {
        userId: `user_${index}`,
        name: `Meridian Labs ${index}`,
        normalizedName: `meridian labs ${index}`,
        canonicalKey: `domain:meridian-${index}.test`,
        officialDomain: `meridian-${index}.test`
      });
    }
    const { suggestions } = await run(prisma, { query: "meridian", types: ["COMPANY"] });
    expect(suggestions?.companies).toHaveLength(8);
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

  it("matches partial, full, mixed-case, spacing, and punctuation variants", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      name: "Northwind Research, Ltd.",
      officialName: "Northwind Research, Ltd.",
      normalizedName: "northwind research",
      canonicalKey: "domain:northwind-research.test",
      officialDomain: "northwind-research.test"
    });

    for (const query of [
      "north",
      "NORTHWIND RESEARCH, LTD.",
      "NoRtHwInD",
      "northwindresearch",
      "northwind research ltd"
    ]) {
      const { suggestions } = await run(prisma, { query, types: ["COMPANY"] });
      expect(suggestions?.companies[0]?.value).toBe("Northwind Research, Ltd.");
    }
  });

  it("searches canonical, normalized, official, domain, and LinkedIn company fields", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      name: "Northwind Holdings",
      officialName: "Northwind Research Group",
      normalizedName: "northwind research",
      canonicalKey: "domain:northwind-labs.test",
      officialDomain: "northwind-labs.test",
      officialWebsiteDomain: "www.northwind-labs.test",
      emailDomain: "mail.northwind-labs.test",
      linkedinUrl: "https://www.linkedin.com/company/northwind-research-group/"
    });

    for (const query of [
      "research group",
      "northwind research",
      "northwind-labs.test",
      "mail.northwind",
      "linkedin.com/company/northwind-research"
    ]) {
      const { suggestions } = await run(prisma, { query, types: ["COMPANY"] });
      expect(suggestions?.companies).toHaveLength(1);
      expect(suggestions?.companies[0]?.value).toBe("Northwind Research Group");
    }
  });

  it("suggests unresolved history by requested name, domain, and LinkedIn slug", async () => {
    const prisma = createFakePrisma();
    seedSearch(prisma, {
      requestedCompany: "Blue Mesa Systems",
      requestedDomain: "blue-mesa.test",
      requestedLinkedin: "https://www.linkedin.com/company/blue-mesa-systems/"
    });

    for (const query of ["blue mes", "blue-mesa.test", "blue-mesa-systems"]) {
      const { suggestions } = await run(prisma, { query, types: ["COMPANY"] });
      expect(suggestions?.companies).toEqual([
        expect.objectContaining({ value: "Blue Mesa Systems", detail: "blue-mesa.test" })
      ]);
    }
  });

  it("merges repeated linked searches into one canonical suggestion", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      id: "company_northwind",
      name: "Northwind Research Group",
      normalizedName: "northwind research",
      canonicalKey: "domain:northwind.test",
      officialDomain: "northwind.test"
    });
    seedSearch(prisma, { companyId: "company_northwind", requestedCompany: "Northwind" });
    seedSearch(prisma, { companyId: "company_northwind", requestedCompany: "Northwind Research" });
    seedSearch(prisma, { companyId: "company_northwind", requestedCompany: "Northwind Research Group" });

    const { suggestions } = await run(prisma, { query: "northwind", types: ["COMPANY"] });
    expect(suggestions?.companies).toHaveLength(1);
    expect(suggestions?.companies[0]).toEqual(
      expect.objectContaining({ value: "Northwind Research Group", companyId: "company_northwind" })
    );
  });

  it("dedupes an unresolved draft against the matching canonical company", async () => {
    const prisma = createFakePrisma();
    seedCompany(prisma, {
      id: "company_northwind",
      name: "Northwind Research, Inc.",
      normalizedName: "northwind research",
      canonicalKey: "domain:northwind.test",
      officialDomain: "northwind.test"
    });
    seedSearch(prisma, { companyId: null, requestedCompany: "Northwind Research" });

    const { suggestions } = await run(prisma, { query: "northwind", types: ["COMPANY"] });
    expect(suggestions?.companies).toHaveLength(1);
    expect(suggestions?.companies[0]).toEqual(
      expect.objectContaining({ value: "Northwind Research, Inc.", companyId: "company_northwind" })
    );
  });

  it("reads all owner history rather than a visible or paginated subset", async () => {
    const prisma = createFakePrisma();
    for (let index = 0; index < 35; index += 1) {
      seedSearch(prisma, { requestedCompany: `Archived Company ${index}` });
    }
    seedSearch(prisma, { requestedCompany: "Oldest Horizon Works", createdAt: new Date(2001, 0, 1) });

    const { suggestions } = await run(prisma, { query: "oldest hor", types: ["COMPANY"] });
    expect(suggestions?.companies.map((company) => company.value)).toEqual(["Oldest Horizon Works"]);
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

  it("surfaces a bad-cased stored role as a CLEAN canonical suggestion", async () => {
    const prisma = createFakePrisma();
    seedSearch(prisma, { requestedTitles: ["SOftware Engineer"] });
    const { suggestions } = await run(prisma, { query: "soft", types: ["ROLE"] });
    expect(suggestions?.roles.map((role) => role.value)).toEqual(["Software Engineer"]);
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
