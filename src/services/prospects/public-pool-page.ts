import type { PrismaClient } from '@prisma/client';
import { OpenAiProspectClient, createAiBudget } from './prospect-ai';
import { PublicSearchDiscoveryProvider, publicCounters } from './public-profile-search';
import { publicProfileValidator } from './prospect-discovery-provider';
import { RoleClassificationService } from './role-classification-service';
import { createDiscoverRoleIntelligenceService, type DiscoverRoleIntelligencePort } from './discover-role-intelligence-service';
import { PersonIdentitySet } from './discover-person-identity';
import { buildDiscoverDatasetPeople } from './build-discover-dataset-people';
import type { DiscoverCacheExpansionState, DiscoverCacheCompany, ResolvedDataset, ResolvedEmailFormat } from './discover-cache-service';

/** Same validation, classification and email builder as initial Discover and Add More. */
export function publicPoolPageProvider(input: {
  roleClassifier?: RoleClassificationService; roleIntelligence?: DiscoverRoleIntelligencePort;
  signal?: AbortSignal;
  prisma: PrismaClient; company: DiscoverCacheCompany; roles: string[]; locations: string[]; emailFormat: ResolvedEmailFormat;
}) {
  const classifier = input.roleClassifier ?? new RoleClassificationService(input.prisma, new OpenAiProspectClient());
  const intelligence = input.roleIntelligence ?? createDiscoverRoleIntelligenceService(input.prisma, classifier);
  return async (state: DiscoverCacheExpansionState | null): Promise<ResolvedDataset> => {
    const budget = createAiBudget();
    const jobTitles = state?.publicExpansion?.titles.length ? state.publicExpansion.titles : await intelligence.buildProviderTitlePlan(input.roles, { budget });
    const diagnostics = publicCounters();
    const result = await new PublicSearchDiscoveryProvider().searchProfiles({ companyName: input.company.name,
      companyLinkedinUrl: input.company.linkedinUrl, jobTitles, locations: input.locations,
      maxResults: 10, maxPages: 1, startPage: state?.providerNextPage ?? 1,
      publicSeenProfileIds: state?.publicExpansion?.seenProfileIds, publicDeniedProfileIds: state?.publicExpansion?.deniedProfileIds, publicRawCount: state?.publicExpansion?.rawCount
    }, { target: 10, denied: new PersonIdentitySet(), excluded: new PersonIdentitySet(state?.people ?? []), diagnostics, signal: input.signal,
      validate: publicProfileValidator({ roleIntelligence: intelligence, roleClassifier: classifier, requestedTitles: input.roles,
        locations: input.locations, companyName: input.company.name, options: { budget } }) });
    const format = state?.emailFormat ?? input.emailFormat;
    const classifications = await classifier.classify(result.profiles.map(p => p.currentTitle ?? ''), { budget });
    const people = buildDiscoverDatasetPeople(result.profiles, classifications, format);
    if (process.env.NODE_ENV !== 'test') console.info('[discover-public-pool]', JSON.stringify({
      brightDataRequests: diagnostics.publicSearchPages, organicResults: diagnostics.rawSearchResults,
      linkedinCandidates: diagnostics.linkedinProfileUrls, canonicalDuplicates: diagnostics.duplicateRejected,
      roleRejected: diagnostics.publicRoleRejected, currentEmploymentRejected: diagnostics.formerEmployeeRejected + diagnostics.ambiguousEmploymentRejected + diagnostics.companyMismatchRejected,
      locationRejected: diagnostics.publicLocationContradictionRejected, processedProfiles: people.length,
      fallbackLocations: people.filter(p => p.locationSource === 'requested_fallback').length,
      googleSnippetLocations: people.filter(p => p.locationSource === 'google_snippet').length
    }));
    return { people, emailFormat: format, providerPool: result.providerPool,
      publicPageCounts: { providerResults: diagnostics.rawSearchResults, linkedinCandidates: diagnostics.linkedinProfileUrls,
        uniqueCandidates: Math.max(0, (result.providerPool?.seenProfileIds?.length ?? 0) - (state?.publicExpansion?.seenProfileIds.length ?? 0)) },
      publicExpansion: { provider: 'brightdata_google', titles: jobTitles,
        seenProfileIds: result.providerPool?.seenProfileIds ?? [], deniedProfileIds: result.providerPool?.deniedProfileIds ?? [], rawCount: result.providerPool?.rawCount ?? 0 } };
  };
}
