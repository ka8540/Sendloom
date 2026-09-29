import type { ApifyProfileSearchInput, NormalizedProfile } from "@/services/prospects/apify-profile-search";
import {
  BrightDataGoogleSearchProvider,
  type BrightDataFailure,
  type BrightDataPeopleSearchProvider,
  type BrightOrganicResult
} from "@/services/prospects/brightdata-google-search-provider";
import { validateCurrentEmployment } from "@/services/prospects/current-employment-evidence";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import { canonicalizeLinkedInProfileUrl } from "@/services/prospects/linkedin-profile-url";
import { parseLinkedInSearchResult } from "@/services/prospects/linkedin-search-result-parser";
import { buildPublicPeopleRoleUnionQuery } from "@/services/prospects/public-people-query-builder";
import { extractPublicLocationEvidence, resolvePublicLocation } from "@/services/prospects/public-profile-location";
import { env } from "@/lib/env";
import { DiscoverCandidateEligibilityService, type DiscoverCandidateEligibilityPort } from "@/services/prospects/discover-candidate-eligibility-service";
import { emptyPublicProfileDiagnostics, judgePublicProfileSearchResults, type PublicProfileDiagnostics } from "@/services/prospects/public-profile-search-metadata";
import type { AiCallBudget } from "@/services/prospects/prospect-ai";

export type BrightProfileDiagnostics = PublicProfileDiagnostics & {
  rawBrightResults: number;
  linkedInCandidates: number;
  currentEmploymentAccepted: number;
  formerEmployeeRejected: number;
  companyContradictionRejected: number;
  companyInsufficientRejected: number;
  locationAccepted: number;
  locationMissing: number;
  locationContradictionRejected: number;
  enrichmentCalls: number;
};

export type BrightProfileSearchResult = {
  profiles: NormalizedProfile[];
  diagnostics: BrightProfileDiagnostics;
  nextPage: number;
  exhausted: boolean;
};

export interface BrightProfileSearchProvider {
  readonly configured: boolean;
  searchProfiles(
    input: ApifyProfileSearchInput & {
      signal?: AbortSignal;
      deadlineAtMs?: number;
      locationEnrichmentLimit?: number;
      requestedTitles?: string[];
      budget?: AiCallBudget;
      searchId?: string | null;
    }
  ): Promise<BrightProfileSearchResult>;
}

function counters(): BrightProfileDiagnostics {
  return {
    ...emptyPublicProfileDiagnostics(),
    rawBrightResults: 0,
    linkedInCandidates: 0,
    currentEmploymentAccepted: 0,
    formerEmployeeRejected: 0,
    companyContradictionRejected: 0,
    companyInsufficientRejected: 0,
    locationAccepted: 0,
    locationMissing: 0,
    locationContradictionRejected: 0,
    enrichmentCalls: 0
  };
}

function enrichmentQuery(profile: NormalizedProfile, companyName: string, locations: readonly string[]): string {
  return [
    `site:linkedin.com/in/${profile.sourceProfileId}`,
    `"${profile.sourceName ?? profile.fullName}"`,
    `"${companyName}"`,
    ...locations.map((location) => `"${location}"`)
  ].join(" ");
}

function evidenceFor(result: BrightOrganicResult): string[] {
  return [result.title, result.snippet ?? "", result.displayedUrl ?? "", ...result.evidence].filter(Boolean);
}

export class BrightDataPublicProfileSearchService implements BrightProfileSearchProvider {
  readonly configured: boolean;

  constructor(
    private readonly provider: BrightDataPeopleSearchProvider = new BrightDataGoogleSearchProvider(),
    private readonly enrichmentLimit = env.DISCOVER_BRIGHTDATA_LOCATION_ENRICHMENT_LIMIT,
    private readonly eligibility: DiscoverCandidateEligibilityPort = new DiscoverCandidateEligibilityService()
  ) {
    this.configured = provider.configured;
  }

  private async validateDeterministically(
    results: readonly BrightOrganicResult[],
    input: ApifyProfileSearchInput & {
      signal?: AbortSignal;
      deadlineAtMs?: number;
      locationEnrichmentLimit?: number;
    },
    diagnostics: BrightProfileDiagnostics
  ): Promise<NormalizedProfile[]> {
    const accepted: Array<{ profile: NormalizedProfile; result: BrightOrganicResult }> = [];
    const seen = new PersonIdentitySet();

    for (const result of results) {
      const profile = parseLinkedInSearchResult(result, { expectedCompanyName: input.companyName });
      if (!profile) continue;
      diagnostics.linkedInCandidates += 1;
      if (!seen.addIfNew(profile)) {
        diagnostics.duplicateRejected += 1;
        continue;
      }
      const employment = validateCurrentEmployment(result, profile, input.companyName);
      if (employment.decision !== "CURRENT") {
        if (employment.decision === "FORMER") diagnostics.formerEmployeeRejected += 1;
        else if (employment.decision === "CONTRADICTORY") diagnostics.companyContradictionRejected += 1;
        else diagnostics.companyInsufficientRejected += 1;
        continue;
      }
      diagnostics.currentEmploymentAccepted += 1;
      accepted.push({ profile, result });
    }

    const profiles: NormalizedProfile[] = [];
    let enrichmentCalls = 0;
    const enrichmentLimit = Math.max(
      0,
      Math.min(this.enrichmentLimit, input.locationEnrichmentLimit ?? this.enrichmentLimit)
    );
    for (const candidate of accepted) {
      let evidence = extractPublicLocationEvidence(evidenceFor(candidate.result), input.companyName);
      if (!evidence && enrichmentCalls < enrichmentLimit) {
        enrichmentCalls += 1;
        diagnostics.enrichmentCalls += 1;
        const enriched = await this.provider.search(enrichmentQuery(candidate.profile, input.companyName, input.locations), {
          page: 1,
          requestedLocations: input.locations,
          signal: input.signal,
          deadlineAtMs: input.deadlineAtMs
        });
        const identity = canonicalizeLinkedInProfileUrl(candidate.profile.linkedinUrl);
        const matching = enriched.results.find((row) => {
          const rowIdentity = canonicalizeLinkedInProfileUrl(row.url);
          return identity && rowIdentity?.sourceProfileId === identity.sourceProfileId;
        });
        if (matching) evidence = extractPublicLocationEvidence(evidenceFor(matching), input.companyName);
      }
      const location = resolvePublicLocation({ evidence, requestedLocations: input.locations });
      if (!location.accepted) {
        if (location.contradiction) diagnostics.locationContradictionRejected += 1;
        else diagnostics.locationMissing += 1;
        continue;
      }
      if (location.location.location) diagnostics.locationAccepted += 1;
      else diagnostics.locationMissing += 1;
      profiles.push({ ...candidate.profile, ...location.location });
    }
    return profiles;
  }

  async searchProfiles(
    input: ApifyProfileSearchInput & {
      signal?: AbortSignal;
      deadlineAtMs?: number;
      locationEnrichmentLimit?: number;
      requestedTitles?: string[];
      budget?: AiCallBudget;
      searchId?: string | null;
    }
  ): Promise<BrightProfileSearchResult> {
    const diagnostics = counters();
    const page = Math.max(1, Math.floor(input.startPage ?? 1));
    const query = buildPublicPeopleRoleUnionQuery({
      companyName: input.companyName,
      providerTitles: input.jobTitles,
      locations: input.locations
    });
    if (!query) return { profiles: [], diagnostics, nextPage: page, exhausted: true };

    const response = await this.provider.search(query, {
      page,
      requestedLocations: input.locations,
      signal: input.signal,
      deadlineAtMs: input.deadlineAtMs
    });
    diagnostics.rawBrightResults = response.rawOrganicResults;
    diagnostics.preJudgeMalformedCount = Math.max(0, response.rawOrganicResults - response.results.length);
    if (input.budget && input.requestedTitles && this.eligibility.enabled) {
      const profiles = await judgePublicProfileSearchResults(
        response.results.map((result) => ({
          url: result.url,
          title: result.title,
          description: result.snippet ?? ""
        })),
        {
          companyName: input.companyName,
          locations: input.locations,
          requestedTitles: input.requestedTitles,
          provider: "BRIGHTDATA_GOOGLE",
          searchId: input.searchId,
          budget: input.budget
        },
        diagnostics,
        this.eligibility,
        async () => {
          const fallbackDiagnostics = counters();
          const profiles = await this.validateDeterministically(response.results, input, fallbackDiagnostics);
          diagnostics.enrichmentCalls += fallbackDiagnostics.enrichmentCalls;
          return profiles;
        }
      );
      return {
        profiles: profiles.slice(0, Math.max(1, Math.floor(input.maxResults))),
        diagnostics,
        nextPage: page + 1,
        exhausted: response.exhausted
      };
    }
    const profiles = await this.validateDeterministically(response.results, input, diagnostics);

    return {
      profiles: profiles.slice(0, Math.max(1, Math.floor(input.maxResults))),
      diagnostics,
      nextPage: page + 1,
      exhausted: response.exhausted
    };
  }
}

export function brightFailureEvent(error: unknown):
  | "BRIGHT_AUTH_ERROR"
  | "BRIGHT_TIMEOUT"
  | "BRIGHT_PROVIDER_ERROR"
  | "BRIGHT_MALFORMED_RESPONSE" {
  const kind = (error as { kind?: BrightDataFailure })?.kind;
  if (kind === "CONFIGURATION" || kind === "AUTHENTICATION") return "BRIGHT_AUTH_ERROR";
  if (kind === "TIMEOUT") return "BRIGHT_TIMEOUT";
  if (kind === "MALFORMED_RESPONSE") return "BRIGHT_MALFORMED_RESPONSE";
  return "BRIGHT_PROVIDER_ERROR";
}
