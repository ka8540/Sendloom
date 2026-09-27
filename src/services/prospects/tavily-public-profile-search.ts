import type { ApifyProfileSearchInput, NormalizedProfile } from "@/services/prospects/apify-profile-search";
import { validateCurrentEmployment } from "@/services/prospects/current-employment-evidence";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import { parseLinkedInSearchResult } from "@/services/prospects/linkedin-search-result-parser";
import { extractPublicLocationEvidence, resolvePublicLocation } from "@/services/prospects/public-profile-location";
import {
  TavilySearchProvider,
  type TavilyPeopleSearchProvider
} from "@/services/prospects/tavily-search-provider";
import type { BrightOrganicResult } from "@/services/prospects/brightdata-google-search-provider";

export type TavilyProfileDiagnostics = {
  rawTavilyResults: number;
  linkedInCandidates: number;
  currentEmploymentAccepted: number;
  formerEmployeeRejected: number;
  companyContradictionRejected: number;
  companyInsufficientRejected: number;
  locationAccepted: number;
  locationMissing: number;
  locationContradictionRejected: number;
  roleRejected: number;
  duplicateRejected: number;
  creditsUsed: number;
};

export type TavilyProfileSearchResult = {
  profiles: NormalizedProfile[];
  diagnostics: TavilyProfileDiagnostics;
};

export interface TavilyProfileSearchProvider {
  readonly configured: boolean;
  searchProfiles(input: Pick<ApifyProfileSearchInput, "companyName" | "locations"> & {
    query: string;
    signal?: AbortSignal;
  }): Promise<TavilyProfileSearchResult>;
}

function diagnostics(): TavilyProfileDiagnostics {
  return {
    rawTavilyResults: 0,
    linkedInCandidates: 0,
    currentEmploymentAccepted: 0,
    formerEmployeeRejected: 0,
    companyContradictionRejected: 0,
    companyInsufficientRejected: 0,
    locationAccepted: 0,
    locationMissing: 0,
    locationContradictionRejected: 0,
    roleRejected: 0,
    duplicateRejected: 0,
    creditsUsed: 0
  };
}

export class TavilyPublicProfileSearchService implements TavilyProfileSearchProvider {
  readonly configured: boolean;

  constructor(private readonly provider: TavilyPeopleSearchProvider = new TavilySearchProvider()) {
    this.configured = provider.configured;
  }

  async searchProfiles(input: Pick<ApifyProfileSearchInput, "companyName" | "locations"> & {
    query: string;
    signal?: AbortSignal;
  }): Promise<TavilyProfileSearchResult> {
    const counts = diagnostics();
    const response = await this.provider.search(input.query, { signal: input.signal });
    counts.rawTavilyResults = response.rawResultCount;
    counts.creditsUsed = response.creditsUsed ?? 0;
    const seen = new PersonIdentitySet();
    const profiles: NormalizedProfile[] = [];

    for (const row of response.results) {
      const result: BrightOrganicResult = {
        title: row.title,
        url: row.url,
        rawUrl: row.url,
        displayedUrl: null,
        snippet: row.content,
        evidence: [row.title, row.content]
      };
      const profile = parseLinkedInSearchResult(result);
      if (!profile) continue;
      counts.linkedInCandidates += 1;
      if (!seen.addIfNew(profile)) {
        counts.duplicateRejected += 1;
        continue;
      }
      const employment = validateCurrentEmployment(result, profile, input.companyName);
      if (employment.decision !== "CURRENT") {
        if (employment.decision === "FORMER") counts.formerEmployeeRejected += 1;
        else if (employment.decision === "CONTRADICTORY") counts.companyContradictionRejected += 1;
        else counts.companyInsufficientRejected += 1;
        continue;
      }
      counts.currentEmploymentAccepted += 1;
      const evidence = extractPublicLocationEvidence([row.title, row.content], input.companyName);
      const location = resolvePublicLocation({ evidence, requestedLocations: input.locations });
      if (!location.accepted) {
        if (location.contradiction) counts.locationContradictionRejected += 1;
        else counts.locationMissing += 1;
        continue;
      }
      if (location.location.location) counts.locationAccepted += 1;
      else counts.locationMissing += 1;
      profiles.push({ ...profile, ...location.location });
    }
    return { profiles, diagnostics: counts };
  }
}
