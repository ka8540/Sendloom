import type { NormalizedProfile } from "@/services/prospects/apify-profile-search";
import { FirecrawlSearchProvider, type FirecrawlPeopleSearchProvider, type FirecrawlRequestOptions } from "@/services/prospects/firecrawl-search-provider";
import { emptyPublicProfileDiagnostics, validatePublicProfileSearchResults, type PublicProfileDiagnostics } from "@/services/prospects/public-profile-search-metadata";
import { judgePublicProfileSearchResults } from "@/services/prospects/public-profile-search-metadata";
import { DiscoverCandidateEligibilityService, type DiscoverCandidateEligibilityPort } from "@/services/prospects/discover-candidate-eligibility-service";
import type { AiCallBudget } from "@/services/prospects/prospect-ai";

export type FirecrawlProfileDiagnostics = PublicProfileDiagnostics & { rawFirecrawlResults: number; creditsUsed: number };
export type FirecrawlProfileSearchResult = { profiles: NormalizedProfile[]; diagnostics: FirecrawlProfileDiagnostics };
export type FirecrawlProfileSearchInput = FirecrawlRequestOptions & {
  companyName: string;
  locations: string[];
  query: string;
  requestedTitles?: string[];
  budget?: AiCallBudget;
  searchId?: string | null;
};
export interface FirecrawlProfileSearchProvider {
  readonly configured: boolean;
  searchProfiles(input: FirecrawlProfileSearchInput): Promise<FirecrawlProfileSearchResult>;
}

export class FirecrawlPublicProfileSearchService implements FirecrawlProfileSearchProvider {
  readonly configured: boolean;
  constructor(
    private readonly provider: FirecrawlPeopleSearchProvider = new FirecrawlSearchProvider(),
    private readonly eligibility: DiscoverCandidateEligibilityPort = new DiscoverCandidateEligibilityService()
  ) {
    this.configured = provider.configured;
  }
  async searchProfiles(input: FirecrawlProfileSearchInput): Promise<FirecrawlProfileSearchResult> {
    const response = await this.provider.search(input.query, { signal: input.signal, deadlineAtMs: input.deadlineAtMs });
    const diagnostics: FirecrawlProfileDiagnostics = {
      ...emptyPublicProfileDiagnostics(), rawFirecrawlResults: response.rawResultCount, creditsUsed: response.creditsUsed ?? 0
    };
    diagnostics.preJudgeMalformedCount = Math.max(0, response.rawResultCount - response.results.length);
    const profiles = input.budget && input.requestedTitles
      ? await judgePublicProfileSearchResults(response.results, {
        ...input, requestedTitles: input.requestedTitles, provider: "FIRECRAWL", budget: input.budget
      }, diagnostics, this.eligibility)
      : validatePublicProfileSearchResults(response.results, input, diagnostics);
    return { profiles, diagnostics };
  }
}
