import { coercePositionCategory } from "@/lib/prospect-enums";
import type {
  ApifyIngestionDiagnostics,
  ApifyProfileSearchService,
  NormalizedProfile
} from "@/services/prospects/apify-profile-search";
import {
  BrightDataPublicProfileSearchService,
  brightFailureEvent,
  type BrightProfileDiagnostics,
  type BrightProfileSearchProvider
} from "@/services/prospects/brightdata-public-profile-search";
import type { ResolvedCachePerson } from "@/services/prospects/discover-cache-service";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import type { DiscoverRoleIntelligencePort } from "@/services/prospects/discover-role-intelligence-service";
import { nameStateFields } from "@/services/prospects/discover-name-contract";
import { normalizeDiscoverPersonNames } from "@/services/prospects/discover-person-name-normalization";
import type { AiCallBudget } from "@/services/prospects/prospect-ai";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
import type { RoleClassificationService } from "@/services/prospects/role-classification-service";

export const BRIGHT_APIFY_FALLBACK_THRESHOLD = 3;

export type ProviderContribution = {
  provider: "BRIGHTDATA_GOOGLE" | "APIFY";
  people: ResolvedCachePerson[];
  nextPage: number;
  pagesFetched: number;
  exhausted: boolean;
  providerRunId: string | null;
  providerDatasetId: string | null;
  providerTotalFound: number;
  providerResultCount: number;
};

export type ProviderChainDiagnostics = {
  brightStatus: "DISABLED" | "SUFFICIENT" | "ZERO_RESULTS" | "RESULTS_REJECTED" | "PARTIAL" | "FAILED";
  brightFailureEvent: ReturnType<typeof brightFailureEvent> | null;
  bright: BrightProfileDiagnostics | null;
  apify: ApifyIngestionDiagnostics | null;
  brightValidUnique: number;
  apifyFallbackCalled: boolean;
  apifyNewUnique: number;
  finalUniqueCount: number;
};

export type ProviderChainResult = {
  people: ResolvedCachePerson[];
  contributions: ProviderContribution[];
  diagnostics: ProviderChainDiagnostics;
};

export type DiscoverPeopleProviderOrchestratorDeps = {
  bright?: BrightProfileSearchProvider;
  apify: ApifyProfileSearchService;
  roleClassifier: RoleClassificationService;
  roleIntelligence: DiscoverRoleIntelligencePort;
  fallbackThreshold?: number;
};

export class DiscoverPeopleProviderOrchestrator {
  private readonly bright: BrightProfileSearchProvider;
  private readonly fallbackThreshold: number;

  constructor(private readonly deps: DiscoverPeopleProviderOrchestratorDeps) {
    this.bright = deps.bright ?? new BrightDataPublicProfileSearchService();
    this.fallbackThreshold = deps.fallbackThreshold ?? BRIGHT_APIFY_FALLBACK_THRESHOLD;
  }

  get brightConfigured(): boolean {
    return this.bright.configured;
  }

  async discover(input: {
    companyName: string;
    companyLinkedinUrl: string | null;
    requestedTitles: string[];
    requestedLocations: string[];
    maxResults: number;
    brightStartPage?: number;
    apifyStartPage?: number;
    brightExhausted?: boolean;
    apifyExhausted?: boolean;
    excluded?: PersonIdentitySet;
    budget: AiCallBudget;
    searchId: string;
    onProfilesDiscovered?: () => Promise<void> | void;
  }): Promise<ProviderChainResult> {
    const titles = await this.deps.roleIntelligence.buildProviderTitlePlan(input.requestedTitles, {
      budget: input.budget,
      searchId: input.searchId
    });
    const identities = input.excluded ?? new PersonIdentitySet();
    const contributions: ProviderContribution[] = [];
    let brightPeople: ResolvedCachePerson[] = [];
    let brightDiagnostics: BrightProfileDiagnostics | null = null;
    let brightStatus: ProviderChainDiagnostics["brightStatus"] = this.bright.configured ? "ZERO_RESULTS" : "DISABLED";
    let failureEvent: ReturnType<typeof brightFailureEvent> | null = null;

    if (this.bright.configured && !input.brightExhausted) {
      safeEvent("DISCOVER_BRIGHTDATA_STARTED", { searchId: input.searchId, page: input.brightStartPage ?? 1 });
      try {
        const result = await this.bright.searchProfiles({
          companyName: input.companyName,
          companyLinkedinUrl: input.companyLinkedinUrl,
          jobTitles: titles,
          locations: input.requestedLocations,
          maxResults: input.maxResults,
          startPage: input.brightStartPage ?? 1
        });
        brightDiagnostics = result.diagnostics;
        if (result.profiles.length > 0) await input.onProfilesDiscovered?.();
        brightPeople = await this.buildPeople(result.profiles, input, "CACHE");
        brightPeople = brightPeople.filter((person) => identities.addIfNew(person));
        brightStatus = brightPeople.length >= this.fallbackThreshold
          ? "SUFFICIENT"
          : brightPeople.length > 0
            ? "PARTIAL"
            : result.diagnostics.rawBrightResults > 0
              ? "RESULTS_REJECTED"
              : "ZERO_RESULTS";
        contributions.push({
          provider: "BRIGHTDATA_GOOGLE",
          people: brightPeople,
          nextPage: result.nextPage,
          pagesFetched: 1,
          exhausted: result.exhausted,
          providerRunId: null,
          providerDatasetId: null,
          providerTotalFound: result.diagnostics.rawBrightResults,
          providerResultCount: result.profiles.length
        });
        if (result.diagnostics.enrichmentCalls > 0) {
          safeEvent("DISCOVER_BRIGHTDATA_LOCATION_ENRICHMENT", {
            searchId: input.searchId,
            enrichmentCalls: result.diagnostics.enrichmentCalls,
            locationAccepted: result.diagnostics.locationAccepted,
            locationMissing: result.diagnostics.locationMissing,
            locationContradictionRejected: result.diagnostics.locationContradictionRejected
          });
        }
        safeEvent(brightPeople.length >= this.fallbackThreshold ? "DISCOVER_BRIGHTDATA_SUFFICIENT" : "DISCOVER_BRIGHTDATA_RESULTS", {
          searchId: input.searchId,
          ...result.diagnostics,
          roleAccepted: brightPeople.length,
          brightValidUnique: brightPeople.length,
          outcome:
            brightStatus === "ZERO_RESULTS"
              ? "BRIGHT_ZERO_RESULTS"
              : brightStatus === "RESULTS_REJECTED"
                ? "BRIGHT_RESULTS_REJECTED"
                : "BRIGHT_RESULTS_ACCEPTED"
        });
      } catch (error) {
        brightStatus = "FAILED";
        failureEvent = brightFailureEvent(error);
        safeEvent(failureEvent, { searchId: input.searchId });
      }
    }

    const shouldCallApify = brightPeople.length < this.fallbackThreshold && !input.apifyExhausted;
    let apifyPeople: ResolvedCachePerson[] = [];
    let apifyDiagnostics: ApifyIngestionDiagnostics | null = null;
    if (shouldCallApify) {
      safeEvent("DISCOVER_BRIGHTDATA_FALLBACK_TO_APIFY", {
        searchId: input.searchId,
        brightValidUnique: brightPeople.length,
        apifyFallbackCalled: true,
        reason: brightStatus
      });
      const apify = await this.deps.apify.searchProfiles({
        companyName: input.companyName,
        companyLinkedinUrl: input.companyLinkedinUrl,
        ...(input.companyLinkedinUrl
          ? { companyTargeting: { mode: "LINKEDIN_CURRENT_COMPANY", trusted: true } as const }
          : {}),
        jobTitles: titles,
        locations: input.requestedLocations,
        maxResults: input.maxResults,
        startPage: input.apifyStartPage ?? 1
      });
      apifyDiagnostics = apify.diagnostics;
      if (apify.profiles.length > 0) await input.onProfilesDiscovered?.();
      apifyPeople = await this.buildPeople(apify.profiles, input, "PROVIDER");
      apifyPeople = apifyPeople.filter((person) => identities.addIfNew(person));
      contributions.push({
        provider: "APIFY",
        people: apifyPeople,
        nextPage: (input.apifyStartPage ?? 1) + 1,
        pagesFetched: 1,
        exhausted: apify.profiles.length === 0 || apify.totalFound < input.maxResults,
        providerRunId: apify.runId,
        providerDatasetId: apify.datasetId,
        providerTotalFound: apify.totalFound,
        providerResultCount: apify.profiles.length
      });
      safeEvent("DISCOVER_APIFY_FALLBACK_RESULTS", {
        searchId: input.searchId,
        brightValidUnique: brightPeople.length,
        apifyFallbackCalled: true,
        apifyNewUnique: apifyPeople.length,
        finalUniqueCount: brightPeople.length + apifyPeople.length
      });
    }

    const people = [...brightPeople, ...apifyPeople].slice(0, input.maxResults);
    return {
      people,
      contributions,
      diagnostics: {
        brightStatus,
        brightFailureEvent: failureEvent,
        bright: brightDiagnostics,
        apify: apifyDiagnostics,
        brightValidUnique: brightPeople.length,
        apifyFallbackCalled: shouldCallApify,
        apifyNewUnique: apifyPeople.length,
        finalUniqueCount: people.length
      }
    };
  }

  private async buildPeople(
    rawProfiles: NormalizedProfile[],
    input: {
      companyName: string;
      requestedTitles: string[];
      requestedLocations: string[];
      budget: AiCallBudget;
      searchId: string;
    },
    context: "CACHE" | "PROVIDER"
  ): Promise<ResolvedCachePerson[]> {
    const profiles = await normalizeDiscoverPersonNames(rawProfiles, {
      companyName: input.companyName,
      budget: input.budget
    });
    const classifications = await this.deps.roleClassifier.classify(
      profiles.map((profile) => profile.currentTitle).filter((title): title is string => Boolean(title)),
      { budget: input.budget, searchId: input.searchId }
    );
    const people = profiles.map((profile): ResolvedCachePerson => {
      const normalized = profile.normalizedTitle ?? normalizeTitle(profile.currentTitle ?? "");
      return {
        sourceProfileId: profile.sourceProfileId,
        firstName: profile.firstName,
        lastName: profile.lastName,
        fullName: profile.fullName,
        ...nameStateFields(profile),
        currentTitle: profile.currentTitle,
        normalizedTitle: normalized || null,
        positionCategory: coercePositionCategory(classifications.get(normalized)?.category),
        location: profile.location,
        country: profile.country,
        state: profile.state,
        city: profile.city,
        linkedinUrl: profile.linkedinUrl,
        inferredEmail: null,
        emailStatus: "UNAVAILABLE",
        emailConfidence: "UNAVAILABLE",
        emailPattern: null,
        emailSource: null
      };
    });
    // Preserve master behavior for Apify while semantic role intelligence is
    // disabled. Bright still requires explicit public role validation.
    if (context === "PROVIDER" && !this.deps.roleIntelligence.enabled) return people;
    return this.deps.roleIntelligence.filterAndRankPeople({
      people,
      requestedTitles: input.requestedTitles,
      requestedLocations: input.requestedLocations,
      context,
      options: { budget: input.budget, searchId: input.searchId }
    });
  }
}

function safeEvent(event: string, counters: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "test") return;
  console.info(JSON.stringify({ event, ...counters }));
}
