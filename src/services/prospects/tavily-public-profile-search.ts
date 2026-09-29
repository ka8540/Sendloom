import type { ApifyProfileSearchInput, NormalizedProfile } from "@/services/prospects/apify-profile-search";
import { emptyPublicProfileDiagnostics, judgePublicProfileSearchResults, validatePublicProfileSearchResults, type PublicProfileDiagnostics } from "@/services/prospects/public-profile-search-metadata";
import { TavilySearchProvider, type TavilyPeopleSearchProvider } from "@/services/prospects/tavily-search-provider";
import { DiscoverCandidateEligibilityService, type DiscoverCandidateEligibilityPort } from "@/services/prospects/discover-candidate-eligibility-service";
import type { AiCallBudget } from "@/services/prospects/prospect-ai";

export type TavilyProfileDiagnostics = PublicProfileDiagnostics & { rawTavilyResults: number; creditsUsed: number };
export type TavilyProfileSearchResult = { profiles: NormalizedProfile[]; diagnostics: TavilyProfileDiagnostics };
export interface TavilyProfileSearchProvider {
  readonly configured: boolean;
  searchProfiles(input: Pick<ApifyProfileSearchInput, "companyName" | "locations"> & {
    query: string; signal?: AbortSignal;
    requestedTitles?: string[]; budget?: AiCallBudget; searchId?: string | null;
  }): Promise<TavilyProfileSearchResult>;
}

export class TavilyPublicProfileSearchService implements TavilyProfileSearchProvider {
  readonly configured: boolean;
  constructor(
    private readonly provider: TavilyPeopleSearchProvider = new TavilySearchProvider(),
    private readonly eligibility: DiscoverCandidateEligibilityPort = new DiscoverCandidateEligibilityService()
  ) {
    this.configured = provider.configured;
  }
  async searchProfiles(input: Pick<ApifyProfileSearchInput, "companyName" | "locations"> & {
    query: string; signal?: AbortSignal;
    requestedTitles?: string[]; budget?: AiCallBudget; searchId?: string | null;
  }): Promise<TavilyProfileSearchResult> {
    const response = await this.provider.search(input.query, { signal: input.signal });
    const diagnostics: TavilyProfileDiagnostics = {
      ...emptyPublicProfileDiagnostics(), rawTavilyResults: response.rawResultCount, creditsUsed: response.creditsUsed ?? 0
    };
    diagnostics.preJudgeMalformedCount = Math.max(0, response.rawResultCount - response.results.length);
    const rows = response.results.map((row) => ({ ...row, description: row.content }));
    const profiles = input.budget && input.requestedTitles
      ? await judgePublicProfileSearchResults(rows, {
        ...input, requestedTitles: input.requestedTitles, provider: "TAVILY", budget: input.budget
      }, diagnostics, this.eligibility)
      : validatePublicProfileSearchResults(rows, input, diagnostics);
    return { profiles, diagnostics };
  }
}
