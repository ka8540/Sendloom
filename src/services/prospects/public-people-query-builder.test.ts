import { describe, expect, it } from "vitest";

import { buildPublicPeopleRoleUnionQuery } from "./public-people-query-builder";

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
