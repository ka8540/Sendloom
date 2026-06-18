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
      locations: ["United States", "united states"],
      maxResults: 25
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.companyName).toBe("Apple");
      // duplicates collapsed case-insensitively
      expect(result.data.jobTitles).toEqual(["Software Engineer", "Recruiter"]);
      expect(result.data.locations).toEqual(["United States"]);
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

  it("bounds maxResults between 1 and 200", () => {
    expect(parse({ companyName: "Apple", jobTitles: ["Engineer"], maxResults: 0 }).success).toBe(false);
    expect(parse({ companyName: "Apple", jobTitles: ["Engineer"], maxResults: 201 }).success).toBe(false);
  });
});
