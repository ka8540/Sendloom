import type { NormalizedProfile } from "@/services/prospects/apify-profile-search";
import type { ResolvedCachePerson } from "@/services/prospects/discover-cache-service";
import type { ProviderContribution } from "@/services/prospects/discover-people-provider-orchestrator";
import type { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import type { PublicProfileDiagnostics } from "@/services/prospects/public-profile-search-metadata";

/** Shared Firecrawl/Tavily state machine. An action cap never consumes unexecuted work. */
export async function runPublicProfileQueryPlan<D extends PublicProfileDiagnostics, F extends string>(input: {
  provider: "FIRECRAWL" | "TAVILY";
  configured: boolean;
  skipped?: boolean;
  plan: string[];
  startQueryIndex: number;
  queriesFetched: number;
  exhausted: boolean;
  attemptLimit: number;
  desiredCount: number;
  emptyDiagnostics: D;
  rawCount: (diagnostics: D) => number;
  search: (query: string) => Promise<{ profiles: NormalizedProfile[]; diagnostics: D }>;
  failureEvent: (error: unknown) => F;
  availabilityFailure: F;
  parentDeadlineReached: () => boolean;
  buildPeople: (profiles: NormalizedProfile[]) => Promise<ResolvedCachePerson[]>;
  identities: PersonIdentitySet;
  onProfilesDiscovered?: () => Promise<void> | void;
  persist?: (contribution: ProviderContribution) => Promise<void>;
  contributions: ProviderContribution[];
  searchId: string;
  canonicalCompanyKey?: string;
  unusedDurableCount?: number;
}) {
  const prefix = input.provider === "FIRECRAWL" ? "firecrawl" : "tavily";
  const people: ResolvedCachePerson[] = [];
  const total = input.emptyDiagnostics;
  let diagnostics: D | null = null;
  let status: "DISABLED" | "RESULTS" | "ZERO_RESULTS" | "RESULTS_REJECTED" | "FAILED" = input.configured ? "ZERO_RESULTS" : "DISABLED";
  let failure: F | null = null;
  let nextQueryIndex = input.startQueryIndex;
  let endQueryIndex = nextQueryIndex;
  let attempted = 0;
  let succeeded = 0;
  let persisted = 0;
  let exhausted = input.exhausted || nextQueryIndex >= input.plan.length;
  const progress = () => ({
    searchId: input.searchId, canonicalCompanyKey: input.canonicalCompanyKey ?? null,
    [`${prefix}NextQueryIndex`]: nextQueryIndex,
    [`${prefix}QueriesFetched`]: input.queriesFetched + succeeded,
    [`${prefix}Exhausted`]: exhausted,
    [`total${input.provider === "FIRECRAWL" ? "Firecrawl" : "Tavily"}ValidUnique`]: people.length,
    [`${prefix}PeoplePersisted`]: persisted, desiredCount: input.desiredCount
  });
  if (!input.skipped && !exhausted && !input.configured) failure = input.availabilityFailure;
  if (!input.skipped && !exhausted && input.configured) {
    event(`DISCOVER_${input.provider}_STARTED`, { ...progress(), [`${prefix}StartQueryIndex`]: input.startQueryIndex, unusedDurableCount: input.unusedDurableCount ?? 0 });
    while (people.length < input.desiredCount && nextQueryIndex < input.plan.length && attempted < input.attemptLimit) {
      if (input.parentDeadlineReached()) break;
      const queryIndex = nextQueryIndex;
      endQueryIndex = queryIndex;
      attempted += 1;
      let result: { profiles: NormalizedProfile[]; diagnostics: D };
      try { result = await input.search(input.plan[queryIndex]); }
      catch (error) {
        if (!input.parentDeadlineReached()) failure = input.failureEvent(error);
        status = "FAILED";
        break;
      }
      if (result.profiles.length > 0) await input.onProfilesDiscovered?.();
      const processed = await input.buildPeople(result.profiles);
      const unique = processed.filter((person) => input.identities.addIfNew(person));
      const roleRescues = result.profiles.filter((profile) =>
        profile.discoverEligibility === "AI_ACCEPT" &&
        profile.discoverDeterministicEligibilityAccepted === true &&
        profile.discoverDeterministicRoleAccepted === false
      ).length;
      const counts = { ...result.diagnostics,
        aiJudgeFallbackUsed: Number(result.diagnostics.aiJudgeFallbackCount ?? 0) > 0,
        aiAcceptedDeterministicWouldRejectCount:
          Number(result.diagnostics.aiAcceptedDeterministicWouldRejectCount ?? 0) + roleRescues,
        roleRejected: Number(result.diagnostics.roleRejected ?? 0) + Math.max(0, result.profiles.length - processed.length),
        duplicateRejected: result.diagnostics.duplicateRejected + processed.length - unique.length };
      for (const key of Object.keys(total) as Array<keyof D>) {
        total[key] = (Number(total[key] ?? 0) + Number(counts[key] ?? 0)) as D[keyof D];
      }
      diagnostics = total;
      people.push(...unique);
      const contribution: ProviderContribution = {
        provider: input.provider, people: unique, nextPage: queryIndex + 1, pagesFetched: 1,
        exhausted: queryIndex + 1 >= input.plan.length, providerRunId: null, providerDatasetId: null,
        providerTotalFound: input.rawCount(result.diagnostics), providerResultCount: result.profiles.length
      };
      // Storage failures propagate; they must never become availability fallback or consumed work.
      if (input.persist) { await input.persist(contribution); persisted += unique.length; }
      input.contributions.push(contribution);
      succeeded += 1;
      nextQueryIndex = contribution.nextPage;
      exhausted = contribution.exhausted;
      event(`DISCOVER_${input.provider}_QUERY_RESULTS`, { ...progress(), queryIndex, ...counts, [`${prefix}ValidUnique`]: unique.length });
    }
    if (!failure && !input.parentDeadlineReached()) {
      status = people.length > 0 ? "RESULTS" : input.rawCount(total) > 0 ? "RESULTS_REJECTED" : "ZERO_RESULTS";
    }
    event(`DISCOVER_${input.provider}_RESULTS`, { ...progress(), [`${prefix}QueriesAttempted`]: attempted, [`${prefix}QueriesSucceeded`]: succeeded, [`${prefix}ValidUnique`]: people.length });
  }
  return { people, diagnostics, status, failure, nextQueryIndex, endQueryIndex, attempted, succeeded, persisted, exhausted };
}

function event(event: string, counts: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== "test") console.info(JSON.stringify({ event, ...counts }));
}
