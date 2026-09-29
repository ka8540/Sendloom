import type { NormalizedProfile } from "@/services/prospects/apify-profile-search";
import { FirecrawlSearchProvider, type FirecrawlPeopleSearchProvider, type FirecrawlRequestOptions } from "@/services/prospects/firecrawl-search-provider";
import { emptyPublicProfileDiagnostics, validatePublicProfileSearchResults, type PublicProfileDiagnostics } from "@/services/prospects/public-profile-search-metadata";

export type FirecrawlProfileDiagnostics = PublicProfileDiagnostics & { rawFirecrawlResults: number; creditsUsed: number };
export type FirecrawlProfileSearchResult = { profiles: NormalizedProfile[]; diagnostics: FirecrawlProfileDiagnostics };
export type FirecrawlProfileSearchInput = FirecrawlRequestOptions & { companyName: string; locations: string[]; query: string };
export interface FirecrawlProfileSearchProvider {
  readonly configured: boolean;
  searchProfiles(input: FirecrawlProfileSearchInput): Promise<FirecrawlProfileSearchResult>;
}

export class FirecrawlPublicProfileSearchService implements FirecrawlProfileSearchProvider {
  readonly configured: boolean;
  constructor(private readonly provider: FirecrawlPeopleSearchProvider = new FirecrawlSearchProvider()) {
    this.configured = provider.configured;
  }
  async searchProfiles(input: FirecrawlProfileSearchInput): Promise<FirecrawlProfileSearchResult> {
    const response = await this.provider.search(input.query, { signal: input.signal, deadlineAtMs: input.deadlineAtMs });
    const diagnostics: FirecrawlProfileDiagnostics = {
      ...emptyPublicProfileDiagnostics(), rawFirecrawlResults: response.rawResultCount, creditsUsed: response.creditsUsed ?? 0
    };
    return { profiles: validatePublicProfileSearchResults(response.results, input, diagnostics), diagnostics };
  }
}
