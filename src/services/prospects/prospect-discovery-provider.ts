import { canonicalizeLinkedInProfileUrl } from "./linkedin-profile-url";
import { ProspectError } from './prospect-search-service';
import { env } from '@/lib/env';
import { dedupeProfiles, type ApifyProfileSearchInput, type ApifyProfileSearchResult } from './apify-profile-search';
import { PublicSearchDiscoveryProvider, publicCounters, type DiscoveryValidation } from './public-profile-search';
import { PersonIdentitySet } from './discover-person-identity';
import type { DiscoverRoleIntelligencePort, RoleIntelligenceOptions } from './discover-role-intelligence-service';
import type { RoleClassificationService } from './role-classification-service';
import { normalizeDiscoverPersonNames } from './discover-person-name-normalization';
import { normalizeTitle } from './prospect-normalization';

export const HYBRID_DISCOVERY_LIMITS = { pages: 3, pageSize: 25, timeoutMs: 90_000 } as const;

export interface ProspectDiscoveryProvider {
  searchProfiles(input: ApifyProfileSearchInput): Promise<ApifyProfileSearchResult>;
}
export class ApifyDiscoveryProvider implements ProspectDiscoveryProvider {
  constructor(private readonly apify: ProspectDiscoveryProvider) {}
  searchProfiles(input: ApifyProfileSearchInput) { return this.apify.searchProfiles(input); }
}
/** Validate before counting toward public early-stop or the hybrid deficit. */
export function publicProfileValidator(input: {
  roleIntelligence: DiscoverRoleIntelligencePort; roleClassifier: RoleClassificationService;
  requestedTitles: string[]; locations: string[]; companyName: string; options: RoleIntelligenceOptions;
}): DiscoveryValidation {
  return async profiles => {
    if (!profiles.length) return [];
    const named = (await normalizeDiscoverPersonNames(profiles, { companyName: input.companyName, budget: input.options.budget }))
      .filter(p => Boolean(p.fullName));
    const classifications = await input.roleClassifier.classify(named.map(p => p.currentTitle ?? ''), input.options);
    const people = named.map(p => ({ ...p, normalizedTitle: normalizeTitle(p.currentTitle ?? ''),
      positionCategory: classifications.get(normalizeTitle(p.currentTitle ?? ''))?.category ?? 'OTHER',
      inferredEmail: null, emailStatus: 'UNAVAILABLE', emailConfidence: 'UNAVAILABLE', emailPattern: null, emailSource: null }));
    const valid = await input.roleIntelligence.filterAndRankPeople({ people, requestedTitles: input.requestedTitles,
      requestedLocations: input.locations, context: 'CACHE', options: input.options });
    const identities = new PersonIdentitySet(valid);
    return named.filter(p => identities.has(p));
  };
}
export async function discoverProfiles(input: ApifyProfileSearchInput, options: {
  apify: ProspectDiscoveryProvider; validate: DiscoveryValidation; target: number; excluded?: PersonIdentitySet;
  signal?: AbortSignal; publicProvider?: PublicSearchDiscoveryProvider; mode?: 'apify' | 'public_search' | 'hybrid';
}): Promise<ApifyProfileSearchResult> {
  const mode = options.mode ?? env.DISCOVER_PEOPLE_PROVIDER;
  if (mode === 'apify') return new ApifyDiscoveryProvider(options.apify).searchProfiles(input);
  const signal = options.signal ?? AbortSignal.timeout(HYBRID_DISCOVERY_LIMITS.timeoutMs);
  const checkDeadline = () => {
    if (signal.aborted) throw new ProspectError('PROVIDER_TIMEOUT', 'The profile search timed out. Try again in a moment.');
  };
  checkDeadline();
  const diagnostics = publicCounters();
  const denied = new PersonIdentitySet();
  let result: ApifyProfileSearchResult = { profiles: [], runId: null, datasetId: null, totalFound: 0,
    diagnostics: { itemsReturned: 0, parsedCandidates: 0, rejectedBySchema: 0, duplicateItems: 0, companyMatched: 0, rejectedByCompany: 0 } };
  try {
    try {
      result = await (options.publicProvider ?? new PublicSearchDiscoveryProvider()).searchProfiles(input, {
        target: options.target, validate: options.validate, excluded: options.excluded, denied, diagnostics, signal
      });
    } catch (error) {
      diagnostics.providerFailed = true;
      if (mode === 'public_search') throw error;
    }
    checkDeadline();
    if (mode === 'hybrid' && result.profiles.length < options.target) {
      diagnostics.apifyFallbackCalled = true;
      for (let page = input.startPage ?? 1; page < (input.startPage ?? 1) + HYBRID_DISCOVERY_LIMITS.pages && result.profiles.length < options.target; page++) {
        checkDeadline();
        const fallback = await options.apify.searchProfiles({ ...input, maxResults: HYBRID_DISCOVERY_LIMITS.pageSize, startPage: page });
        checkDeadline();
        diagnostics.apifyCalls++;
        diagnostics.apifyRawReturned += fallback.diagnostics.itemsReturned;
        diagnostics.apifyParsed += fallback.diagnostics.parsedCandidates;
        diagnostics.apifyCompanyMatched += fallback.diagnostics.companyMatched;
        diagnostics.apifyRejectedCompany += fallback.diagnostics.rejectedByCompany;
        diagnostics.apifyDeduplicated += fallback.diagnostics.duplicateItems;
        // Explicit public historical evidence about the target company is the
        // only public signal allowed to suppress a trusted fallback identity.
        diagnostics.apifySuppressedByPublicStrongNegative += fallback.profiles.filter(p => denied.has(p)).length;
        const valid = await options.validate(fallback.profiles.filter(p => !denied.has(p) && !options.excluded?.has(p)));
        checkDeadline();
        diagnostics.apifyAcceptedIntoHybrid += valid.length;
        const merged = dedupeProfiles([...valid, ...result.profiles]);
        diagnostics.apifyDeduplicated += valid.length + result.profiles.length - merged.length;
        result = { ...fallback, totalFound: result.totalFound + fallback.totalFound,
          profiles: merged, diagnostics: result.diagnostics };
        if (!fallback.totalFound) break;
      }
      result.diagnostics = { ...result.diagnostics,
        apifyFallbackCalled: diagnostics.apifyFallbackCalled,
        apifyCalls: diagnostics.apifyCalls, apifyRawReturned: diagnostics.apifyRawReturned,
        apifyParsed: diagnostics.apifyParsed, apifyCompanyMatched: diagnostics.apifyCompanyMatched,
        apifyRejectedCompany: diagnostics.apifyRejectedCompany,
        apifySuppressedByPublicStrongNegative: diagnostics.apifySuppressedByPublicStrongNegative,
        apifyDeduplicated: diagnostics.apifyDeduplicated, apifyAcceptedIntoHybrid: diagnostics.apifyAcceptedIntoHybrid };
    }
    diagnostics.acceptedUnique = result.profiles.length;
    // New-mode inserts share the same database unique key even when providers
    // assign different opaque ids to the same public LinkedIn identity.
    result.profiles = dedupeProfiles(result.profiles.map(profile => {
      const canonical = canonicalizeLinkedInProfileUrl(profile.linkedinUrl);
      return canonical ? { ...profile, ...canonical } : profile;
    }));
    // Raw actor replay cannot reproduce public negative-evidence exclusions.
    // Hybrid retries must use the combined provider path, never raw reprocessing.
    if (mode === 'hybrid') result.datasetId = null;
    return result;
  } finally {
    if (process.env.NODE_ENV !== 'test') console.info('[discover-public-search]', JSON.stringify(diagnostics));
  }
}
