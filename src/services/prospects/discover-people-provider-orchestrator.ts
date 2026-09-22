import { coercePositionCategory } from "@/lib/prospect-enums";
import { env } from "@/lib/env";
import {
  ApifyCompanyTargetingError,
  type ApifyIngestionDiagnostics,
  type ApifyProfileSearchService,
  type NormalizedProfile
} from "@/services/prospects/apify-profile-search";
import {
  canonicalizeLinkedinCompanyUrl
} from "@/services/prospects/canonical-company";
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

export type BrightStopReason =
  | "TARGET_REACHED"
  | "EMPTY_PAGE"
  | "MAX_PAGES"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "PARENT_DEADLINE"
  | "DISABLED"
  | "ALREADY_EXHAUSTED";

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
  brightRequestCompleted: boolean;
  brightTimedOut: boolean;
  apifyFallbackCalled: boolean;
  apifyCompanyTargeted: boolean;
  apifyNewUnique: number;
  finalUniqueCount: number;
  brightStartPage: number;
  brightEndPage: number;
  brightPagesAttempted: number;
  brightPagesSucceeded: number;
  desiredCount: number;
  stopReason: BrightStopReason;
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
  brightMaxPages?: number;
  minimumRemainingBudgetMs?: number;
};

function emptyBrightDiagnostics(): BrightProfileDiagnostics {
  return {
    rawBrightResults: 0,
    linkedInCandidates: 0,
    currentEmploymentAccepted: 0,
    formerEmployeeRejected: 0,
    companyContradictionRejected: 0,
    companyInsufficientRejected: 0,
    locationAccepted: 0,
    locationMissing: 0,
    locationContradictionRejected: 0,
    duplicateRejected: 0,
    enrichmentCalls: 0
  };
}

function addBrightDiagnostics(
  total: BrightProfileDiagnostics,
  page: BrightProfileDiagnostics
): void {
  for (const key of Object.keys(total) as Array<keyof BrightProfileDiagnostics>) {
    total[key] += page[key];
  }
}

export class DiscoverPeopleProviderOrchestrator {
  private readonly bright: BrightProfileSearchProvider;
  private readonly fallbackThreshold: number;
  private readonly brightMaxPages: number;
  private readonly minimumRemainingBudgetMs: number;

  constructor(private readonly deps: DiscoverPeopleProviderOrchestratorDeps) {
    this.bright = deps.bright ?? new BrightDataPublicProfileSearchService();
    this.fallbackThreshold = deps.fallbackThreshold ?? BRIGHT_APIFY_FALLBACK_THRESHOLD;
    this.brightMaxPages = deps.brightMaxPages ?? env.DISCOVER_BRIGHTDATA_MAX_PAGES;
    this.minimumRemainingBudgetMs = deps.minimumRemainingBudgetMs ?? 5_000;
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
    /** Valid unique people this action should try to collect before stopping Bright. */
    desiredCount?: number;
    brightStartPage?: number;
    apifyStartPage?: number;
    brightExhausted?: boolean;
    apifyExhausted?: boolean;
    excluded?: PersonIdentitySet;
    budget: AiCallBudget;
    searchId: string;
    canonicalCompanyKey?: string;
    brightPagesFetched?: number;
    apifyPagesFetched?: number;
    brightPageAttemptLimit?: number;
    signal?: AbortSignal;
    deadlineAtMs?: number;
    onProfilesDiscovered?: () => Promise<void> | void;
    /** Durable boundary invoked after each successful Bright page, before the next page starts. */
    onBrightPage?: (contribution: ProviderContribution) => Promise<void>;
    resolveCompanyLinkedinUrl?: () => Promise<string | null>;
  }): Promise<ProviderChainResult> {
    const titles = await this.deps.roleIntelligence.buildProviderTitlePlan(input.requestedTitles, {
      budget: input.budget,
      searchId: input.searchId
    });
    const identities = input.excluded ?? new PersonIdentitySet();
    const contributions: ProviderContribution[] = [];
    const brightPeople: ResolvedCachePerson[] = [];
    const aggregateBrightDiagnostics = emptyBrightDiagnostics();
    let brightDiagnostics: BrightProfileDiagnostics | null = null;
    let brightStatus: ProviderChainDiagnostics["brightStatus"] = this.bright.configured ? "ZERO_RESULTS" : "DISABLED";
    let failureEvent: ReturnType<typeof brightFailureEvent> | null = null;
    let brightRequestCompleted = false;
    let brightTimedOut = false;
    let companyLinkedinUrl = canonicalizeLinkedinCompanyUrl(input.companyLinkedinUrl);
    const brightStartPage = Math.max(1, Math.floor(input.brightStartPage ?? 1));
    const brightPagesFetched = input.brightPagesFetched ?? 0;
    const apifyStartPage = input.apifyStartPage ?? 1;
    const apifyPagesFetched = input.apifyPagesFetched ?? 0;
    const desiredCount = Math.max(1, Math.floor(input.desiredCount ?? input.maxResults));
    const brightPageAttemptLimit = Math.max(
      1,
      Math.floor(input.brightPageAttemptLimit ?? this.brightMaxPages)
    );
    let brightEndPage = brightStartPage;
    let brightPagesAttempted = 0;
    let brightPagesSucceeded = 0;
    let remainingLocationEnrichmentCalls = env.DISCOVER_BRIGHTDATA_LOCATION_ENRICHMENT_LIMIT;
    let stopReason: BrightStopReason = this.bright.configured
      ? input.brightExhausted
        ? "ALREADY_EXHAUSTED"
        : "MAX_PAGES"
      : "DISABLED";
    let page = brightStartPage;
    const parentDeadlineReached = () =>
      Boolean(input.signal?.aborted) ||
      (typeof input.deadlineAtMs === "number" &&
        input.deadlineAtMs - Date.now() <= this.minimumRemainingBudgetMs);

    if (this.bright.configured && !input.brightExhausted) {
      safeEvent("DISCOVER_BRIGHTDATA_STARTED", {
        searchId: input.searchId,
        canonicalCompanyKey: input.canonicalCompanyKey ?? null,
        companyLinkedinResolved: Boolean(companyLinkedinUrl),
        brightConfigured: true,
        brightStartPage,
        brightNextPage: brightStartPage,
        brightPagesFetched,
        brightExhausted: false,
        desiredCount
      });

      while (
        brightPeople.length < desiredCount &&
        page <= this.brightMaxPages &&
        brightPagesAttempted < brightPageAttemptLimit
      ) {
        if (parentDeadlineReached()) {
          stopReason = "PARENT_DEADLINE";
          break;
        }

        brightPagesAttempted += 1;
        brightEndPage = page;
        let result: Awaited<ReturnType<BrightProfileSearchProvider["searchProfiles"]>>;
        try {
          result = await this.bright.searchProfiles({
            companyName: input.companyName,
            companyLinkedinUrl,
            jobTitles: titles,
            locations: input.requestedLocations,
            maxResults: input.maxResults,
            startPage: page,
            signal: input.signal,
            locationEnrichmentLimit: remainingLocationEnrichmentCalls
          });
        } catch (error) {
          if (parentDeadlineReached()) {
            stopReason = "PARENT_DEADLINE";
          } else {
            failureEvent = brightFailureEvent(error);
            brightTimedOut = failureEvent === "BRIGHT_TIMEOUT";
            stopReason = brightTimedOut ? "TIMEOUT" : "PROVIDER_ERROR";
          }
          brightStatus = "FAILED";
          safeEvent(failureEvent ?? "BRIGHT_PARENT_DEADLINE", {
            searchId: input.searchId,
            canonicalCompanyKey: input.canonicalCompanyKey ?? null,
            companyLinkedinResolved: Boolean(companyLinkedinUrl),
            brightConfigured: true,
            brightStartPage,
            brightEndPage,
            brightNextPage: page,
            brightPagesAttempted,
            brightPagesSucceeded,
            brightPagesFetched: brightPagesFetched + brightPagesSucceeded,
            brightExhausted: false,
            brightRequestCompleted,
            brightTimedOut,
            totalRawBrightResults: aggregateBrightDiagnostics.rawBrightResults,
            totalBrightValidUnique: brightPeople.length,
            desiredCount,
            stopReason
          });
          break;
        }

        brightPagesSucceeded += 1;
        brightRequestCompleted = true;
        addBrightDiagnostics(aggregateBrightDiagnostics, result.diagnostics);
        remainingLocationEnrichmentCalls = Math.max(
          0,
          remainingLocationEnrichmentCalls - result.diagnostics.enrichmentCalls
        );
        brightDiagnostics = aggregateBrightDiagnostics;
        if (result.profiles.length > 0) await input.onProfilesDiscovered?.();
        const processedPage = await this.buildPeople(result.profiles, input, "CACHE");
        const uniquePage = processedPage.filter((person) => identities.addIfNew(person));
        aggregateBrightDiagnostics.duplicateRejected += processedPage.length - uniquePage.length;
        brightPeople.push(...uniquePage);
        const reachedPageCap = page >= this.brightMaxPages;
        const contribution: ProviderContribution = {
          provider: "BRIGHTDATA_GOOGLE",
          people: uniquePage,
          nextPage: Math.max(page + 1, result.nextPage),
          pagesFetched: 1,
          exhausted: result.exhausted || reachedPageCap,
          providerRunId: null,
          providerDatasetId: null,
          providerTotalFound: result.diagnostics.rawBrightResults,
          providerResultCount: result.profiles.length
        };
        contributions.push(contribution);
        await input.onBrightPage?.(contribution);
        if (result.diagnostics.enrichmentCalls > 0) {
          safeEvent("DISCOVER_BRIGHTDATA_LOCATION_ENRICHMENT", {
            searchId: input.searchId,
            page,
            enrichmentCalls: result.diagnostics.enrichmentCalls,
            locationAccepted: result.diagnostics.locationAccepted,
            locationMissing: result.diagnostics.locationMissing,
            locationContradictionRejected: result.diagnostics.locationContradictionRejected
          });
        }
        safeEvent("DISCOVER_BRIGHTDATA_PAGE_RESULTS", {
          searchId: input.searchId,
          canonicalCompanyKey: input.canonicalCompanyKey ?? null,
          companyLinkedinResolved: Boolean(companyLinkedinUrl),
          page,
          brightNextPage: contribution.nextPage,
          brightPagesFetched: brightPagesFetched + brightPagesSucceeded,
          brightExhausted: contribution.exhausted,
          ...result.diagnostics,
          pageBrightValidUnique: uniquePage.length,
          totalBrightValidUnique: brightPeople.length,
          desiredCount
        });

        if (brightPeople.length >= desiredCount) {
          stopReason = "TARGET_REACHED";
          break;
        }
        if (result.diagnostics.rawBrightResults === 0) {
          stopReason = "EMPTY_PAGE";
          break;
        }
        if (contribution.exhausted) {
          stopReason = "MAX_PAGES";
          break;
        }
        page = contribution.nextPage;
      }

      if (
        brightPeople.length < desiredCount &&
        (page > this.brightMaxPages || brightPagesAttempted >= brightPageAttemptLimit)
      ) stopReason = "MAX_PAGES";
      if (!failureEvent && stopReason !== "PARENT_DEADLINE") {
        brightStatus = brightPeople.length >= this.fallbackThreshold
          ? "SUFFICIENT"
          : brightPeople.length > 0
            ? "PARTIAL"
            : aggregateBrightDiagnostics.rawBrightResults > 0
              ? "RESULTS_REJECTED"
              : "ZERO_RESULTS";
      }
      safeEvent(brightPeople.length >= this.fallbackThreshold ? "DISCOVER_BRIGHTDATA_SUFFICIENT" : "DISCOVER_BRIGHTDATA_RESULTS", {
        searchId: input.searchId,
        canonicalCompanyKey: input.canonicalCompanyKey ?? null,
        companyLinkedinResolved: Boolean(companyLinkedinUrl),
        brightConfigured: true,
        brightStartPage,
        brightEndPage,
        brightPagesAttempted,
        brightPagesSucceeded,
        brightNextPage: contributions.at(-1)?.nextPage ?? brightStartPage,
        brightPagesFetched: brightPagesFetched + brightPagesSucceeded,
        brightExhausted: contributions.at(-1)?.exhausted ?? false,
        brightRequestCompleted,
        brightTimedOut,
        totalRawBrightResults: aggregateBrightDiagnostics.rawBrightResults,
        totalLinkedInCandidates: aggregateBrightDiagnostics.linkedInCandidates,
        totalCurrentEmploymentAccepted: aggregateBrightDiagnostics.currentEmploymentAccepted,
        totalLocationAccepted: aggregateBrightDiagnostics.locationAccepted,
        totalDuplicateRejected: aggregateBrightDiagnostics.duplicateRejected,
        totalBrightValidUnique: brightPeople.length,
        desiredCount,
        stopReason
      });
    }

    if (parentDeadlineReached()) stopReason = "PARENT_DEADLINE";
    const parentBudgetSpent = stopReason === "PARENT_DEADLINE";
    const apifyFallbackNeeded = !parentBudgetSpent && brightPeople.length < this.fallbackThreshold && !input.apifyExhausted;
    const lastBrightContribution = contributions.filter((entry) => entry.provider === "BRIGHTDATA_GOOGLE").at(-1);
    const observedBrightNextPage = lastBrightContribution?.nextPage ?? brightStartPage;
    const observedBrightPagesFetched = brightPagesFetched + brightPagesSucceeded;
    const observedBrightExhausted = lastBrightContribution?.exhausted ?? (input.brightExhausted ?? false);
    const rawBrightResults = brightDiagnostics?.rawBrightResults ?? 0;
    let apifyPeople: ResolvedCachePerson[] = [];
    let apifyDiagnostics: ApifyIngestionDiagnostics | null = null;
    if (apifyFallbackNeeded && !companyLinkedinUrl && input.resolveCompanyLinkedinUrl) {
      try {
        companyLinkedinUrl = canonicalizeLinkedinCompanyUrl(await input.resolveCompanyLinkedinUrl());
      } catch {
        companyLinkedinUrl = null;
      }
    }
    const shouldCallApify = apifyFallbackNeeded && Boolean(companyLinkedinUrl);
    if (apifyFallbackNeeded) {
      safeEvent("DISCOVER_BRIGHTDATA_FALLBACK_TO_APIFY", {
        searchId: input.searchId,
        canonicalCompanyKey: input.canonicalCompanyKey ?? null,
        companyLinkedinResolved: Boolean(companyLinkedinUrl),
        brightConfigured: this.bright.configured,
        brightStartPage,
        brightNextPage: observedBrightNextPage,
        brightPagesFetched: observedBrightPagesFetched,
        brightExhausted: observedBrightExhausted,
        brightRequestCompleted,
        brightTimedOut,
        totalRawBrightResults: rawBrightResults,
        totalLinkedInCandidates: brightDiagnostics?.linkedInCandidates ?? 0,
        totalCurrentEmploymentAccepted: brightDiagnostics?.currentEmploymentAccepted ?? 0,
        totalLocationAccepted: brightDiagnostics?.locationAccepted ?? 0,
        totalDuplicateRejected: brightDiagnostics?.duplicateRejected ?? 0,
        totalBrightValidUnique: brightPeople.length,
        desiredCount,
        stopReason,
        apifyFallbackCalled: shouldCallApify,
        apifyCompanyTargeted: Boolean(companyLinkedinUrl),
        apifyStartPage,
        apifyNextPage: apifyStartPage,
        apifyPagesFetched,
        apifyExhausted: input.apifyExhausted ?? false,
        reason: brightStatus
      });
    }
    if (apifyFallbackNeeded && !companyLinkedinUrl && brightPeople.length === 0) {
      throw new ApifyCompanyTargetingError();
    }
    if (shouldCallApify) {
      const apify = await this.deps.apify.searchProfiles({
        companyName: input.companyName,
        companyLinkedinUrl,
        companyTargeting: { mode: "LINKEDIN_CURRENT_COMPANY", trusted: true },
        jobTitles: titles,
        locations: input.requestedLocations,
        maxResults: input.maxResults,
        startPage: apifyStartPage
      });
      apifyDiagnostics = apify.diagnostics;
      if (apify.profiles.length > 0) await input.onProfilesDiscovered?.();
      apifyPeople = await this.buildPeople(apify.profiles, input, "PROVIDER");
      apifyPeople = apifyPeople.filter((person) => identities.addIfNew(person));
      contributions.push({
        provider: "APIFY",
        people: apifyPeople,
        nextPage: apifyStartPage + 1,
        pagesFetched: 1,
        exhausted: apify.profiles.length === 0 || apify.totalFound < input.maxResults,
        providerRunId: apify.runId,
        providerDatasetId: apify.datasetId,
        providerTotalFound: apify.totalFound,
        providerResultCount: apify.profiles.length
      });
      safeEvent("DISCOVER_APIFY_FALLBACK_RESULTS", {
        searchId: input.searchId,
        canonicalCompanyKey: input.canonicalCompanyKey ?? null,
        companyLinkedinResolved: true,
        brightConfigured: this.bright.configured,
        brightStartPage,
        brightNextPage: observedBrightNextPage,
        brightPagesFetched: observedBrightPagesFetched,
        brightExhausted: observedBrightExhausted,
        brightRequestCompleted,
        brightTimedOut,
        totalRawBrightResults: rawBrightResults,
        totalLinkedInCandidates: brightDiagnostics?.linkedInCandidates ?? 0,
        totalCurrentEmploymentAccepted: brightDiagnostics?.currentEmploymentAccepted ?? 0,
        totalLocationAccepted: brightDiagnostics?.locationAccepted ?? 0,
        totalDuplicateRejected: brightDiagnostics?.duplicateRejected ?? 0,
        totalBrightValidUnique: brightPeople.length,
        desiredCount,
        stopReason,
        apifyFallbackCalled: true,
        apifyCompanyTargeted: true,
        apifyStartPage,
        apifyNextPage: apifyStartPage + 1,
        apifyPagesFetched: apifyPagesFetched + 1,
        apifyExhausted: apify.profiles.length === 0 || apify.totalFound < input.maxResults,
        apifyNewUnique: apifyPeople.length,
        finalUniqueCount: brightPeople.length + apifyPeople.length
      });
    }

    const people = [...brightPeople, ...apifyPeople].slice(0, desiredCount);
    return {
      people,
      contributions,
      diagnostics: {
        brightStatus,
        brightFailureEvent: failureEvent,
        bright: brightDiagnostics,
        apify: apifyDiagnostics,
        brightValidUnique: brightPeople.length,
        brightRequestCompleted,
        brightTimedOut,
        apifyFallbackCalled: shouldCallApify,
        apifyCompanyTargeted: shouldCallApify,
        apifyNewUnique: apifyPeople.length,
        finalUniqueCount: people.length,
        brightStartPage,
        brightEndPage,
        brightPagesAttempted,
        brightPagesSucceeded,
        desiredCount,
        stopReason
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
