import { publicLocationEvidence, requestedCountryFallback } from "./public-profile-location";
import { parseLocation } from "./prospect-normalization";
import type { ApifyProfileSearchInput, ApifyProfileSearchResult, NormalizedProfile } from './apify-profile-search';
import { PersonIdentitySet } from './discover-person-identity';
import { buildPublicPeopleSearchQuery, buildPublicPeopleRoleUnionQuery } from './public-people-query-builder';
import { resolveLinkedInProfileUrl } from './linkedin-profile-url';
import { parseLinkedInSearchResult } from './linkedin-search-result-parser';
import { validateCurrentEmployment } from './current-employment-evidence';
import { evaluateDiscoverLocationMatch } from './discover-location-matching';
import { createConfiguredWebSearchProvider, type WebSearchProvider } from './web-search-provider';
import type { ProspectDiscoveryProvider } from './prospect-discovery-provider';
import { ProspectError } from './prospect-search-service';
import { createHash } from 'node:crypto';

export const PUBLIC_SEARCH_LIMITS = { queries: 6, pages: 3, concurrency: 2, pageSize: 10, candidatePageSize: 25, singlePageSize: 500, timeoutMs: 35_000 } as const;
export type PublicSearchDiagnostics = ReturnType<typeof publicCounters>;
export function publicCounters() {
  return { publicSearchQueries: 0, publicSearchPages: 0, rawSearchResults: 0, linkedinProfileUrls: 0,
    resultsWithUrl: 0, directLinkedinUrls: 0, redirectLinkedinUrls: 0, displayedLinkedinUrls: 0,
    missingUrls: 0, invalidUrls: 0,
    nonLinkedinUrls: 0, nonProfileLinkedinUrls: 0, redirectDecodeFailed: 0,
    invalidProfileUrlRejected: 0, candidateParseRejected: 0, formerEmployeeRejected: 0,
    ambiguousEmploymentRejected: 0, companyMismatchRejected: 0, roleOrLocationRejected: 0,
    duplicateRejected: 0, acceptedUnique: 0, apifyFallbackCalled: false, providerFailed: false,
    apifyCalls: 0, apifyRawReturned: 0, apifyParsed: 0, apifyCompanyMatched: 0, apifyRejectedCompany: 0,
    apifySuppressedByPublicStrongNegative: 0, apifyDeduplicated: 0, apifyAcceptedIntoHybrid: 0,
    publicCurrentAccepted: 0, publicFormerRejected: 0, publicCompanyContradictionRejected: 0,
    publicCompanyInsufficient: 0, currentEmploymentFormerRejected: 0, currentEmploymentContradictoryRejected: 0,
    currentEmploymentInsufficientRejected: 0, currentEmploymentInsufficientAccepted: 0,
    publicLocationContradictionRejected: 0, publicLocationMissing: 0,
    dedupedProfiles: 0, currentEmploymentAccepted: 0, currentEmploymentRejected: 0,
    currentEmploymentInsufficient: 0, roleAccepted: 0, locationAccepted: 0,
    locationRejected: 0, finalCandidates: 0,
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
    const diagnosticSeen = new Set<string>();
    const employmentOutcomes = new Map<string, 'CURRENT' | 'FORMER' | 'CONTRADICTORY' | 'INSUFFICIENT'>();
    const locationOutcomes = new Map<string, 'ACCEPTED' | 'REJECTED'>();
    let rawCount = input.publicRawCount ?? 0;
    let nextPage = firstPage;
    let providerExhausted = Boolean(progressive && (firstPage > progressive.maxPages || rawCount >= progressive.maxResults));
    const strongNegatives = new Set(input.publicDeniedProfileIds ?? []);
    const accepted: NormalizedProfile[] = [];
    let organicDebugLogged = false;
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
            // Carry the provider query for employment diagnostics; filtering is untouched.
            return { q: query, rows: results.slice(0, pageSize) };
          }));
          const candidates: NormalizedProfile[] = [];
          let newUrls = 0;
          const rows = responses.flatMap(b => b.rows.map(row => [b.q, row] as const))
            .slice(0, progressive ? Math.max(0, progressive.maxResults - rawCount) : undefined);
          if (!organicDebugLogged && process.env.NODE_ENV !== 'test' && rows.length) {
            organicDebugLogged = true;
            console.info('[discover-organic-debug]', JSON.stringify({
              providerResultCount: rows.length,
              providerQuery: rows[0]?.[0] ?? null,
              organic: rows.slice(0, 10).map(([_, result], index) => {
                const resolution = resolveLinkedInProfileUrl(result?.url, result?.displayedUrl);
                return { index, rawUrl: result?.rawUrl ?? result?.url ?? null, title: result?.title ?? null,
                  displayedUrl: result?.displayedUrl ?? null, detectedLinkedinProfile: resolution.ok,
                  rejectionReason: resolution.ok ? null : resolution.reason };
              })
            }));
          }
          rawCount += rows.length;
          nextPage = page + 1;
          for (const [providerQueryUrl, result] of rows) {
            d.rawSearchResults++;
            if (!result || (result.url !== null && typeof result.url !== 'string') || typeof result.title !== 'string' ||
              (result.snippet !== null && typeof result.snippet !== 'string')) { d.candidateParseRejected++; continue; }
            if (typeof result.url === 'string' && result.url.trim()) d.resultsWithUrl++;
            const resolution = resolveLinkedInProfileUrl(result.url, result.displayedUrl);
            if (!resolution.ok) {
              d.invalidProfileUrlRejected++;
              if (resolution.reason === 'missingUrl') d.missingUrls++;
              else if (resolution.reason === 'invalidUrl') d.invalidUrls++;
              else if (resolution.reason === 'nonLinkedinHost') d.nonLinkedinUrls++;
              else if (resolution.reason === 'nonProfilePath') d.nonProfileLinkedinUrls++;
              else if (resolution.reason === 'redirectDecodeFailed') d.redirectDecodeFailed++;
              continue;
            }
            const identity = resolution.identity;
            const source = result.urlSource === 'GOOGLE_REDIRECT' ? 'REDIRECT' : result.urlSource === 'DISPLAYED' ? 'DISPLAYED' : resolution.source;
            if (source === 'REDIRECT') d.redirectLinkedinUrls++;
            else if (source === 'DISPLAYED') d.displayedLinkedinUrls++;
            else d.directLinkedinUrls++;
            d.linkedinProfileUrls++;
            diagnosticSeen.add(identity.sourceProfileId);
            d.dedupedProfiles = diagnosticSeen.size;
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
            // ponytail: TEMP diagnostic for local-vs-Vercel parity; remove after diagnosis.
            if (process.env.NODE_ENV !== 'test') {
              const fingerprintInput = JSON.stringify([input.companyName, input.jobTitles, result.title, result.snippet ?? '']);
              console.info('[discover-employment-input]', JSON.stringify({
                linkedinUrl: identity.linkedinUrl,
                requestedCompany: input.companyName,
                requestedRoles: input.jobTitles,
                rawResultTitle: result.title,
                rawResultDescription: result.snippet ?? null,
                providerQueryUrl,
                nodeVersion: process.version,
                nodeEnv: process.env.NODE_ENV ?? null,
                vercelRegion: process.env.VERCEL_REGION ?? null,
                gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
                inputFingerprint: createHash('sha256').update(fingerprintInput).digest('hex')
              }));
            }
            const evidence = validateCurrentEmployment(result, profile, input.companyName, input.jobTitles);
            employmentOutcomes.set(identity.sourceProfileId, evidence.decision);
            if (process.env.NODE_ENV !== 'test') {
              console.info('[discover-employment-output]', JSON.stringify({
                linkedinUrl: identity.linkedinUrl,
                requestedCompany: input.companyName,
                requestedRoles: input.jobTitles,
                rawTitle: result.title,
                rawDescription: result.snippet ?? null,
                requestedCompanySignals: evidence.requestedCompanySignals,
                contradictorySignals: evidence.contradictorySignals,
                historicalSignals: evidence.historicalSignals,
                extractedEmployers: evidence.extractedEmployers,
                rejectedEmployerFragments: evidence.rejectedEmployerFragments,
                finalStatus: evidence.decision,
                finalReason: evidence.reason
              }));
            }
            if (progressive && ['FORMER', 'CONTRADICTORY'].includes(evidence.decision)) {
              strongNegatives.add(identity.sourceProfileId); options.denied.add(profile);
            }
            if (evidence.decision !== 'CURRENT') {
              locationOutcomes.delete(identity.sourceProfileId);
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
            if (evidence.reason === 'CURRENT_SNIPPET_ASSOCIATION') d.currentEmploymentInsufficientAccepted++;
            if (duplicateRaw || strongNegatives.has(identity.sourceProfileId)) { d.duplicateRejected++; continue; }
            d.publicCurrentAccepted++;
            // SERP geography: only an explicit contradiction rejects. Missing or
            // unconfirmable location metadata is counted, never a contradiction.
            const locationEvaluation = evaluateDiscoverLocationMatch({
              candidate: profile, requestedLocations: input.locations, context: 'PUBLIC'
            });
            if (locationEvaluation.reason === 'EXPLICIT_CONTRADICTION') {
              locationOutcomes.set(identity.sourceProfileId, 'REJECTED');
              d.publicLocationContradictionRejected++; d.roleOrLocationRejected++; continue;
            }
            locationOutcomes.set(identity.sourceProfileId, 'ACCEPTED');
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
          d.roleAccepted += valid.length;
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
    d.currentEmploymentAccepted = [...employmentOutcomes.values()].filter(outcome => outcome === 'CURRENT').length;
    d.currentEmploymentRejected = [...employmentOutcomes.values()].filter(outcome => outcome === 'FORMER' || outcome === 'CONTRADICTORY').length;
    d.currentEmploymentInsufficient = [...employmentOutcomes.values()].filter(outcome => outcome === 'INSUFFICIENT').length;
    d.locationAccepted = [...locationOutcomes.values()].filter(outcome => outcome === 'ACCEPTED').length;
    d.locationRejected = [...locationOutcomes.values()].filter(outcome => outcome === 'REJECTED').length;
    d.finalCandidates = accepted.length;
    if (process.env.NODE_ENV !== 'test') {
      console.info('[discover-filter-summary]', JSON.stringify({
        providerResults: d.rawSearchResults,
        resultsWithUrl: d.resultsWithUrl,
        directLinkedinUrls: d.directLinkedinUrls,
        redirectLinkedinUrls: d.redirectLinkedinUrls,
        displayedLinkedinUrls: d.displayedLinkedinUrls,
        invalidUrls: d.invalidUrls,
        nonLinkedinUrls: d.nonLinkedinUrls,
        nonProfileLinkedinUrls: d.nonProfileLinkedinUrls,
        linkedinProfiles: d.linkedinProfileUrls,
        dedupedProfiles: d.dedupedProfiles,
        currentEmploymentAccepted: d.currentEmploymentAccepted,
        currentEmploymentRejected: d.currentEmploymentRejected,
        currentEmploymentInsufficient: d.currentEmploymentInsufficient,
        roleAccepted: d.roleAccepted,
        roleRejected: d.publicRoleRejected,
        locationAccepted: d.locationAccepted,
        locationRejected: d.locationRejected,
        finalCandidates: d.finalCandidates,
        linkedinUrlRejections: { missingUrl: d.missingUrls, invalidUrl: d.invalidUrls,
          nonLinkedinHost: d.nonLinkedinUrls, nonProfilePath: d.nonProfileLinkedinUrls,
          redirectDecodeFailed: d.redirectDecodeFailed }
      }));
    }
    return { ...(progressive ? { providerPool: { exhausted: providerExhausted, pagesFetched: d.publicSearchPages, nextPage, seenProfileIds: [...rawSeen], deniedProfileIds: [...strongNegatives], rawCount } } : {}), ...(this.web.materializesPool ? { providerPool: { exhausted: true, pagesFetched: d.playwrightPagesVisited } } : {}), profiles: accepted, runId: null, datasetId: null, totalFound: d.rawSearchResults,
      diagnostics: { itemsReturned: d.rawSearchResults, parsedCandidates: d.linkedinProfileUrls,
        rejectedBySchema: d.invalidProfileUrlRejected + d.candidateParseRejected, duplicateItems: d.duplicateRejected,
        companyMatched: accepted.length, rejectedByCompany: d.formerEmployeeRejected + d.ambiguousEmploymentRejected + d.companyMismatchRejected } };
  }
}
