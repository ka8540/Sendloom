import { describe, expect, it } from "vitest";

import { createProspectSearchSchema } from "@/services/prospects/prospect-validation";

function parse(input: unknown) {
  return createProspectSearchSchema.safeParse(input);
}

describe("createProspectSearchSchema", () => {
  it("accepts and normalizes a valid input", () => {
    const result = parse({
      companyName: "  Apple  ",
      jobTitles: ["Software Engineer", " software engineer ", "Recruiter"],
      locations: ["United States", "united states"]
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.companyName).toBe("Apple");
      // duplicates collapsed case-insensitively
      expect(result.data.jobTitles).toEqual(["Software Engineer", "Recruiter"]);
      expect(result.data.locations).toEqual(["United States"]);
      // The result count is always the server-fixed value.
      expect(result.data.maxResults).toBe(10);
    }
  });

  it("requires a company name", () => {
    expect(parse({ companyName: "   ", jobTitles: ["Engineer"] }).success).toBe(false);
  });

  it("requires at least one job title and rejects empty arrays", () => {
    expect(parse({ companyName: "Apple", jobTitles: [] }).success).toBe(false);
    expect(parse({ companyName: "Apple", jobTitles: ["  "] }).success).toBe(false);
  });

  it("enforces the maximum of 10 job titles and 10 locations", () => {
    const titles = Array.from({ length: 11 }, (_, i) => `Title ${i}`);
    expect(parse({ companyName: "Apple", jobTitles: titles }).success).toBe(false);

    const locations = Array.from({ length: 11 }, (_, i) => `Location ${i}`);
    expect(parse({ companyName: "Apple", jobTitles: ["Engineer"], locations }).success).toBe(false);
  });

  it("rejects personal email domains as company domains", () => {
    const result = parse({ companyName: "Apple", jobTitles: ["Engineer"], companyDomain: "gmail.com" });
    expect(result.success).toBe(false);
  });

  it("rejects malformed LinkedIn company URLs", () => {
    expect(
      parse({
        companyName: "Apple",
        jobTitles: ["Engineer"],
        companyLinkedinUrl: "https://www.linkedin.com/in/jane-doe"
      }).success
    ).toBe(false);

    expect(
      parse({
        companyName: "Apple",
        jobTitles: ["Engineer"],
        companyLinkedinUrl: "https://www.linkedin.com/company/apple/"
      }).success
    ).toBe(true);
  });

  it("ignores any supplied maxResults and forces the fixed server value (#4)", () => {
    for (const maxResults of [1, 25, 100, 1000]) {
      const result = parse({ companyName: "Apple", jobTitles: ["Engineer"], maxResults });
      expect(result.success).toBe(true);
      if (result.success) {
        // A hand-crafted GraphQL request cannot raise the people-per-search cap.
        expect(result.data.maxResults).toBe(10);
      }
    }
  });
});
