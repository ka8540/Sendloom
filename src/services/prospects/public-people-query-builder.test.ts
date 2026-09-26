import { describe, expect, it } from "vitest";

import { buildPublicPeopleRoleUnionQuery, buildTavilyPeopleQueryPlan } from "./public-people-query-builder";

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
    expect(buildTavilyPeopleQueryPlan(input)).toEqual(first);
  });
});
