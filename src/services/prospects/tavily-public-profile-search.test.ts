import { describe, expect, it, vi } from "vitest";

import { TavilyPublicProfileSearchService } from "./tavily-public-profile-search";
import type { TavilyPeopleSearchProvider } from "./tavily-search-provider";
import {
  emptyCandidateJudgeDiagnostics,
  type DiscoverCandidateEligibilityPort,
  type DiscoverCandidateEvidence
} from "./discover-candidate-eligibility-service";
import { AiCallBudget } from "./prospect-ai";

function result(title: string, url: string, content: string) {
  return { title, url, content, score: 0.9 };
}

describe("TavilyPublicProfileSearchService", () => {
  it("sends every returned Tavily row to the shared judge before deterministic rejection", async () => {
    const rows = [
      result("Jane - Recruiter at Guidewire Software", "https://www.linkedin.com/in/jane", "Recruiter · Guidewire Software · United States"),
      result("Pat - Software Engineer at Guidewire Software", "https://www.linkedin.com/in/pat", "Software Engineer · Guidewire Software · United States"),
      result("Lee - Former Recruiter", "https://www.linkedin.com/in/lee", "Former Recruiter at Guidewire Software · United States"),
      result("Company", "https://www.linkedin.com/company/guidewire", "Guidewire Software")
    ];
    let received: readonly DiscoverCandidateEvidence[] = [];
    const eligibility: DiscoverCandidateEligibilityPort = {
      enabled: true,
      shadow: false,
      evaluate: vi.fn(async ({ candidates }) => {
        received = candidates;
        return { decisions: new Map(), shadow: false, diagnostics: {
          ...emptyCandidateJudgeDiagnostics(), aiJudgeCandidateCount: candidates.length,
          aiJudgeFallbackCount: candidates.length
        } };
      })
    };
    const provider: TavilyPeopleSearchProvider = { configured: true, search: vi.fn(async () => ({
      rawResultCount: rows.length, responseTimeSeconds: 1, creditsUsed: 1, results: rows
    })) };
    const budget = new AiCallBudget({ company_resolution: 0, role_classification: 0,
      candidate_eligibility: 1, email_pattern: 0, person_identity: 0 });

    await new TavilyPublicProfileSearchService(provider, eligibility).searchProfiles({
      query: "query", companyName: "Guidewire Software", locations: ["United States"],
      requestedTitles: ["Recruiter"], budget
    });

    expect(received).toHaveLength(4);
    expect(received.map((candidate) => candidate.provider)).toEqual(Array(4).fill("TAVILY"));
  });

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

  it.each([
    "https://www.linkedin.com/jobs/view/1",
    "https://www.linkedin.com/company/acme"
  ])("rejects non-person LinkedIn URL %s", async (url) => {
    const provider: TavilyPeopleSearchProvider = {
      configured: true,
      search: vi.fn(async () => ({
        rawResultCount: 1,
        responseTimeSeconds: 1,
        creditsUsed: 1,
        results: [result("Jane Doe - Engineer at Acme | LinkedIn", url, "Engineer at Acme · United States")]
      }))
    };

    const response = await new TavilyPublicProfileSearchService(provider).searchProfiles({
      query: "query",
      companyName: "Acme",
      locations: ["United States"]
    });

    expect(response.profiles).toEqual([]);
    expect(response.diagnostics.linkedInCandidates).toBe(0);
  });

  it("accepts a strict linkedin.com/in person URL", async () => {
    const provider: TavilyPeopleSearchProvider = {
      configured: true,
      search: vi.fn(async () => ({
        rawResultCount: 1,
        responseTimeSeconds: 1,
        creditsUsed: 1,
        results: [result(
          "Jane Doe - Engineer at Acme | LinkedIn",
          "https://www.linkedin.com/in/jane-doe",
          "Engineer at Acme · United States"
        )]
      }))
    };

    const response = await new TavilyPublicProfileSearchService(provider).searchProfiles({
      query: "query",
      companyName: "Acme",
      locations: ["United States"]
    });

    expect(response.profiles).toHaveLength(1);
    expect(response.profiles[0]?.sourceProfileId).toBe("jane-doe");
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
