import { describe, expect, it, vi } from "vitest";
import { FirecrawlPublicProfileSearchService } from "./firecrawl-public-profile-search";
import { firecrawlRow } from "./__test-utils__/firecrawl-fixture";

describe("Firecrawl public evidence validation", () => {
  it("uses canonical LinkedIn identity and rejects wrong companies, former employment, wrong locations, and duplicates", async () => {
    const rows = [firecrawlRow("valid"), firecrawlRow("valid"),
      firecrawlRow("other", "Guidepoint"), firecrawlRow("former", "Apple", "Retired Software Engineer"),
      firecrawlRow("canada", "Apple", "Software Engineer", "Canada"),
      { ...firecrawlRow("fake"), url: "https://linkedin.com.attacker.invalid/in/fake" },
      { ...firecrawlRow("company"), url: "https://linkedin.com/company/apple" },
      { ...firecrawlRow("opaque"), title: "Jane Doe | LinkedIn", description: "Apple is an old employer" }];
    const service = new FirecrawlPublicProfileSearchService({ configured: true, search: vi.fn(async () => ({ results: rows, rawResultCount: rows.length, creditsUsed: 2 })) });
    const result = await service.searchProfiles({ companyName: "Apple", locations: ["United States"], query: "query" });
    expect(result.profiles.map((person) => person.sourceProfileId)).toEqual(["valid"]);
    expect(result.diagnostics).toMatchObject({ duplicateRejected: 1, companyContradictionRejected: 1, formerEmployeeRejected: 1, locationContradictionRejected: 1, companyInsufficientRejected: 1 });
    expect(result.profiles[0].linkedinUrl).toBe("https://www.linkedin.com/in/valid");
  });
  it("rejects city searches without usable location evidence", async () => {
    const row = firecrawlRow("unknown", "Apple", "Software Engineer", "");
    const service = new FirecrawlPublicProfileSearchService({ configured: true, search: async () => ({ results: [row], rawResultCount: 1, creditsUsed: null }) });
    expect((await service.searchProfiles({ companyName: "Apple", locations: ["San Francisco"], query: "query" })).profiles).toEqual([]);
  });
});
