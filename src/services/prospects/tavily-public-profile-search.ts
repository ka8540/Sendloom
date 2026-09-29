import type { ApifyProfileSearchInput, NormalizedProfile } from "@/services/prospects/apify-profile-search";
import { emptyPublicProfileDiagnostics, validatePublicProfileSearchResults, type PublicProfileDiagnostics } from "@/services/prospects/public-profile-search-metadata";
import { TavilySearchProvider, type TavilyPeopleSearchProvider } from "@/services/prospects/tavily-search-provider";

export type TavilyProfileDiagnostics = PublicProfileDiagnostics & { rawTavilyResults: number; creditsUsed: number };
export type TavilyProfileSearchResult = { profiles: NormalizedProfile[]; diagnostics: TavilyProfileDiagnostics };
export interface TavilyProfileSearchProvider {
  readonly configured: boolean;
  searchProfiles(input: Pick<ApifyProfileSearchInput, "companyName" | "locations"> & {
    query: string; signal?: AbortSignal;
  }): Promise<TavilyProfileSearchResult>;
}

export class TavilyPublicProfileSearchService implements TavilyProfileSearchProvider {
  readonly configured: boolean;
  constructor(private readonly provider: TavilyPeopleSearchProvider = new TavilySearchProvider()) {
    this.configured = provider.configured;
  }
  async searchProfiles(input: Pick<ApifyProfileSearchInput, "companyName" | "locations"> & {
    query: string; signal?: AbortSignal;
  }): Promise<TavilyProfileSearchResult> {
    const response = await this.provider.search(input.query, { signal: input.signal });
    const diagnostics: TavilyProfileDiagnostics = {
      ...emptyPublicProfileDiagnostics(), rawTavilyResults: response.rawResultCount, creditsUsed: response.creditsUsed ?? 0
    };
    const profiles = validatePublicProfileSearchResults(
      response.results.map((row) => ({ ...row, description: row.content })), input, diagnostics
    );
    return { profiles, diagnostics };
  }
}
