import { describe, expect, it, vi } from "vitest";
import { FirecrawlPublicProfileSearchService } from "./firecrawl-public-profile-search";
import { firecrawlRow } from "./__test-utils__/firecrawl-fixture";
import {
  emptyCandidateJudgeDiagnostics,
  type DiscoverCandidateEligibilityPort,
  type DiscoverCandidateEvidence
} from "./discover-candidate-eligibility-service";
import { AiCallBudget } from "./prospect-ai";

function judgeBudget() {
  return new AiCallBudget({ company_resolution: 0, role_classification: 0,
    candidate_eligibility: 5, email_pattern: 0, person_identity: 0 });
}

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

  it("sends all 50 provider results to the AI judge before company, role, location, or employment rejection", async () => {
    const headlines = [
      ["Senior Talent Acquisition Partner", "Guidewire Software", "United States"],
      ["Software Engineer", "Guidewire Software", "United States"],
      ["Former Technical Recruiter", "Guidewire Software", "United States"],
      ["Recruiter", "Microsoft", "United States"],
      ["Talent Sourcer", "Guidewire Software", "London, United Kingdom"]
    ] as const;
    const rows = Array.from({ length: 50 }, (_, index) => {
      const [title, company, location] = headlines[index % headlines.length];
      return firecrawlRow(`person-${index}`, company, title, location);
    });
    const batches: DiscoverCandidateEvidence[][] = [];
    const eligibility: DiscoverCandidateEligibilityPort = {
      enabled: true,
      shadow: false,
      evaluate: vi.fn(async ({ candidates }: Parameters<DiscoverCandidateEligibilityPort["evaluate"]>[0]) => {
        batches.push([...candidates]);
        return { shadow: false, diagnostics: {
          ...emptyCandidateJudgeDiagnostics(),
          aiJudgeCandidateCount: candidates.length,
          aiJudgeAcceptedCount: candidates.length
        }, decisions: new Map(candidates.map((candidate) => [candidate.candidateId, {
          candidateId: candidate.candidateId,
          decision: "ACCEPT" as const,
          companyMatch: true,
          roleMatch: true,
          locationMatch: true,
          currentEmployment: true,
          confidence: "HIGH" as const,
          reasonCode: "MATCH" as const,
          matchedRequestedRoles: ["Recruiter"]
        }])) };
      })
    };
    const provider = { configured: true, search: vi.fn(async () => ({
      results: rows, rawResultCount: 50, creditsUsed: 1
    })) };

    const result = await new FirecrawlPublicProfileSearchService(provider, eligibility).searchProfiles({
      companyName: "Guidewire Software",
      locations: ["United States"],
      requestedTitles: ["Recruiter"],
      query: "query",
      budget: judgeBudget()
    });

    expect(batches.flat()).toHaveLength(50);
    expect(batches.flat().map((candidate) => candidate.candidateId)).toHaveLength(50);
    expect(result.diagnostics.aiJudgeCandidateCount).toBe(50);
    expect(result.profiles).toHaveLength(50);
  });
});
