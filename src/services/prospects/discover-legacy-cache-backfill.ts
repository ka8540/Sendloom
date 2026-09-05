import { normalizeDiscoverPersonNames } from "@/services/prospects/discover-person-name-normalization";
import { nameStateFields } from "@/services/prospects/discover-name-contract";
import type { PrismaClient } from "@prisma/client";

import { resolveResultsPerSearch } from "@/lib/discover-quota";
import { coercePositionCategory } from "@/lib/prospect-enums";
import {
  computeDiscoverFingerprint,
  normalizeLinkedinCompanySlug
} from "@/services/prospects/discover-cache-fingerprint";
import {
  DISCOVER_CACHE_STATUS,
  resolveSharedCacheTtlDays,
  resolveSharedCacheVersion,
  type ResolvedCachePerson
} from "@/services/prospects/discover-cache-service";
import {
  isLinkedInCompanyUrl,
  isLinkedInProfileUrl,
  isValidCompanyDomain,
  normalizeCompanyName,
  normalizeDomain,
  normalizeTitle
} from "@/services/prospects/prospect-normalization";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROVIDER_ALLOCATION_SOURCES = new Set(["PROVIDER", "ADD_MORE_PROVIDER"]);

export type DiscoverLegacyCacheBackfillOptions = {
  apply: boolean;
  batchSize: number;
  limit: number | null;
};

export type DiscoverLegacyCacheBackfillStats = {
  mode: "DRY_RUN" | "APPLY";
  historicalSearchesScanned: number;
  providerEligibleSearches: number;
  eligiblePeopleCount: number;
  uniquePublicPeopleCount: number;
  cacheEntriesToCreate: number;
  cacheEntriesToMerge: number;
  peopleToInsert: number;
  duplicatePeopleSkipped: number;
  skippedNoProviderProvenance: number;
  skippedNoStrongCompanyIdentity: number;
  skippedExpired: number;
  skippedNoPeople: number;
  cacheVersion: string;
  cacheTtlDays: number;
};

export type LegacyDiscoverCompany = {
  name: string;
  normalizedName: string;
  officialName: string | null;
  officialDomain: string | null;
  officialWebsiteDomain: string | null;
  linkedinUrl: string | null;
};

export type LegacyDiscoverPerson = {
  sourceName?: string | null;
  nameNormalization?: string | null;
  sourceProfileId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  currentTitle: string | null;
  normalizedTitle: string | null;
  positionCategory: string | null;
  location: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  linkedinUrl: string;
};

export type LegacyDiscoverAllocation = {
  allocationSource: string;
  allocationOrder: number;
  person: LegacyDiscoverPerson | null;
};

export type LegacyDiscoverSearch = {
  id: string;
  company: LegacyDiscoverCompany | null;
  requestedTitles: unknown;
  requestedLocations: unknown;
  maxResults: number;
  resultSource: string | null;
  apifyRunId: string | null;
  apifyDatasetId: string | null;
  lastAttemptCompletedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  allocations: LegacyDiscoverAllocation[];
};

export type LegacySharedCacheSnapshot = {
  cacheId: string;
  sourceProfileIds: string[];
};

export type LegacySharedCachePlan = {
  fingerprint: string;
  cacheVersion: string;
  companyKey: string;
  companyName: string;
  companyDomain: string | null;
  companyLinkedinUrl: string | null;
  normalizedRoles: string[];
  normalizedLocations: string[];
  resultLimit: number;
  fetchedAt: Date;
  expiresAt: Date;
  people: ResolvedCachePerson[];
};

export type LegacySharedCacheMergeResult = {
  cacheId: string;
  created: boolean;
  insertedPeople: number;
  duplicatePeople: number;
};

export interface DiscoverLegacyCacheBackfillStore {
  loadSearchBatch(input: { afterId: string | null; take: number }): Promise<LegacyDiscoverSearch[]>;
  inspectSharedCache(fingerprint: string): Promise<LegacySharedCacheSnapshot | null>;
  mergeSharedCache(
    plan: LegacySharedCachePlan,
    options: { tightenFreshness: boolean }
  ): Promise<LegacySharedCacheMergeResult>;
}

export function hasHistoricalProviderProvenance(search: LegacyDiscoverSearch): boolean {
  return (
    search.resultSource === "PROVIDER" ||
    Boolean(search.apifyRunId) ||
    Boolean(search.apifyDatasetId) ||
    search.allocations.some((allocation) => PROVIDER_ALLOCATION_SOURCES.has(allocation.allocationSource))
  );
}

function searchLevelProviderProvenance(search: LegacyDiscoverSearch): boolean {
  return search.resultSource === "PROVIDER" || Boolean(search.apifyRunId) || Boolean(search.apifyDatasetId);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function publicText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

export function sanitizeLegacyDiscoverPerson(person: LegacyDiscoverPerson): ResolvedCachePerson | null {
  const sourceProfileId = publicText(person.sourceProfileId);
  const linkedinUrl = publicText(person.linkedinUrl);
  if (!sourceProfileId || !linkedinUrl || !isLinkedInProfileUrl(linkedinUrl)) {
    return null;
  }

  const firstName = publicText(person.firstName) ?? "";
  const lastName = publicText(person.lastName) ?? "";
  const fullName = publicText(person.fullName) ?? [firstName, lastName].filter(Boolean).join(" ");
  const currentTitle = publicText(person.currentTitle);
  const titleForNormalization = publicText(person.normalizedTitle) ?? currentTitle;
  const normalizedTitle = titleForNormalization ? normalizeTitle(titleForNormalization) : null;

  return {
    sourceProfileId,
    firstName,
    lastName,
    fullName,
    ...(person.sourceName ? nameStateFields(person) : {}),
    currentTitle,
    normalizedTitle,
    positionCategory: coercePositionCategory(person.positionCategory),
    location: publicText(person.location),
    country: publicText(person.country),
    state: publicText(person.state),
    city: publicText(person.city),
    linkedinUrl,
    // Tenant-specific email candidates and evidence never cross into the shared cache.
    inferredEmail: null,
    emailStatus: "UNAVAILABLE",
    emailConfidence: "UNAVAILABLE",
    emailPattern: null,
    emailSource: null
  };
}

export type StrongLegacyCompanyIdentity = {
  name: string;
  normalizedName: string;
  domain: string | null;
  linkedinUrl: string | null;
};

export function resolveStrongLegacyCompanyIdentity(
  company: LegacyDiscoverCompany | null
): StrongLegacyCompanyIdentity | null {
  if (!company) return null;

  const domainCandidates = [company.officialWebsiteDomain, company.officialDomain]
    .map((value) => normalizeDomain(value))
    .filter((value): value is string => Boolean(value) && isValidCompanyDomain(value));
  const domains = new Set(domainCandidates);
  if (domains.size > 1) {
    return null;
  }
  const domain = domainCandidates[0] ?? null;
  const linkedinUrl =
    company.linkedinUrl &&
    isLinkedInCompanyUrl(company.linkedinUrl) &&
    normalizeLinkedinCompanySlug(company.linkedinUrl)
      ? company.linkedinUrl.trim()
      : null;
  if (!domain && !linkedinUrl) {
    return null;
  }

  const name = publicText(company.officialName) ?? publicText(company.name) ?? "Unknown company";
  return {
    name,
    normalizedName: normalizeCompanyName(company.normalizedName || name),
    domain,
    linkedinUrl
  };
}

function sourceFetchedAt(search: LegacyDiscoverSearch, now: Date): Date {
  const source = search.lastAttemptCompletedAt ?? search.completedAt ?? search.createdAt;
  return source.getTime() > now.getTime() ? new Date(now) : new Date(source);
}

function normalizedIdentityKey(sourceProfileId: string): string {
  return sourceProfileId.trim().toLowerCase();
}

function uniqueEligiblePeople(search: LegacyDiscoverSearch): {
  eligibleCount: number;
  people: ResolvedCachePerson[];
  duplicateCount: number;
} {
  const searchProvenance = searchLevelProviderProvenance(search);
  const allocations = [...search.allocations].sort(
    (left, right) => left.allocationOrder - right.allocationOrder
  );
  const eligible = allocations.filter(
    (allocation) => searchProvenance || PROVIDER_ALLOCATION_SOURCES.has(allocation.allocationSource)
  );
  const seen = new Set<string>();
  const people: ResolvedCachePerson[] = [];
  let duplicateCount = 0;
  for (const allocation of eligible) {
    if (!allocation.person) continue;
    const sanitized = sanitizeLegacyDiscoverPerson(allocation.person);
    if (!sanitized) continue;
    const key = normalizedIdentityKey(sanitized.sourceProfileId);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    people.push(sanitized);
  }
  return { eligibleCount: eligible.length, people, duplicateCount };
}

function emptyStats(input: {
  apply: boolean;
  cacheVersion: string;
  cacheTtlDays: number;
}): DiscoverLegacyCacheBackfillStats {
  return {
    mode: input.apply ? "APPLY" : "DRY_RUN",
    historicalSearchesScanned: 0,
    providerEligibleSearches: 0,
    eligiblePeopleCount: 0,
    uniquePublicPeopleCount: 0,
    cacheEntriesToCreate: 0,
    cacheEntriesToMerge: 0,
    peopleToInsert: 0,
    duplicatePeopleSkipped: 0,
    skippedNoProviderProvenance: 0,
    skippedNoStrongCompanyIdentity: 0,
    skippedExpired: 0,
    skippedNoPeople: 0,
    cacheVersion: input.cacheVersion,
    cacheTtlDays: input.cacheTtlDays
  };
}

export async function runDiscoverLegacyCacheBackfill(input: {
  store: DiscoverLegacyCacheBackfillStore;
  options: DiscoverLegacyCacheBackfillOptions;
  now?: Date;
  cacheVersion?: string;
  cacheTtlDays?: number;
}): Promise<DiscoverLegacyCacheBackfillStats> {
  const now = input.now ? new Date(input.now) : new Date();
  const cacheVersion = input.cacheVersion ?? resolveSharedCacheVersion();
  const cacheTtlDays = input.cacheTtlDays ?? resolveSharedCacheTtlDays();
  const stats = emptyStats({ apply: input.options.apply, cacheVersion, cacheTtlDays });
  const dispositionByFingerprint = new Map<string, "CREATE" | "MERGE">();
  const plannedPeopleByFingerprint = new Map<string, Set<string>>();
  const createdByThisRun = new Set<string>();
  const globallyUniquePeople = new Set<string>();
  let afterId: string | null = null;

  while (input.options.limit === null || stats.historicalSearchesScanned < input.options.limit) {
    const remaining =
      input.options.limit === null
        ? input.options.batchSize
        : Math.min(input.options.batchSize, input.options.limit - stats.historicalSearchesScanned);
    if (remaining <= 0) break;
    const batch = await input.store.loadSearchBatch({ afterId, take: remaining });
    if (batch.length === 0) break;

    for (const search of batch) {
      stats.historicalSearchesScanned += 1;
      if (!hasHistoricalProviderProvenance(search)) {
        stats.skippedNoProviderProvenance += 1;
        continue;
      }
      stats.providerEligibleSearches += 1;

      const company = resolveStrongLegacyCompanyIdentity(search.company);
      if (!company) {
        stats.skippedNoStrongCompanyIdentity += 1;
        continue;
      }

      const fetchedAt = sourceFetchedAt(search, now);
      const expiresAt = new Date(fetchedAt.getTime() + cacheTtlDays * DAY_MS);
      if (expiresAt.getTime() <= now.getTime()) {
        stats.skippedExpired += 1;
        continue;
      }

      const eligible = uniqueEligiblePeople(search);
      stats.eligiblePeopleCount += eligible.eligibleCount;
      stats.duplicatePeopleSkipped += eligible.duplicateCount;
      if (eligible.people.length === 0) {
        stats.skippedNoPeople += 1;
        continue;
      }

      const resultLimit = search.maxResults > 0 ? search.maxResults : resolveResultsPerSearch();
      const computed = computeDiscoverFingerprint({
        company: {
          linkedinCompanyUrl: company.linkedinUrl,
          officialWebsiteDomain: company.domain,
          officialDomain: company.domain,
          normalizedName: company.normalizedName
        },
        roles: asStringArray(search.requestedTitles),
        locations: asStringArray(search.requestedLocations),
        resultLimit,
        cacheVersion
      });
      const fingerprint = computed.fingerprint;
      let snapshot: LegacySharedCacheSnapshot | null = null;
      if (!dispositionByFingerprint.has(fingerprint)) {
        snapshot = await input.store.inspectSharedCache(fingerprint);
        const disposition = snapshot ? "MERGE" : "CREATE";
        dispositionByFingerprint.set(fingerprint, disposition);
        if (disposition === "CREATE") stats.cacheEntriesToCreate += 1;
        else stats.cacheEntriesToMerge += 1;
      } else if (dispositionByFingerprint.get(fingerprint) === "MERGE") {
        snapshot = await input.store.inspectSharedCache(fingerprint);
      }

      const existingKeys = new Set(
        (snapshot?.sourceProfileIds ?? []).map((sourceProfileId) => normalizedIdentityKey(sourceProfileId))
      );
      const plannedKeys = plannedPeopleByFingerprint.get(fingerprint) ?? new Set<string>();
      const peopleToMerge = eligible.people.filter((person) => {
        const key = normalizedIdentityKey(person.sourceProfileId);
        globallyUniquePeople.add(`${computed.input.companyKey}\u0000${key}`);
        if (existingKeys.has(key) || plannedKeys.has(key)) {
          stats.duplicatePeopleSkipped += 1;
          return false;
        }
        plannedKeys.add(key);
        return true;
      });
      plannedPeopleByFingerprint.set(fingerprint, plannedKeys);
      stats.uniquePublicPeopleCount = globallyUniquePeople.size;

      if (!input.options.apply) {
        stats.peopleToInsert += peopleToMerge.length;
        continue;
      }

      const merge = await input.store.mergeSharedCache(
        {
          fingerprint,
          cacheVersion,
          companyKey: computed.input.companyKey,
          companyName: company.name,
          companyDomain: company.domain,
          companyLinkedinUrl: company.linkedinUrl,
          normalizedRoles: computed.input.roles,
          normalizedLocations: computed.input.locations,
          resultLimit: computed.input.resultLimit,
          fetchedAt,
          expiresAt,
          people: peopleToMerge
        },
        { tightenFreshness: createdByThisRun.has(fingerprint) }
      );
      if (merge.created) createdByThisRun.add(fingerprint);
      stats.peopleToInsert += merge.insertedPeople;
      // A concurrent insert or an existing case-variant may reduce the actual write count.
      stats.duplicatePeopleSkipped += merge.duplicatePeople;
    }

    afterId = batch[batch.length - 1]?.id ?? afterId;
    if (batch.length < remaining) break;
  }

  return stats;
}

/** PostgreSQL/Prisma adapter. It reads tenant rows but writes only shared-cache tables. */
export class PrismaDiscoverLegacyCacheBackfillStore implements DiscoverLegacyCacheBackfillStore {
  constructor(private readonly prisma: PrismaClient) {}

  async loadSearchBatch(input: { afterId: string | null; take: number }): Promise<LegacyDiscoverSearch[]> {
    const searches = await this.prisma.prospectSearch.findMany({
      take: input.take,
      skip: input.afterId ? 1 : undefined,
      cursor: input.afterId ? { id: input.afterId } : undefined,
      orderBy: { id: "asc" },
      select: {
        id: true,
        companyId: true,
        requestedTitles: true,
        requestedLocations: true,
        maxResults: true,
        resultSource: true,
        apifyRunId: true,
        apifyDatasetId: true,
        lastAttemptCompletedAt: true,
        completedAt: true,
        createdAt: true
      }
    });
    if (searches.length === 0) return [];

    const searchIds = searches.map((search) => search.id);
    const companyIds = Array.from(
      new Set(searches.map((search) => search.companyId).filter((id): id is string => Boolean(id)))
    );
    const [companies, allocations] = await Promise.all([
      companyIds.length > 0
        ? this.prisma.prospectCompany.findMany({
            where: { id: { in: companyIds } },
            select: {
              id: true,
              name: true,
              normalizedName: true,
              officialName: true,
              officialDomain: true,
              officialWebsiteDomain: true,
              linkedinUrl: true
            }
          })
        : [],
      this.prisma.prospectSearchPerson.findMany({
        where: { searchId: { in: searchIds } },
        orderBy: [{ searchId: "asc" }, { allocationOrder: "asc" }],
        select: {
          id: true,
          searchId: true,
          personId: true,
          allocationOrder: true,
          allocationSource: true
        }
      })
    ]);
    const personIds = Array.from(new Set(allocations.map((allocation) => allocation.personId)));
    const people =
      personIds.length > 0
        ? await this.prisma.prospectPerson.findMany({
            where: { id: { in: personIds } },
            select: {
              id: true,
              sourceProfileId: true,
              sourceName: true,
              nameNormalization: true,
              firstName: true,
              lastName: true,
              fullName: true,
              currentTitle: true,
              normalizedTitle: true,
              location: true,
              country: true,
              state: true,
              city: true,
              linkedinUrl: true,
              position: { select: { category: true } }
            }
          })
        : [];

    const companyById = new Map(companies.map((company) => [company.id, company]));
    const personById = new Map(people.map((person) => [person.id, person]));
    const allocationsBySearch = new Map<string, typeof allocations>();
    for (const allocation of allocations) {
      const rows = allocationsBySearch.get(allocation.searchId) ?? [];
      rows.push(allocation);
      allocationsBySearch.set(allocation.searchId, rows);
    }

    return searches.map((search) => {
      const company = search.companyId ? companyById.get(search.companyId) ?? null : null;
      return {
        id: search.id,
        company: company
          ? {
              name: company.name,
              normalizedName: company.normalizedName,
              officialName: company.officialName,
              officialDomain: company.officialDomain,
              officialWebsiteDomain: company.officialWebsiteDomain,
              linkedinUrl: company.linkedinUrl
            }
          : null,
        requestedTitles: search.requestedTitles,
        requestedLocations: search.requestedLocations,
        maxResults: search.maxResults,
        resultSource: search.resultSource,
        apifyRunId: search.apifyRunId,
        apifyDatasetId: search.apifyDatasetId,
        lastAttemptCompletedAt: search.lastAttemptCompletedAt,
        completedAt: search.completedAt,
        createdAt: search.createdAt,
        allocations: (allocationsBySearch.get(search.id) ?? []).map((allocation) => {
          const person = personById.get(allocation.personId) ?? null;
          return {
            allocationSource: allocation.allocationSource,
            allocationOrder: allocation.allocationOrder,
            person: person
              ? {
                  sourceProfileId: person.sourceProfileId,
                  firstName: person.firstName,
                  lastName: person.lastName,
                  fullName: person.fullName,
                  ...nameStateFields(person),
                  currentTitle: person.currentTitle,
                  normalizedTitle: person.normalizedTitle,
                  positionCategory: person.position.category,
                  location: person.location,
                  country: person.country,
                  state: person.state,
                  city: person.city,
                  linkedinUrl: person.linkedinUrl
                }
              : null
          };
        })
      };
    });
  }

  async inspectSharedCache(fingerprint: string): Promise<LegacySharedCacheSnapshot | null> {
    const entry = await this.prisma.discoverSearchCache.findUnique({
      where: { fingerprint },
      select: { id: true }
    });
    if (!entry) return null;
    const people = await this.prisma.discoverSearchCachePerson.findMany({
      where: { cacheId: entry.id },
      select: { sourceProfileId: true }
    });
    return { cacheId: entry.id, sourceProfileIds: people.map((person) => person.sourceProfileId) };
  }

  async mergeSharedCache(
    plan: LegacySharedCachePlan,
    options: { tightenFreshness: boolean }
  ): Promise<LegacySharedCacheMergeResult> {
    plan = { ...plan, people: await normalizeDiscoverPersonNames(plan.people, { companyName: plan.companyName }) };
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.discoverSearchCache.findUnique({
        where: { fingerprint: plan.fingerprint },
        select: { id: true, fetchedAt: true, expiresAt: true }
      });
      const entry = await tx.discoverSearchCache.upsert({
        where: { fingerprint: plan.fingerprint },
        create: {
          fingerprint: plan.fingerprint,
          cacheVersion: plan.cacheVersion,
          companyKey: plan.companyKey,
          companyName: plan.companyName,
          companyDomain: plan.companyDomain,
          companyLinkedinUrl: plan.companyLinkedinUrl,
          normalizedRoles: plan.normalizedRoles,
          normalizedLocations: plan.normalizedLocations,
          resultLimit: plan.resultLimit,
          status: DISCOVER_CACHE_STATUS.READY,
          fetchedAt: plan.fetchedAt,
          expiresAt: plan.expiresAt,
          refreshStartedAt: null,
          lastErrorCode: null,
          resultCount: 0,
          providerNextPage: 1,
          providerPagesFetched: 0,
          providerExhausted: false,
          lastProviderFetchAt: null,
          emailDomain: null,
          emailDomainConfidence: "UNAVAILABLE",
          emailDomainEvidence: null as never,
          emailPattern: null,
          patternConfidence: "UNAVAILABLE",
          patternEvidence: null as never,
          emailFormatReason: null,
          emailFormatDiscoveryStatus: "NOT_ATTEMPTED",
          emailFormatDiscoveryReason: null,
          emailFormatDiscoveryAt: null,
          emailFormatDiscoveryExpiresAt: null
        },
        // Existing shared state is authoritative. People are merged separately.
        update: {}
      });
      const existing = await tx.discoverSearchCachePerson.findMany({
        where: { cacheId: entry.id },
        select: { sourceProfileId: true, sortIndex: true }
      });
      const existingIds = new Set(existing.map((person) => normalizedIdentityKey(person.sourceProfileId)));
      const missing = plan.people.filter((person) => !existingIds.has(normalizedIdentityKey(person.sourceProfileId)));
      const maxSortIndex = existing.reduce((max, person) => Math.max(max, person.sortIndex), -1);
      const inserted =
        missing.length > 0
          ? await tx.discoverSearchCachePerson.createMany({
              data: missing.map((person, index) => ({
                cacheId: entry.id,
                sortIndex: maxSortIndex + index + 1,
                ...person
              })),
              skipDuplicates: true
            })
          : { count: 0 };

      if (inserted.count > 0) {
        const resultCount = await tx.discoverSearchCachePerson.count({ where: { cacheId: entry.id } });
        await tx.discoverSearchCache.update({ where: { id: entry.id }, data: { resultCount } });
      }
      if (before) {
        const freshnessUpdate: { fetchedAt?: Date; expiresAt?: Date } = {};
        if (options.tightenFreshness) {
          // Several historical searches may reconstruct one new fingerprint.
          // Keep that newly-created entry conservatively as old as its oldest
          // contributing source rather than making old rows appear newer.
          if (!before.fetchedAt || new Date(before.fetchedAt).getTime() > plan.fetchedAt.getTime()) {
            freshnessUpdate.fetchedAt = plan.fetchedAt;
          }
          if (!before.expiresAt || new Date(before.expiresAt).getTime() > plan.expiresAt.getTime()) {
            freshnessUpdate.expiresAt = plan.expiresAt;
          }
        } else {
          // For a pre-existing entry, accept only genuinely newer historical
          // provider freshness. This can revive a stale READY fingerprint while
          // never replacing a newer timestamp or touching status, continuation,
          // email-format evidence, or failure state.
          if (!before.fetchedAt || new Date(before.fetchedAt).getTime() < plan.fetchedAt.getTime()) {
            freshnessUpdate.fetchedAt = plan.fetchedAt;
          }
          if (!before.expiresAt || new Date(before.expiresAt).getTime() < plan.expiresAt.getTime()) {
            freshnessUpdate.expiresAt = plan.expiresAt;
          }
        }
        if (Object.keys(freshnessUpdate).length > 0) {
          await tx.discoverSearchCache.update({
            where: { id: entry.id },
            data: freshnessUpdate
          });
        }
      }

      return {
        cacheId: entry.id,
        created: before === null,
        insertedPeople: inserted.count,
        duplicatePeople: Math.max(0, plan.people.length - inserted.count)
      };
    });
  }
}
