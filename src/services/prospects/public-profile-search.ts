import type { ApifyProfileSearchInput, ApifyProfileSearchResult, NormalizedProfile } from './apify-profile-search';
import { PersonIdentitySet } from './discover-person-identity';
import { buildPublicPeopleSearchQuery } from './public-people-query-builder';
import { canonicalizeLinkedInProfileUrl } from './linkedin-profile-url';
import { parseLinkedInSearchResult } from './linkedin-search-result-parser';
import { validateCurrentEmployment } from './current-employment-evidence';
import { createConfiguredWebSearchProvider, type WebSearchProvider } from './web-search-provider';
import type { ProspectDiscoveryProvider } from './prospect-discovery-provider';
import { ProspectError } from './prospect-search-service';

export const PUBLIC_SEARCH_LIMITS = { queries: 6, pages: 3, concurrency: 2, pageSize: 10, candidatePageSize: 25, timeoutMs: 35_000 } as const;
export type PublicSearchDiagnostics = ReturnType<typeof publicCounters>;
export function publicCounters() {
  return { publicSearchQueries: 0, publicSearchPages: 0, rawSearchResults: 0, linkedinProfileUrls: 0,
    invalidProfileUrlRejected: 0, candidateParseRejected: 0, formerEmployeeRejected: 0,
    ambiguousEmploymentRejected: 0, companyMismatchRejected: 0, roleOrLocationRejected: 0,
    duplicateRejected: 0, acceptedUnique: 0, apifyFallbackCalled: false, providerFailed: false,
    apifyCalls: 0, apifyRawReturned: 0, apifyParsed: 0, apifyCompanyMatched: 0, apifyRejectedCompany: 0,
    apifySuppressedByPublicStrongNegative: 0, apifyDeduplicated: 0, apifyAcceptedIntoHybrid: 0 };
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
    const pageSize = Math.min(PUBLIC_SEARCH_LIMITS.candidatePageSize,
      this.web.maxResultsPerRequest ?? PUBLIC_SEARCH_LIMITS.pageSize);
    const concurrency = pageSize >= PUBLIC_SEARCH_LIMITS.candidatePageSize ? 1 : PUBLIC_SEARCH_LIMITS.concurrency;
    const d = options.diagnostics;
    const seen = new PersonIdentitySet();
    const accepted: NormalizedProfile[] = [];
    const queries = [...new Set(input.jobTitles.flatMap(jobTitle => (input.locations.length ? input.locations : [null])
      .map(location => buildPublicPeopleSearchQuery({ companyName: input.companyName, jobTitle, location }))))].slice(0, PUBLIC_SEARCH_LIMITS.queries);
    const timeout = AbortSignal.timeout(PUBLIC_SEARCH_LIMITS.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const exhausted = new Set<string>();
    try {
      for (let page = 1; page <= PUBLIC_SEARCH_LIMITS.pages && accepted.length < options.target; page++) {
        for (let offset = 0; offset < queries.length && accepted.length < options.target; offset += concurrency) {
          signal.throwIfAborted();
          const batch = queries.slice(offset, offset + concurrency).filter(q => !exhausted.has(q));
          const responses = await Promise.all(batch.map(async query => {
            d.publicSearchPages++; if (page === 1) d.publicSearchQueries++;
            const results = await this.web!.search(query, { page, count: pageSize, includeDomains: ["linkedin.com"], signal });
            if (!Array.isArray(results)) throw new Error('Invalid search response');
            if (!results.length) exhausted.add(query);
            return results.slice(0, pageSize);
          }));
          const candidates: NormalizedProfile[] = [];
          for (const result of responses.flat()) {
            d.rawSearchResults++;
            if (!result || typeof result.url !== 'string' || typeof result.title !== 'string' ||
              (result.snippet !== null && typeof result.snippet !== 'string')) { d.candidateParseRejected++; continue; }
            const identity = canonicalizeLinkedInProfileUrl(result.url);
            if (!identity) { d.invalidProfileUrlRejected++; continue; }
            d.linkedinProfileUrls++;
            const profile = parseLinkedInSearchResult(result);
            if (!profile) { d.candidateParseRejected++; continue; }
            const evidence = validateCurrentEmployment(result, profile, input.companyName);
            if (evidence.decision !== 'CURRENT') {
              // Only explicit historical evidence ABOUT the target company is a
              // strong negative that suppresses trusted fallback for this
              // identity. Mismatched or insufficient indexed metadata fails
              // closed on the public path but must not poison Apify's trusted
              // current-company constraint for the same person.
              if (evidence.decision === 'FORMER') { d.formerEmployeeRejected++; options.denied.add(profile); }
              else if (evidence.reason === 'COMPANY_MISMATCH') d.companyMismatchRejected++;
              else d.ambiguousEmploymentRejected++;
              continue;
            }
            if (options.denied.has(profile) || options.excluded?.has(profile) || !seen.addIfNew(profile)) { d.duplicateRejected++; continue; }
            candidates.push(profile);
          }
          const valid = await options.validate(candidates);
          signal.throwIfAborted();
          d.roleOrLocationRejected += candidates.length - valid.length;
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
    return { profiles: accepted, runId: null, datasetId: null, totalFound: d.rawSearchResults,
      diagnostics: { itemsReturned: d.rawSearchResults, parsedCandidates: d.linkedinProfileUrls,
        rejectedBySchema: d.invalidProfileUrlRejected + d.candidateParseRejected, duplicateItems: d.duplicateRejected,
        companyMatched: accepted.length, rejectedByCompany: d.formerEmployeeRejected + d.ambiguousEmploymentRejected + d.companyMismatchRejected } };
  }
}
