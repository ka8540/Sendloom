import { describe, expect, it, vi } from "vitest";

import { TavilyPublicProfileSearchService } from "./tavily-public-profile-search";
import type { TavilyPeopleSearchProvider } from "./tavily-search-provider";

function result(title: string, url: string, content: string) {
  return { title, url, content, score: 0.9 };
}

describe("TavilyPublicProfileSearchService", () => {
  it("accepts only strict current-company LinkedIn person profiles with matching location evidence", async () => {
    const provider: TavilyPeopleSearchProvider = {
      configured: true,
      search: vi.fn(async () => ({
        rawResultCount: 6,
        responseTimeSeconds: 1,
        creditsUsed: 1,
        results: [
          result("Jane Doe - Software Engineer at Acme | LinkedIn", "https://www.linkedin.com/in/jane-doe", "Software Engineer at Acme · Phoenix, Arizona, United States"),
          result("Company", "https://www.linkedin.com/company/acme", "Acme"),
          result("Job", "https://www.linkedin.com/jobs/view/1", "Acme"),
          result("Post", "https://www.linkedin.com/posts/acme", "Acme"),
          result("Former Person - Former Software Engineer | LinkedIn", "https://www.linkedin.com/in/former", "Former Software Engineer at Acme · Phoenix, Arizona, United States"),
          result("Other Person - Software Engineer at Other | LinkedIn", "https://www.linkedin.com/in/other", "Currently Software Engineer at Other · Phoenix, Arizona, United States")
        ]
      }))
    };
    const response = await new TavilyPublicProfileSearchService(provider).searchProfiles({
      query: "query",
      companyName: "Acme",
      locations: ["United States"]
    });

    expect(response.profiles.map((profile) => profile.sourceProfileId)).toEqual(["jane-doe"]);
    expect(response.diagnostics).toMatchObject({
      rawTavilyResults: 6,
      linkedInCandidates: 3,
      currentEmploymentAccepted: 1,
      formerEmployeeRejected: 1,
      companyContradictionRejected: 1,
      creditsUsed: 1
    });
  });

  it("deduplicates canonical LinkedIn identities", async () => {
    const provider: TavilyPeopleSearchProvider = {
      configured: true,
      search: vi.fn(async () => ({
        rawResultCount: 2,
        responseTimeSeconds: 1,
        creditsUsed: null,
        results: [
          result("Jane Doe - Engineer at Acme | LinkedIn", "https://linkedin.com/in/Jane-Doe/", "Engineer at Acme · United States"),
          result("Jane Doe - Engineer at Acme | LinkedIn", "https://www.linkedin.com/in/jane-doe", "Engineer at Acme · United States")
        ]
      }))
    };
    const response = await new TavilyPublicProfileSearchService(provider).searchProfiles({
      query: "query",
      companyName: "Acme",
      locations: ["United States"]
    });
    expect(response.profiles).toHaveLength(1);
    expect(response.diagnostics.duplicateRejected).toBe(1);
  });
});
