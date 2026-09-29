import { coercePositionCategory } from "@/lib/prospect-enums";
import { env } from "@/lib/env";
import {
  ApifyCompanyTargetingError,
  currentCompanyMatches,
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
import {
  DiscoverCandidateEligibilityService,
  emptyCandidateJudgeDiagnostics,
  type DiscoverCandidateEligibilityPort,
  type DiscoverCandidateJudgeDiagnostics
} from "@/services/prospects/discover-candidate-eligibility-service";
import { nameStateFields } from "@/services/prospects/discover-name-contract";
import { evaluateDiscoverLocationMatch } from "@/services/prospects/discover-location-matching";
import { normalizeDiscoverPersonNames } from "@/services/prospects/discover-person-name-normalization";
import type { AiCallBudget } from "@/services/prospects/prospect-ai";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
import { deterministicCategory, type RoleClassificationService } from "@/services/prospects/role-classification-service";
import { buildTavilyPeopleQueryPlan } from "@/services/prospects/public-people-query-builder";
import {
  TavilyPublicProfileSearchService,
  type TavilyProfileDiagnostics,
  type TavilyProfileSearchProvider
} from "@/services/prospects/tavily-public-profile-search";
import { FirecrawlPublicProfileSearchService, type FirecrawlProfileDiagnostics, type FirecrawlProfileSearchProvider } from "@/services/prospects/firecrawl-public-profile-search";
import { firecrawlFailureEvent } from "@/services/prospects/firecrawl-search-provider";
import { emptyPublicProfileDiagnostics } from "@/services/prospects/public-profile-search-metadata";
import { runPublicProfileQueryPlan } from "@/services/prospects/public-profile-query-plan-runner";
import { buildFirecrawlPeopleQueryPlan } from "@/services/prospects/public-people-query-builder";
import { tavilyFailureEvent } from "@/services/prospects/tavily-search-provider";

export type BrightStopReason =
  | "TARGET_REACHED"
  | "EMPTY_PAGE"
  | "MAX_PAGES"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "PARENT_DEADLINE"
  | "DISABLED"
  | "ALREADY_EXHAUSTED";

export type ApifyFallbackReason =
  | "BRIGHT_EXHAUSTED"
  | "BRIGHT_TIMEOUT"
  | "BRIGHT_PROVIDER_ERROR"
  | "BRIGHT_AUTH_ERROR"
  | "BRIGHT_MALFORMED_RESPONSE";

export type ProviderContribution = {
  provider: "FIRECRAWL" | "TAVILY" | "BRIGHTDATA_GOOGLE" | "APIFY";
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
  /** Successful unfinished query work that initial background discovery must resume. */
  continuationPending: boolean;
  firecrawlStatus: "DISABLED" | "RESULTS" | "ZERO_RESULTS" | "RESULTS_REJECTED" | "FAILED";
  firecrawlFailureEvent: ReturnType<typeof firecrawlFailureEvent> | null;
  firecrawl: FirecrawlProfileDiagnostics | null;
  firecrawlValidUnique: number;
  firecrawlStartQueryIndex: number;
  firecrawlEndQueryIndex: number;
  firecrawlQueriesAttempted: number;
  firecrawlQueriesSucceeded: number;
  firecrawlNextQueryIndex: number;
  firecrawlQueriesFetched: number;
  firecrawlExhausted: boolean;
  firecrawlPeoplePersisted: number;
  tavilyStatus: "DISABLED" | "RESULTS" | "ZERO_RESULTS" | "RESULTS_REJECTED" | "FAILED";
  tavilyFailureEvent: ReturnType<typeof tavilyFailureEvent> | null;
  tavily: TavilyProfileDiagnostics | null;
  tavilyValidUnique: number;
  tavilyStartQueryIndex: number;
  tavilyEndQueryIndex: number;
  tavilyQueriesAttempted: number;
  tavilyQueriesSucceeded: number;
  tavilyNextQueryIndex: number;
  tavilyQueriesFetched: number;
  tavilyExhausted: boolean;
  tavilyPeoplePersisted: number;
  brightStatus: "DISABLED" | "RESULTS" | "ZERO_RESULTS" | "RESULTS_REJECTED" | "FAILED";
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
  brightNextPage: number;
  brightPagesFetched: number;
  brightExhausted: boolean;
  brightRawResults: number;
  brightPeoplePersisted: number;
  unusedDurableCount: number;
  desiredCount: number;
  stopReason: BrightStopReason;
  apifyFallbackReason: ApifyFallbackReason | null;
};

export type ProviderChainResult = {
  people: ResolvedCachePerson[];
  contributions: ProviderContribution[];
  diagnostics: ProviderChainDiagnostics;
};

export type DiscoverPeopleProviderOrchestratorDeps = {
  firecrawl?: FirecrawlProfileSearchProvider;
  firecrawlMaxQueries?: number;
  firecrawlMaxQueriesPerAction?: number;
  tavily?: TavilyProfileSearchProvider;
  bright?: BrightProfileSearchProvider;
  apify: ApifyProfileSearchService;
  roleClassifier: RoleClassificationService;
  roleIntelligence: DiscoverRoleIntelligencePort;
  brightMaxPages?: number;
  tavilyMaxQueries?: number;
  tavilyMaxQueriesPerAction?: number;
  minimumRemainingBudgetMs?: number;
  candidateEligibility?: DiscoverCandidateEligibilityPort;
};

function emptyBrightDiagnostics(): BrightProfileDiagnostics {
  return {
    ...emptyCandidateJudgeDiagnostics(),
    rawBrightResults: 0,
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
    enrichmentCalls: 0
  };
}

function emptyTavilyDiagnostics(): TavilyProfileDiagnostics {
  return {
    ...emptyCandidateJudgeDiagnostics(),
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

function addBrightDiagnostics(
  total: BrightProfileDiagnostics,
  page: BrightProfileDiagnostics
): void {
  for (const key of Object.keys(total) as Array<keyof BrightProfileDiagnostics>) {
    total[key] += Number(page[key] ?? 0);
  }
}

export class DiscoverPeopleProviderOrchestrator {
  private readonly firecrawl: FirecrawlProfileSearchProvider;
  private readonly firecrawlMaxQueries: number;
  private readonly firecrawlMaxQueriesPerAction: number;
  private readonly tavily: TavilyProfileSearchProvider;
  private readonly tavilyMaxQueries: number;
  private readonly tavilyMaxQueriesPerAction: number;
  private readonly bright: BrightProfileSearchProvider;
  private readonly brightMaxPages: number;
  private readonly minimumRemainingBudgetMs: number;
  private readonly candidateEligibility: DiscoverCandidateEligibilityPort;

  constructor(private readonly deps: DiscoverPeopleProviderOrchestratorDeps) {
    this.candidateEligibility = deps.candidateEligibility ?? new DiscoverCandidateEligibilityService();
    this.firecrawl = deps.firecrawl ?? new FirecrawlPublicProfileSearchService(undefined, this.candidateEligibility);
    this.firecrawlMaxQueries = deps.firecrawlMaxQueries ?? env.DISCOVER_FIRECRAWL_MAX_QUERIES;
    this.firecrawlMaxQueriesPerAction = deps.firecrawlMaxQueriesPerAction ?? env.DISCOVER_FIRECRAWL_MAX_QUERIES_PER_ACTION;
    this.tavily = deps.tavily ?? new TavilyPublicProfileSearchService(undefined, this.candidateEligibility);
    this.tavilyMaxQueries = deps.tavilyMaxQueries ?? env.DISCOVER_TAVILY_MAX_QUERIES;
    this.tavilyMaxQueriesPerAction = deps.tavilyMaxQueriesPerAction ?? env.DISCOVER_TAVILY_MAX_QUERIES_PER_ACTION;
    this.bright = deps.bright ?? new BrightDataPublicProfileSearchService(undefined, undefined, this.candidateEligibility);
    this.brightMaxPages = deps.brightMaxPages ?? env.DISCOVER_BRIGHTDATA_MAX_PAGES;
    this.minimumRemainingBudgetMs = deps.minimumRemainingBudgetMs ?? 5_000;
  }

  get firecrawlConfigured(): boolean { return this.firecrawl.configured; }

  get brightConfigured(): boolean {
    return this.bright.configured;
  }

  get tavilyConfigured(): boolean {
    return this.tavily.configured;
  }

  async discover(input: {
    companyName: string;
    companyLinkedinUrl: string | null;
    requestedTitles: string[];
    requestedLocations: string[];
    maxResults: number;
    /** Valid unique people this action should try to collect before stopping Bright. */
    desiredCount?: number;
    firecrawlStartQueryIndex?: number;
    firecrawlQueriesFetched?: number;
    firecrawlExhausted?: boolean;
    /** Rollout batches retain their original chain; this is not exhaustion. */
    skipFirecrawl?: boolean;
    firecrawlQueryAttemptLimit?: number;
    tavilyStartQueryIndex?: number;
    brightStartPage?: number;
    apifyStartPage?: number;
    brightExhausted?: boolean;
    tavilyExhausted?: boolean;
    apifyExhausted?: boolean;
    excluded?: PersonIdentitySet;
    budget: AiCallBudget;
    searchId: string;
    canonicalCompanyKey?: string;
    brightPagesFetched?: number;
    tavilyQueriesFetched?: number;
    apifyPagesFetched?: number;
    brightPageAttemptLimit?: number;
    tavilyQueryAttemptLimit?: number;
    /** Number of unused durable matches observed before this provider action. */
    unusedDurableCount?: number;
    signal?: AbortSignal;
    deadlineAtMs?: number;
    onProfilesDiscovered?: () => Promise<void> | void;
    /** Durable boundary invoked after each successful Bright page, before the next page starts. */
    onBrightPage?: (contribution: ProviderContribution) => Promise<void>;
    /** Durable boundary invoked after each successful Firecrawl query. */
    onFirecrawlQuery?: (contribution: ProviderContribution) => Promise<void>;
    /** Durable boundary invoked after each successful Tavily query. */
    onTavilyQuery?: (contribution: ProviderContribution) => Promise<void>;
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
    const tavilyPlan = buildTavilyPeopleQueryPlan({
      companyName: input.companyName,
      providerTitles: titles,
      locations: input.requestedLocations,
      maxQueries: this.tavilyMaxQueries
    });
    const tavilyStartQueryIndex = Math.max(0, Math.floor(input.tavilyStartQueryIndex ?? 0));
    const tavilyQueriesFetched = input.tavilyQueriesFetched ?? 0;
    const tavilyQueryAttemptLimit = Math.max(
      1,
      Math.floor(input.tavilyQueryAttemptLimit ?? this.tavilyMaxQueriesPerAction)
    );
    const brightPageAttemptLimit = Math.max(
      1,
      Math.floor(input.brightPageAttemptLimit ?? this.brightMaxPages)
    );
    let brightEndPage = brightStartPage;
    let brightPagesAttempted = 0;
    let brightPagesSucceeded = 0;
    let brightPeoplePersisted = 0;
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

    const firecrawlStartQueryIndex = Math.max(0, Math.floor(input.firecrawlStartQueryIndex ?? 0));
    const firecrawlQueriesFetched = input.firecrawlQueriesFetched ?? 0;
    const firecrawlPlan = buildFirecrawlPeopleQueryPlan({
      companyName: input.companyName, providerTitles: titles, locations: input.requestedLocations, maxQueries: this.firecrawlMaxQueries
    });
    const common = {
      desiredCount, identities, parentDeadlineReached, contributions,
      buildPeople: (profiles: NormalizedProfile[]) => this.buildPeople(profiles, input, "CACHE"),
      onProfilesDiscovered: input.onProfilesDiscovered, searchId: input.searchId,
      canonicalCompanyKey: input.canonicalCompanyKey, unusedDurableCount: input.unusedDurableCount
    };
    const firecrawl = await runPublicProfileQueryPlan({
      ...common, provider: "FIRECRAWL", configured: this.firecrawl.configured, skipped: input.skipFirecrawl,
      plan: firecrawlPlan, startQueryIndex: firecrawlStartQueryIndex, queriesFetched: firecrawlQueriesFetched,
      exhausted: input.firecrawlExhausted ?? false,
      attemptLimit: Math.max(1, Math.floor(input.firecrawlQueryAttemptLimit ?? this.firecrawlMaxQueriesPerAction)),
      emptyDiagnostics: { ...emptyPublicProfileDiagnostics(), rawFirecrawlResults: 0, creditsUsed: 0 },
      rawCount: (counts) => counts.rawFirecrawlResults,
      search: (query) => this.firecrawl.searchProfiles({ companyName: input.companyName, locations: input.requestedLocations,
        requestedTitles: input.requestedTitles, budget: input.budget, searchId: input.searchId,
        query, signal: input.signal, deadlineAtMs: input.deadlineAtMs }),
      failureEvent: firecrawlFailureEvent, availabilityFailure: "FIRECRAWL_AUTH_ERROR", persist: input.onFirecrawlQuery
    });
    // As with existing providers, successful partial exhausted results end this action.
    // A later explicit opportunity proceeds downstream after durable people are consumed.
    const tavilyEligible = !parentDeadlineReached() && (Boolean(input.skipFirecrawl) ||
      Boolean(firecrawl.failure) || (firecrawl.exhausted && firecrawl.people.length === 0));
    if (tavilyEligible) safeEvent("DISCOVER_FIRECRAWL_FALLBACK_TO_TAVILY", {
      searchId: input.searchId, canonicalCompanyKey: input.canonicalCompanyKey ?? null,
      firecrawlFailure: firecrawl.failure, firecrawlNextQueryIndex: firecrawl.nextQueryIndex,
      firecrawlQueriesFetched: firecrawlQueriesFetched + firecrawl.succeeded, firecrawlExhausted: firecrawl.exhausted,
      firecrawlValidUnique: firecrawl.people.length, firecrawlSkipped: Boolean(input.skipFirecrawl)
    });
    const tavily = await runPublicProfileQueryPlan({
      ...common, provider: "TAVILY", configured: this.tavily.configured, skipped: !tavilyEligible,
      desiredCount: Math.max(1, desiredCount - firecrawl.people.length),
      plan: tavilyPlan, startQueryIndex: tavilyStartQueryIndex, queriesFetched: tavilyQueriesFetched,
      exhausted: input.tavilyExhausted ?? false, attemptLimit: tavilyQueryAttemptLimit,
      emptyDiagnostics: emptyTavilyDiagnostics(), rawCount: (counts) => counts.rawTavilyResults,
      search: (query) => this.tavily.searchProfiles({ companyName: input.companyName, locations: input.requestedLocations,
        requestedTitles: input.requestedTitles, budget: input.budget, searchId: input.searchId, query, signal: input.signal }),
      failureEvent: tavilyFailureEvent, availabilityFailure: "TAVILY_AUTH_ERROR", persist: input.onTavilyQuery
    });
    const { people: tavilyPeople, diagnostics: tavilyDiagnostics, status: tavilyStatus, failure: tavilyFailure,
      nextQueryIndex: tavilyNextQueryIndex, endQueryIndex: tavilyEndQueryIndex, attempted: tavilyQueriesAttempted,
      succeeded: tavilyQueriesSucceeded, persisted: tavilyPeoplePersisted, exhausted: tavilyExhausted } = tavily;

    const tavilyParentBudgetSpent = parentDeadlineReached();
    const brightEligible = tavilyEligible && !tavilyParentBudgetSpent && (
      Boolean(tavilyFailure) || (tavilyExhausted && tavilyPeople.length === 0)
    );
    const brightDesiredCount = Math.max(1, desiredCount - firecrawl.people.length - tavilyPeople.length);
    if (brightEligible) {
      safeEvent("DISCOVER_TAVILY_FALLBACK_TO_BRIGHT", {
        searchId: input.searchId,
        canonicalCompanyKey: input.canonicalCompanyKey ?? null,
        tavilyFailure,
        tavilyNextQueryIndex,
        tavilyQueriesFetched: tavilyQueriesFetched + tavilyQueriesSucceeded,
        tavilyExhausted,
        tavilyValidUnique: tavilyPeople.length
      });
    }

    // A disabled/misconfigured Bright client is an availability failure, not
    // exhaustion. Apify may cover this action, while no Bright continuation is
    // advanced or permanently exhausted.
    if (brightEligible && !this.bright.configured) failureEvent = "BRIGHT_AUTH_ERROR";

    if (brightEligible && this.bright.configured && !input.brightExhausted) {
      safeEvent("DISCOVER_BRIGHTDATA_STARTED", {
        searchId: input.searchId,
        canonicalCompanyKey: input.canonicalCompanyKey ?? null,
        companyLinkedinResolved: Boolean(companyLinkedinUrl),
        brightConfigured: true,
        brightStartPage,
        brightNextPage: brightStartPage,
        brightPagesFetched,
        brightExhausted: false,
        unusedDurableCount: input.unusedDurableCount ?? 0,
        desiredCount
      });

      while (
        brightPeople.length < brightDesiredCount &&
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
            deadlineAtMs: input.deadlineAtMs,
            locationEnrichmentLimit: remainingLocationEnrichmentCalls,
            requestedTitles: input.requestedTitles,
            budget: input.budget,
            searchId: input.searchId
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
            brightPeoplePersisted,
            unusedDurableCount: input.unusedDurableCount ?? 0,
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
        aggregateBrightDiagnostics.aiAcceptedDeterministicWouldRejectCount =
          (aggregateBrightDiagnostics.aiAcceptedDeterministicWouldRejectCount ?? 0) +
          roleRescueCount(result.profiles);
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
        if (input.onBrightPage) {
          await input.onBrightPage(contribution);
          brightPeoplePersisted += contribution.people.length;
        }
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
          aiJudgeFallbackUsed: Number(result.diagnostics.aiJudgeFallbackCount ?? 0) > 0,
          pageBrightValidUnique: uniquePage.length,
          totalBrightValidUnique: brightPeople.length,
          brightPeoplePersisted,
          unusedDurableCount: input.unusedDurableCount ?? 0,
          desiredCount
        });

        if (brightPeople.length >= brightDesiredCount) {
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
        brightPeople.length < brightDesiredCount &&
        (page > this.brightMaxPages || brightPagesAttempted >= brightPageAttemptLimit)
      ) stopReason = "MAX_PAGES";
      if (!failureEvent && stopReason !== "PARENT_DEADLINE") {
        brightStatus = brightPeople.length > 0
          ? "RESULTS"
          : aggregateBrightDiagnostics.rawBrightResults > 0
            ? "RESULTS_REJECTED"
            : "ZERO_RESULTS";
      }
      // Bright state must come from the last Bright contribution only; a Tavily
      // or Apify contribution at the tail would leak foreign continuation state.
      const lastBrightLogContribution = contributions
        .filter((entry) => entry.provider === "BRIGHTDATA_GOOGLE")
        .at(-1);
      safeEvent("DISCOVER_BRIGHTDATA_RESULTS", {
        searchId: input.searchId,
        canonicalCompanyKey: input.canonicalCompanyKey ?? null,
        companyLinkedinResolved: Boolean(companyLinkedinUrl),
        brightConfigured: true,
        brightStartPage,
        brightEndPage,
        brightPagesAttempted,
        brightPagesSucceeded,
        brightNextPage: lastBrightLogContribution?.nextPage ?? brightStartPage,
        brightPagesFetched: brightPagesFetched + brightPagesSucceeded,
        brightExhausted: lastBrightLogContribution?.exhausted ?? (input.brightExhausted ?? false),
        brightRequestCompleted,
        brightTimedOut,
        totalRawBrightResults: aggregateBrightDiagnostics.rawBrightResults,
        totalLinkedInCandidates: aggregateBrightDiagnostics.linkedInCandidates,
        totalCurrentEmploymentAccepted: aggregateBrightDiagnostics.currentEmploymentAccepted,
        totalLocationAccepted: aggregateBrightDiagnostics.locationAccepted,
        totalDuplicateRejected: aggregateBrightDiagnostics.duplicateRejected,
        totalBrightValidUnique: brightPeople.length,
        brightPeoplePersisted,
        unusedDurableCount: input.unusedDurableCount ?? 0,
        desiredCount,
        stopReason
      });
    }

    if (parentDeadlineReached()) stopReason = "PARENT_DEADLINE";
    const parentBudgetSpent = stopReason === "PARENT_DEADLINE";
    const lastBrightContribution = contributions.filter((entry) => entry.provider === "BRIGHTDATA_GOOGLE").at(-1);
    const observedBrightNextPage = lastBrightContribution?.nextPage ?? brightStartPage;
    const observedBrightPagesFetched = brightPagesFetched + brightPagesSucceeded;
    const observedBrightExhausted = lastBrightContribution?.exhausted ?? (input.brightExhausted ?? false);
    const rawBrightResults = brightDiagnostics?.rawBrightResults ?? 0;
    // Provider routing is state/event driven. A successful Bright action that
    // produced any valid people ends this action even if that same action also
    // proved exhaustion; those people are consumed before the next provider
    // opportunity. Failures are the sole exception and may use Apify now.
    const apifyFallbackReason: ApifyFallbackReason | null = brightEligible
      ? failureEvent
        ? failureEvent
        : observedBrightExhausted && brightPeople.length === 0
          ? "BRIGHT_EXHAUSTED"
          : null
      : null;
    const apifyFallbackNeeded = !parentBudgetSpent && Boolean(apifyFallbackReason) && !input.apifyExhausted;
    let apifyPeople: ResolvedCachePerson[] = [];
    let apifyDiagnostics: ApifyIngestionDiagnostics | null = null;
    if (apifyFallbackNeeded && !companyLinkedinUrl && input.resolveCompanyLinkedinUrl) {
      try {
        companyLinkedinUrl = canonicalizeLinkedinCompanyUrl(await input.resolveCompanyLinkedinUrl());
      } catch {
        companyLinkedinUrl = null;
      }
    }
    const shouldCallApify = apifyFallbackNeeded && !parentDeadlineReached() && Boolean(companyLinkedinUrl);
    safeEvent("DISCOVER_PROVIDER_DECISION", {
      firecrawlStartQueryIndex,
      firecrawlNextQueryIndex: firecrawl.nextQueryIndex,
      firecrawlQueriesFetched: firecrawlQueriesFetched + firecrawl.succeeded,
      firecrawlExhausted: firecrawl.exhausted,
      firecrawlFailure: firecrawl.failure,
      firecrawlValidUnique: firecrawl.people.length,
      firecrawlPeoplePersisted: firecrawl.persisted,
      searchId: input.searchId,
      canonicalCompanyKey: input.canonicalCompanyKey ?? null,
      unusedDurableCount: input.unusedDurableCount ?? 0,
      tavilyStartQueryIndex,
      tavilyNextQueryIndex,
      tavilyQueriesFetched: tavilyQueriesFetched + tavilyQueriesSucceeded,
      tavilyExhausted,
      tavilyFailure,
      tavilyValidUnique: tavilyPeople.length,
      tavilyPeoplePersisted,
      brightStartPage,
      brightNextPage: observedBrightNextPage,
      brightPagesFetched: observedBrightPagesFetched,
      brightExhausted: observedBrightExhausted,
      brightRequestCompleted,
      brightFailure: failureEvent,
      brightRawResults: rawBrightResults,
      brightValidUnique: brightPeople.length,
      brightPeoplePersisted,
      apifyFallbackCalled: shouldCallApify,
      apifyFallbackReason
    });
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
        unusedDurableCount: input.unusedDurableCount ?? 0,
        brightRawResults: rawBrightResults,
        brightValidUnique: brightPeople.length,
        brightPeoplePersisted,
        apifyFallbackReason
      });
    }
    if (apifyFallbackNeeded && !parentDeadlineReached() && !companyLinkedinUrl && firecrawl.people.length + tavilyPeople.length + brightPeople.length === 0) {
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
      const judgedApifyProfiles = await this.judgeApifyProfiles(apify.judgeProfiles ?? apify.profiles, apify.profiles, input, apifyDiagnostics);
      if (judgedApifyProfiles.length > 0) await input.onProfilesDiscovered?.();
      apifyPeople = await this.buildPeople(judgedApifyProfiles, input, "PROVIDER");
      apifyDiagnostics.aiAcceptedDeterministicWouldRejectCount =
        (apifyDiagnostics.aiAcceptedDeterministicWouldRejectCount ?? 0) + roleRescueCount(judgedApifyProfiles);
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
        finalUniqueCount: firecrawl.people.length + tavilyPeople.length + brightPeople.length + apifyPeople.length,
        unusedDurableCount: input.unusedDurableCount ?? 0,
        brightRawResults: rawBrightResults,
        brightPeoplePersisted,
        apifyFallbackReason,
        aiJudgeFallbackUsed: Number(apifyDiagnostics.aiJudgeFallbackCount ?? 0) > 0
      });
    }

    const people = [...firecrawl.people, ...tavilyPeople, ...brightPeople, ...apifyPeople].slice(0, desiredCount);
    return {
      people,
      contributions,
      diagnostics: {
        continuationPending: people.length < desiredCount && (
          (!input.skipFirecrawl && this.firecrawl.configured && !firecrawl.exhausted && !firecrawl.failure) ||
          (tavilyEligible && this.tavily.configured && !tavilyExhausted && !tavilyFailure)
        ),
        firecrawlStatus: firecrawl.status,
        firecrawlFailureEvent: firecrawl.failure,
        firecrawl: firecrawl.diagnostics,
        firecrawlValidUnique: firecrawl.people.length,
        firecrawlStartQueryIndex,
        firecrawlEndQueryIndex: firecrawl.endQueryIndex,
        firecrawlQueriesAttempted: firecrawl.attempted,
        firecrawlQueriesSucceeded: firecrawl.succeeded,
        firecrawlNextQueryIndex: firecrawl.nextQueryIndex,
        firecrawlQueriesFetched: firecrawlQueriesFetched + firecrawl.succeeded,
        firecrawlExhausted: firecrawl.exhausted,
        firecrawlPeoplePersisted: firecrawl.persisted,
        tavilyStatus,
        tavilyFailureEvent: tavilyFailure,
        tavily: tavilyDiagnostics,
        tavilyValidUnique: tavilyPeople.length,
        tavilyStartQueryIndex,
        tavilyEndQueryIndex,
        tavilyQueriesAttempted,
        tavilyQueriesSucceeded,
        tavilyNextQueryIndex,
        tavilyQueriesFetched: tavilyQueriesFetched + tavilyQueriesSucceeded,
        tavilyExhausted,
        tavilyPeoplePersisted,
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
        brightNextPage: observedBrightNextPage,
        brightPagesFetched: observedBrightPagesFetched,
        brightExhausted: observedBrightExhausted,
        brightRawResults: rawBrightResults,
        brightPeoplePersisted,
        unusedDurableCount: input.unusedDurableCount ?? 0,
        desiredCount,
        stopReason,
        apifyFallbackReason
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
    const aiAccepted = new Set(profiles.filter((profile) => profile.discoverEligibility === "AI_ACCEPT")
      .map((profile) => profile.sourceProfileId));
    if (context === "PROVIDER" && !this.deps.roleIntelligence.enabled) return people;
    const filtered = await this.deps.roleIntelligence.filterAndRankPeople({
      // Run the old role policy for every candidate so disagreement remains
      // observable, then union AI accepts back into the authoritative result.
      people,
      requestedTitles: input.requestedTitles,
      requestedLocations: input.requestedLocations,
      context,
      options: { budget: input.budget, searchId: input.searchId }
    });
    const acceptedIds = new Set(filtered.map((person) => person.sourceProfileId));
    for (const profile of rawProfiles) {
      if (profile.discoverEligibility === "AI_ACCEPT") {
        profile.discoverDeterministicRoleAccepted = acceptedIds.has(profile.sourceProfileId);
      }
    }
    return people.filter((person) => aiAccepted.has(person.sourceProfileId) || acceptedIds.has(person.sourceProfileId));
  }

  private async judgeApifyProfiles(
    candidates: NormalizedProfile[],
    deterministicProfiles: NormalizedProfile[],
    input: { companyName: string; requestedTitles: string[]; requestedLocations: string[]; budget: AiCallBudget; searchId: string },
    diagnostics: ApifyIngestionDiagnostics
  ): Promise<NormalizedProfile[]> {
    if (!this.candidateEligibility.enabled) return deterministicProfiles;
    const deterministicIds = new Set(deterministicProfiles.map((profile) => profile.sourceProfileId));
    const evaluated = await this.candidateEligibility.evaluate({
      intent: { company: input.companyName, roles: input.requestedTitles, locations: input.requestedLocations },
      candidates: candidates.map((profile, index) => ({
        candidateId: `APIFY:${index}`,
        provider: "APIFY",
        name: profile.sourceName ?? profile.fullName,
        url: profile.linkedinUrl,
        providerTitle: profile.headline ?? profile.currentTitle,
        providerDescription: null,
        parsedTitle: profile.currentTitle,
        parsedCompany: profile.currentCompanyName,
        parsedLocation: profile.location,
        employmentParserDecision: currentCompanyMatches(profile, { companyName: input.companyName }) ? "CURRENT" :
          profile.currentCompanyName ? "CONTRADICTORY" : "INSUFFICIENT",
        locationParserDecision: (() => {
          const match = evaluateDiscoverLocationMatch({
            candidate: profile,
            requestedLocations: input.requestedLocations,
            context: "CACHE"
          });
          return match.matches ? "MATCH" as const : match.reason === "MISSING_METADATA" ? "MISSING" as const : "MISMATCH" as const;
        })(),
        roleClassifierCategory: profile.currentTitle ? deterministicCategory(normalizeTitle(profile.currentTitle)) : null
      })),
      budget: input.budget,
      searchId: input.searchId
    });
    for (const key of Object.keys(evaluated.diagnostics) as Array<keyof DiscoverCandidateJudgeDiagnostics>) {
      diagnostics[key] = (diagnostics[key] ?? 0) + evaluated.diagnostics[key];
    }
    diagnostics.preJudgeMalformedCount = (diagnostics.preJudgeMalformedCount ?? 0) + diagnostics.rejectedBySchema;
    const accepted: NormalizedProfile[] = [];
    for (const [index, profile] of candidates.entries()) {
      const oldAccepted = deterministicIds.has(profile.sourceProfileId);
      const decision = evaluated.decisions.get(`APIFY:${index}`)?.decision;
      if (decision === "ACCEPT" && !oldAccepted) {
        diagnostics.aiAcceptedDeterministicWouldRejectCount = (diagnostics.aiAcceptedDeterministicWouldRejectCount ?? 0) + 1;
      }
      if (decision === "REJECT" && oldAccepted) {
        diagnostics.aiRejectedDeterministicWouldAcceptCount = (diagnostics.aiRejectedDeterministicWouldAcceptCount ?? 0) + 1;
      }
      const keep = evaluated.shadow ? oldAccepted : decision === "ACCEPT" ? true : decision === "REJECT" ? false : oldAccepted;
      if (keep) accepted.push({ ...profile,
        discoverEligibility: decision === "ACCEPT" && !evaluated.shadow ? "AI_ACCEPT" : "DETERMINISTIC_FALLBACK",
        discoverDeterministicEligibilityAccepted: oldAccepted });
    }
    return accepted;
  }
}

function roleRescueCount(profiles: readonly NormalizedProfile[]): number {
  return profiles.filter((profile) =>
    profile.discoverEligibility === "AI_ACCEPT" &&
    profile.discoverDeterministicEligibilityAccepted === true &&
    profile.discoverDeterministicRoleAccepted === false
  ).length;
}

function safeEvent(event: string, counters: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "test") return;
  console.info(JSON.stringify({ event, ...counters }));
}
