import { describe, expect, it } from "vitest";

import {
  MAX_TAVILY_QUERY_LENGTH,
  buildPublicPeopleRoleUnionQuery,
  buildTavilyPeopleQuery,
  buildTavilyPeopleQueryPlan
} from "./public-people-query-builder";

describe("buildPublicPeopleRoleUnionQuery", () => {
  it("includes company, role union, and every supplied location without assuming the US", () => {
    const query = buildPublicPeopleRoleUnionQuery({
      companyName: "Citadel",
      providerTitles: ["Software Engineer", "Backend Engineer"],
      locations: ["Paris", "France"]
    });
    expect(query).toContain("site:linkedin.com/in");
    expect(query).toContain('"Citadel"');
    expect(query).toContain('("Software Engineer" OR "Backend Engineer")');
    expect(query).toContain('("Paris" OR "France")');
    expect(query).not.toContain("United States");
  });
});

describe("buildTavilyPeopleQuery", () => {
  it("keeps company, role, and location intent without Google operators", () => {
    const query = buildTavilyPeopleQuery({
      companyName: "L3Harris",
      providerTitles: ["Recruiter", "Talent Acquisition Specialist"],
      locations: ["United States"]
    });
    expect(query).toBe('"L3Harris" ("Recruiter" OR "Talent Acquisition Specialist") ("United States")');
    expect(query).not.toContain("site:");
    expect(query).not.toContain("inurl:");
    expect(query).not.toContain("intitle:");
  });

  it("drops role variants before exceeding the safe query length limit without truncating quotes", () => {
    const query = buildTavilyPeopleQuery({
      companyName: "L3Harris",
      providerTitles: Array.from({ length: 5 }, (_, index) => `Extremely Long Recruiting Role Title ${index} `.repeat(8).trim()),
      locations: ["United States"]
    })!;
    expect(query.length).toBeLessThanOrEqual(MAX_TAVILY_QUERY_LENGTH);
    expect(query).toContain('"Extremely Long Recruiting Role Title 0');
    expect(query).toContain('("United States")');
    expect(query.split('"').length % 2).toBe(1);
  });
});

describe("buildTavilyPeopleQueryPlan", () => {
  it("builds a deterministic bounded broad-then-title plan", () => {
    const input = {
      companyName: "Acme, Inc.",
      providerTitles: ["Software Engineer", "Backend Engineer", "software engineer", "Platform Engineer"],
      locations: ["United States"],
      maxQueries: 3
    };
    const first = buildTavilyPeopleQueryPlan(input);
    expect(first).toHaveLength(3);
    expect(first[0]).toContain('("Software Engineer" OR "Backend Engineer" OR "Platform Engineer")');
    expect(first[1]).toContain('("Software Engineer")');
    expect(first[2]).toContain('("Backend Engineer")');
    expect(first.every((query) => !query.includes("site:"))).toBe(true);
    expect(first.every((query) => query.length <= MAX_TAVILY_QUERY_LENGTH)).toBe(true);
    expect(buildTavilyPeopleQueryPlan(input)).toEqual(first);
  });
});
