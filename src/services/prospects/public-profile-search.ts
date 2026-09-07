import { publicLocationEvidence, requestedCountryFallback } from "./public-profile-location";
import { parseLocation } from "./prospect-normalization";
import type { ApifyProfileSearchInput, ApifyProfileSearchResult, NormalizedProfile } from './apify-profile-search';
import { PersonIdentitySet } from './discover-person-identity';
import { buildPublicPeopleSearchQuery, buildPublicPeopleRoleUnionQuery } from './public-people-query-builder';
import { canonicalizeLinkedInProfileUrl } from './linkedin-profile-url';
import { parseLinkedInSearchResult } from './linkedin-search-result-parser';
import { validateCurrentEmployment } from './current-employment-evidence';
import { evaluateDiscoverLocationMatch } from './discover-location-matching';
import { createConfiguredWebSearchProvider, type WebSearchProvider } from './web-search-provider';
import type { ProspectDiscoveryProvider } from './prospect-discovery-provider';
import { ProspectError } from './prospect-search-service';

export const PUBLIC_SEARCH_LIMITS = { queries: 6, pages: 3, concurrency: 2, pageSize: 10, candidatePageSize: 25, singlePageSize: 500, timeoutMs: 35_000 } as const;
export type PublicSearchDiagnostics = ReturnType<typeof publicCounters>;
export function publicCounters() {
  return { publicSearchQueries: 0, publicSearchPages: 0, rawSearchResults: 0, linkedinProfileUrls: 0,
    invalidProfileUrlRejected: 0, candidateParseRejected: 0, formerEmployeeRejected: 0,
    ambiguousEmploymentRejected: 0, companyMismatchRejected: 0, roleOrLocationRejected: 0,
    duplicateRejected: 0, acceptedUnique: 0, apifyFallbackCalled: false, providerFailed: false,
    apifyCalls: 0, apifyRawReturned: 0, apifyParsed: 0, apifyCompanyMatched: 0, apifyRejectedCompany: 0,
    apifySuppressedByPublicStrongNegative: 0, apifyDeduplicated: 0, apifyAcceptedIntoHybrid: 0,
    publicCurrentAccepted: 0, publicFormerRejected: 0, publicCompanyContradictionRejected: 0,
    publicCompanyInsufficient: 0, currentEmploymentFormerRejected: 0, currentEmploymentContradictoryRejected: 0,
    currentEmploymentInsufficientRejected: 0, currentEmploymentInsufficientAccepted: 0,
    publicLocationContradictionRejected: 0, publicLocationMissing: 0,
    playwrightSearchRuns: 0, playwrightPagesVisited: 0, googleResultCards: 0, linkedinPersonUrls: 0,
    invalidLinkedinUrls: 0, duplicateProfiles: 0, profilesWithLocation: 0, profilesMissingLocation: 0,
    captchaDetected: false, blocked: false, durationMs: 0, stopReason: "",
    publicRoleRejected: 0, publicDuplicateRejected: 0, publicAcceptedUnique: 0, finalAcceptedUnique: 0 };
}
export type DiscoveryValidation = (profiles: NormalizedProfile[]) => Promise<NormalizedProfile[]>;
export type PublicSearchOptions = {
  target: number; validate: DiscoveryValidation; excluded?: PersonIdentitySet;
  denied: PersonIdentitySet; diagnostics: PublicSearchDiagnostics; signal?: AbortSignal;
};
export class PublicSearchDiscoveryProvider implements ProspectDiscoveryProvider {
  constructor(private readonly web: WebSearchProvider | null = createConfiguredWebSearchProvider(),
    private readonly defaults?: PublicSearchOptions) {}
  async searchProfiles(input: ApifyProfileSearchInput, options = this.defaults): Promise<ApifyProfileSearchResult> {
    if (!options) throw new ProspectError('INVALID_STATE', 'Public discovery requires validation context.');
    if (!this.web?.configured) throw new ProspectError('NOT_CONFIGURED', 'Public people search is not configured.');
    // Larger result windows are validated one at a time, avoiding speculative
    // paid queries when the first window already contains a complete batch.
    const singleQuery = this.web.peopleQueryStrategy === "single_role_union";
    const progressive = this.web.pagination;
    const firstPage = progressive ? input.startPage ?? 1 : 1;
    const pageLimit = progressive ? Math.min(progressive.maxPages, firstPage + (input.maxPages ?? progressive.maxPages) - 1) : singleQuery ? 1 : PUBLIC_SEARCH_LIMITS.pages;
    const pageSize = Math.min(singleQuery ? PUBLIC_SEARCH_LIMITS.singlePageSize : PUBLIC_SEARCH_LIMITS.candidatePageSize,
      this.web.maxResultsPerRequest ?? PUBLIC_SEARCH_LIMITS.pageSize);
    const concurrency = pageSize >= PUBLIC_SEARCH_LIMITS.candidatePageSize ? 1 : PUBLIC_SEARCH_LIMITS.concurrency;
    const d = options.diagnostics;
    const seen = new PersonIdentitySet();
    const rawSeen = new Set(input.publicSeenProfileIds ?? []);
    let rawCount = input.publicRawCount ?? 0;
    let nextPage = firstPage;
    let providerExhausted = Boolean(progressive && (firstPage > progressive.maxPages || rawCount >= progressive.maxResults));
    const strongNegatives = new Set(input.publicDeniedProfileIds ?? []);
    const accepted: NormalizedProfile[] = [];
    const unionQuery = singleQuery ? buildPublicPeopleRoleUnionQuery({ companyName: input.companyName, providerTitles: input.jobTitles }) : null;
    const queries = singleQuery ? (unionQuery ? [unionQuery] : []) : [...new Set(input.jobTitles.flatMap(jobTitle => (input.locations.length ? input.locations : [null])
      .map(location => buildPublicPeopleSearchQuery({ companyName: input.companyName, jobTitle, location }))))].slice(0, PUBLIC_SEARCH_LIMITS.queries);
    const timeout = AbortSignal.timeout(progressive ? 90_000 : this.web.materializesPool ? 75_000 : PUBLIC_SEARCH_LIMITS.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const exhausted = new Set<string>();
    try {
      for (let page = firstPage; page <= pageLimit && accepted.length < options.target && !providerExhausted; page++) {
        for (let offset = 0; offset < queries.length && accepted.length < options.target; offset += concurrency) {
          signal.throwIfAborted();
          const batch = queries.slice(offset, offset + concurrency).filter(q => !exhausted.has(q));
          const responses = await Promise.all(batch.map(async query => {
            d.publicSearchPages++; if (page === 1) d.publicSearchQueries++;
            const results = await this.web!.search(query, { page, count: pageSize, includeDomains: ["linkedin.com"], signal, onCrawlDiagnostics: stats => Object.assign(d, stats) });
            if (!Array.isArray(results)) throw new Error('Invalid search response');
            if (!results.length) exhausted.add(query);
            return results.slice(0, pageSize);
          }));
          const candidates: NormalizedProfile[] = [];
          let newUrls = 0;
          const rows = responses.flat().slice(0, progressive ? Math.max(0, progressive.maxResults - rawCount) : undefined);
          rawCount += rows.length;
          nextPage = page + 1;
          for (const result of rows) {
            d.rawSearchResults++;
            if (!result || typeof result.url !== 'string' || typeof result.title !== 'string' ||
              (result.snippet !== null && typeof result.snippet !== 'string')) { d.candidateParseRejected++; continue; }
            const identity = canonicalizeLinkedInProfileUrl(result.url);
            if (!identity) { d.invalidProfileUrlRejected++; continue; }
            d.linkedinProfileUrls++;
            const duplicateRaw = progressive && rawSeen.has(identity.sourceProfileId);
            let profile = parseLinkedInSearchResult(result);
            if (progressive) {
              if (!duplicateRaw) newUrls++;
              rawSeen.add(identity.sourceProfileId);
              if (profile) {
                const evidence = publicLocationEvidence(result.snippet ?? '', input.companyName);
                const fallback = evidence ? null : requestedCountryFallback(input.locations);
                profile = { ...profile, ...parseLocation(evidence ?? fallback), rawLocationEvidence: evidence,
                  locationSource: evidence ? 'google_snippet' : fallback ? 'requested_fallback' : null };
              }
            }
            if (!profile) { d.candidateParseRejected++; continue; }
            const evidence = validateCurrentEmployment(result, profile, input.companyName);
            if (progressive && ['FORMER', 'CONTRADICTORY'].includes(evidence.decision)) {
              strongNegatives.add(identity.sourceProfileId); options.denied.add(profile);
            }
            if (evidence.decision !== 'CURRENT') {
              // Only explicit historical evidence ABOUT the target company is a
              // strong negative that suppresses trusted fallback for this
              // identity. Contradictory or insufficient indexed metadata fails
              // closed on the public path but must not poison Apify's trusted
              // current-company constraint for the same person.
              if (evidence.decision === 'FORMER') {
                d.formerEmployeeRejected++; d.publicFormerRejected++; d.currentEmploymentFormerRejected++; options.denied.add(profile);
              } else if (evidence.decision === 'CONTRADICTORY') {
                d.companyMismatchRejected++; d.publicCompanyContradictionRejected++; d.currentEmploymentContradictoryRejected++;
              } else {
                d.ambiguousEmploymentRejected++; d.publicCompanyInsufficient++; d.currentEmploymentInsufficientRejected++;
              }
              continue;
            }
            if (evidence.reason === 'ASSOCIATION_SNIPPET') d.currentEmploymentInsufficientAccepted++;
            if (duplicateRaw || strongNegatives.has(identity.sourceProfileId)) { d.duplicateRejected++; continue; }
            d.publicCurrentAccepted++;
            // SERP geography: only an explicit contradiction rejects. Missing or
            // unconfirmable location metadata is counted, never a contradiction.
            const locationEvaluation = evaluateDiscoverLocationMatch({
              candidate: profile, requestedLocations: input.locations, context: 'PUBLIC'
            });
            if (locationEvaluation.reason === 'EXPLICIT_CONTRADICTION') {
              d.publicLocationContradictionRejected++; d.roleOrLocationRejected++; continue;
            }
            if (locationEvaluation.reason === 'MISSING_METADATA' || locationEvaluation.reason === 'NO_MATCH') {
              d.publicLocationMissing++;
            }
            if (options.denied.has(profile) || options.excluded?.has(profile) || !seen.addIfNew(profile)) { d.duplicateRejected++; d.publicDuplicateRejected++; continue; }
            candidates.push(profile);
          }
          if (progressive) providerExhausted = !rows.length || !newUrls || page >= progressive.maxPages || rawCount >= progressive.maxResults;
          const valid: NormalizedProfile[] = [];
          for (let i = 0; i < candidates.length; i += progressive ? 10 : Math.max(1, candidates.length))
            valid.push(...await options.validate(candidates.slice(i, i + (progressive ? 10 : candidates.length))));
          signal.throwIfAborted();
          const roleRejected = candidates.length - valid.length;
          d.roleOrLocationRejected += roleRejected; d.publicRoleRejected += roleRejected;
          accepted.push(...valid);
          // A later result may contradict an earlier headline for this identity.
          for (let i = accepted.length - 1; i >= 0; i--) if (options.denied.has(accepted[i])) accepted.splice(i, 1);
        }
      }
    } catch {
      d.providerFailed = true;
      // Deadline/internal timeouts keep timeout semantics; provider failures stay generic.
      if (signal.aborted) throw new ProspectError('PROVIDER_TIMEOUT', 'The profile search timed out. Try again in a moment.');
      throw new ProspectError('PROVIDER_ERROR', 'Public people search is temporarily unavailable.');
    }
    d.acceptedUnique = accepted.length;
    d.publicAcceptedUnique = accepted.length;
    return { ...(progressive ? { providerPool: { exhausted: providerExhausted, pagesFetched: d.publicSearchPages, nextPage, seenProfileIds: [...rawSeen], deniedProfileIds: [...strongNegatives], rawCount } } : {}), ...(this.web.materializesPool ? { providerPool: { exhausted: true, pagesFetched: d.playwrightPagesVisited } } : {}), profiles: accepted, runId: null, datasetId: null, totalFound: d.rawSearchResults,
      diagnostics: { itemsReturned: d.rawSearchResults, parsedCandidates: d.linkedinProfileUrls,
        rejectedBySchema: d.invalidProfileUrlRejected + d.candidateParseRejected, duplicateItems: d.duplicateRejected,
        companyMatched: accepted.length, rejectedByCompany: d.formerEmployeeRejected + d.ambiguousEmploymentRejected + d.companyMismatchRejected } };
  }
}
