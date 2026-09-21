import { describe, expect, it } from "vitest";

import { normalizeProfile } from "./apify-profile-search";
import type { BrightOrganicResult } from "./brightdata-google-search-provider";
import { validateCurrentEmployment } from "./current-employment-evidence";

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

  it("fails closed when no current company relationship is supported", () => {
    const fixture = evidence("Software Engineer", "Building distributed systems");
    expect(validateCurrentEmployment(fixture.result, fixture.profile, "Acme").decision).toBe("INSUFFICIENT");
  });
});
