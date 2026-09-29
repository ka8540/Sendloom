import { describe, expect, it } from "vitest";

import { normalizeProfile } from "./apify-profile-search";
import type { BrightOrganicResult } from "./brightdata-google-search-provider";
import { validateCurrentEmployment } from "./current-employment-evidence";
import { parseLinkedInSearchResult } from "./linkedin-search-result-parser";

function evidence(headline: string, snippet = headline): { result: BrightOrganicResult; profile: NonNullable<ReturnType<typeof normalizeProfile>> } {
  const result: BrightOrganicResult = {
    title: `Jane Doe - ${headline} | LinkedIn`,
    url: "https://www.linkedin.com/in/jane-doe",
    rawUrl: "https://www.linkedin.com/in/jane-doe",
    displayedUrl: "linkedin.com › in › jane-doe",
    snippet,
    evidence: [headline, snippet]
  };
  const profile = normalizeProfile({
    id: "jane-doe",
    linkedinUrl: result.url,
    fullName: "Jane Doe",
    headline,
    currentTitle: headline.split(" at ")[0],
    currentCompany: headline.split(" at ")[1] ?? null
  });
  if (!profile) throw new Error("Fixture did not normalize");
  return { result, profile };
}

describe("validateCurrentEmployment", () => {
  it.each([
    ["Guidewire Software - Senior Talent Acquisition Partner", ""],
    ["Senior Talent Acquisition Partner - Guidewire Software", ""],
    ["Guidewire Software", "Guidewire Software · Senior Talent Acquisition Partner · United States"],
    ["Senior Talent Acquisition Partner", "Senior Talent Acquisition Partner · Guidewire Software · United States"],
    ["Recruiting Manager at Guidewire Software", ""],
    ["Talent Acquisition Partner @ Guidewire Software", ""],
    ["Guidewire Software (Talent Acquisition Partner)", ""]
  ])("uses the parser's target-aware interpretation for current evidence: %s", (headline, snippet) => {
    const { result } = evidence(headline, snippet);
    const profile = parseLinkedInSearchResult(result, { expectedCompanyName: "Guidewire Software" })!;
    expect(profile.currentCompanyName).toBe("Guidewire Software");
    expect(validateCurrentEmployment(result, profile, "Guidewire Software").decision).toBe("CURRENT");
  });

  it.each([
    ["Former Talent Acquisition Partner at Guidewire Software", ""],
    ["Retired Recruiter at Guidewire Software", ""],
    ["Recruiter", "I previously worked at Guidewire Software"],
    ["Recruiter", "Former Recruiter · Guidewire Software · United States"],
    ["Recruiter", "Previously · Guidewire Software · Talent Acquisition Partner · United States"],
    ["Recruiter", "Guidewire Software · Talent Acquisition Partner · retired · United States"],
    ["Recruiter at Another Company", "Recruiter at Another Company; previously Guidewire Software"],
    ["Recruiter at Another Company", "Recruiter at Another Company · Guidewire Software · United States"],
    ["Recruiter at Another Company", "Previously worked at · Guidewire Software · Talent Acquisition Partner"],
    ["Recruiter", "Guidewire Software"],
    ["Recruiter", "Guidewire Software; Talent Acquisition Partner · United States"]
  ])("never promotes historical or unsupported Guidewire evidence to CURRENT: %s / %s", (headline, snippet) => {
    const { result } = evidence(headline, snippet);
    const profile = parseLinkedInSearchResult(result, { expectedCompanyName: "Guidewire Software" })!;
    expect(validateCurrentEmployment(result, profile, "Guidewire Software").decision).not.toBe("CURRENT");
  });

  it("accepts strong current target-company evidence", () => {
    const fixture = evidence("Software Engineer at Acme");
    expect(validateCurrentEmployment(fixture.result, fixture.profile, "Acme").decision).toBe("CURRENT");
  });

  it("rejects former and historical-only target-company evidence", () => {
    const fixture = evidence("Former Software Engineer at Acme");
    expect(validateCurrentEmployment(fixture.result, fixture.profile, "Acme").decision).toBe("FORMER");
  });

  it("lets an explicit current-employer contradiction override a positive target headline", () => {
    const fixture = evidence("Software Engineer at Acme", "Currently Software Engineer at OtherCo");
    expect(validateCurrentEmployment(fixture.result, fixture.profile, "Acme").decision).toBe("CONTRADICTORY");
  });

  it("keeps current-employer contradictions with a comma in the role title", () => {
    const fixture = evidence("Technical Recruiter at Guidewire Software", "Currently Technical Recruiter, Engineering at Another Company · United States");
    expect(validateCurrentEmployment(fixture.result, fixture.profile, "Guidewire Software").decision).toBe("CONTRADICTORY");
  });

  it("does not let a historical target mention mask an explicit current-employer contradiction", () => {
    const fixture = evidence("Recruiter at Guidewire Software", "Currently Recruiter at Another Company · Former Recruiter at Guidewire Software · United States");
    expect(validateCurrentEmployment(fixture.result, fixture.profile, "Guidewire Software").decision).toBe("CONTRADICTORY");
  });

  it("fails closed when no current company relationship is supported", () => {
    const fixture = evidence("Software Engineer", "Building distributed systems");
    expect(validateCurrentEmployment(fixture.result, fixture.profile, "Acme").decision).toBe("INSUFFICIENT");
  });
});
